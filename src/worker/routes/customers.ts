import { Hono } from 'hono';
import { and, asc, count, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { clientOrders, customers, subMerchants, type CustomerRow, type SubMerchantRow } from '@/db/schema';
import type { CustomerDTO, SubMerchantDTO } from '@/shared/types';
import type { AppContextEnv } from '@/worker/types';
import { requireAuth, requirePermission } from '@/worker/middleware/auth';
import { bumpCacheVersions, CACHE_NAMESPACES, readVersionedCache } from '@/worker/cache';
import { chunkedInArrayQuery } from '@/worker/utils/dbChunk';
import { createCustomerSchema, customerBulkImportSchema, isUniqueConstraintError, readJson, updateCustomerSchema } from '@/worker/schemas';
import { importCustomers } from '@/worker/services/bulkImport';
import { containsLike } from '@/worker/utils/like';
import { recordAuditLog } from '@/worker/services/auditLog';
import { clientIp } from '@/worker/utils/loginRateLimit';

export const customersRoutes = new Hono<AppContextEnv>();

function mapSubMerchant(row: SubMerchantRow): SubMerchantDTO {
  return {
    id: row.id,
    customerId: row.customerId,
    name: row.name,
    phone: row.phone,
    location: row.location,
    createdAt: row.createdAt,
  };
}

function mapCustomer(
  row: CustomerRow,
  subMerchantsCount: number,
  nested?: SubMerchantDTO[]
): CustomerDTO {
  return {
    id: row.id,
    clientCode: row.clientCode,
    name: row.name,
    defaultPhone: row.defaultPhone,
    defaultLocation: row.defaultLocation,
    representativeName: row.representativeName,
    createdAt: row.createdAt,
    subMerchantsCount,
    ...(nested ? { subMerchants: nested } : {}),
  };
}

function readOptionalText(value: unknown, max: number): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string') {
    return { ok: false };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }
  if (trimmed.length > max) {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}

customersRoutes.use('*', requireAuth);

customersRoutes.get('/', requirePermission('customers', 'view'), async (c) => {
  const search = c.req.query('search')?.trim() ?? '';
  const includeSubs = c.req.query('include') === 'sub_merchants';
  const pageQuery = c.req.query('page');
  const paginate = pageQuery !== undefined && pageQuery !== '';
  const page = Math.max(1, Number.parseInt(pageQuery ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(c.req.query('pageSize') ?? '20', 10) || 20));
  const payload = await readVersionedCache(
    c.get('db'),
    CACHE_NAMESPACES.customers,
    `${search}:${includeSubs ? 'subs' : 'count'}:${paginate ? `${page}:${pageSize}` : 'all'}`,
    async () => {
      const db = c.get('db');
      const filters = [];
      if (search) {
        const nameOrPhone = or(
          containsLike(customers.name, search),
          containsLike(customers.defaultPhone, search),
          containsLike(customers.clientCode, search)
        );
        if (nameOrPhone) filters.push(nameOrPhone);
      }

      const where = filters.length > 0 ? and(...filters) : undefined;
      const totalRow = paginate
        ? await db.select({ total: count() }).from(customers).where(where).get()
        : undefined;
      const ordered = db.select().from(customers).where(where).orderBy(asc(customers.name));
      const rows = paginate
        ? await ordered.limit(pageSize).offset((page - 1) * pageSize).all()
        : await ordered.all();

      const ids = rows.map((row) => row.id);
      const countRows = await chunkedInArrayQuery(ids, 75, (chunk) =>
        db
          .select({ customerId: subMerchants.customerId, total: count() })
          .from(subMerchants)
          .where(inArray(subMerchants.customerId, chunk))
          .groupBy(subMerchants.customerId)
          .all(),
      );

      const counts = new Map(countRows.map((row) => [row.customerId, row.total]));
      const nested = new Map<number, SubMerchantDTO[]>();
      if (includeSubs && ids.length > 0) {
        const subRows = await chunkedInArrayQuery(ids, 75, (chunk) =>
          db
            .select()
            .from(subMerchants)
            .where(inArray(subMerchants.customerId, chunk))
            .orderBy(asc(subMerchants.name))
            .all(),
        );
        for (const sub of subRows) {
          const list = nested.get(sub.customerId) ?? [];
          list.push(mapSubMerchant(sub));
          nested.set(sub.customerId, list);
        }
      }

      return {
        customers: rows.map((row) =>
          mapCustomer(
            row,
            counts.get(row.id) ?? 0,
            includeSubs ? (nested.get(row.id) ?? []) : undefined
          )
        ),
        ...(paginate ? { page, pageSize, total: totalRow?.total ?? 0 } : {}),
      };
    }
  );

  return c.json(payload);
});

customersRoutes.get('/:id/sub-merchants', requirePermission('customers', 'view'), async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) {
    return c.json({ error: 'معرّف العميل غير صالح' }, 400);
  }

  const db = c.get('db');
  const customer = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, id)).get();
  if (!customer) {
    return c.json({ error: 'العميل غير موجود' }, 404);
  }

  const payload = await readVersionedCache(db, CACHE_NAMESPACES.customers, `subs:${id}`, async () => {
    const rows = await db
      .select()
      .from(subMerchants)
      .where(eq(subMerchants.customerId, id))
      .orderBy(asc(subMerchants.name))
      .all();
    return { subMerchants: rows.map(mapSubMerchant) };
  });

  return c.json(payload);
});

customersRoutes.post('/bulk-import', requirePermission('customers', 'bulkImport'), async (c) => {
  const parsed = await readJson(c, customerBulkImportSchema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  if (parsed.data.customers.length === 0 && parsed.data.subMerchants.length === 0) {
    return c.json({ error: 'لا توجد سطور صالحة للاستيراد' }, 400);
  }
  const db = c.get('db');
  const result = await importCustomers(
    db,
    parsed.data.customers,
    parsed.data.subMerchants,
    parsed.data.selectedCustomerFields,
    parsed.data.selectedMerchantFields,
  );
  await bumpCacheVersions(db, [CACHE_NAMESPACES.customers, CACHE_NAMESPACES.dashboard, CACHE_NAMESPACES.reports]);
  const conflict = result.errors.find((row) => row.message.includes('مسجّل') || row.message.includes('تعارض'));
  if (conflict && result.created === 0 && result.updated === 0) {
    return c.json({ error: conflict.message, ...result }, 409);
  }
  const user = c.get('user');
  await recordAuditLog(db, {
    actorUserId: user.id,
    actorUsername: user.username,
    actorFullName: user.fullName,
    module: 'customers',
    action: 'bulk_import',
    entityType: 'customer',
    summary: `استيراد عملاء: أُنشئ ${result.created} وحُدّث ${result.updated}`,
    details: {
      created: result.created,
      updated: result.updated,
      rows: parsed.data.customers.length + parsed.data.subMerchants.length,
      errorCount: result.errors.length,
    },
    ipAddress: clientIp((name) => c.req.header(name)),
  });
  return c.json(result);
});

customersRoutes.post('/', requirePermission('customers', 'manage'), async (c) => {
  const parsed = await readJson(c, createCustomerSchema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const clientCode = body.clientCode.trim();
  const duplicateCode = await c.get('db')
    .select({ id: customers.id })
    .from(customers)
    .where(sql`lower(${customers.clientCode}) = ${clientCode.toLowerCase()}`)
    .get();
  if (duplicateCode) {
    return c.json({ error: 'كود العميل مسجّل مسبقاً لعميل آخر' }, 409);
  }

  const name = body.name?.trim() ?? '';
  if (name.length < 2 || name.length > 120) {
    return c.json({ error: 'يرجى إدخال اسم العميل (من حرفين حتى 120 حرفاً)' }, 400);
  }
  const phone = readOptionalText(body.defaultPhone, 40);
  const location = readOptionalText(body.defaultLocation, 160);
  if (!phone.ok || !location.ok) {
    return c.json({ error: 'رقم الهاتف أو العنوان أطول من الحد المسموح' }, 400);
  }

  const db = c.get('db');
  try {
    const inserted = await db
      .insert(customers)
      .values({
        clientCode,
        name,
        defaultPhone: phone.value,
        defaultLocation: location.value,
        representativeName: body.representativeName ?? null,
      })
      .returning()
      .get();

    await bumpCacheVersions(db, [CACHE_NAMESPACES.customers, CACHE_NAMESPACES.dashboard, CACHE_NAMESPACES.reports]);
    return c.json({ customer: mapCustomer(inserted, 0, []) }, 201);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json({ error: 'كود العميل مسجّل مسبقاً لعميل آخر' }, 409);
    }
    throw error;
  }
});

customersRoutes.put('/:id', requirePermission('customers', 'manage'), async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) {
    return c.json({ error: 'معرّف العميل غير صالح' }, 400);
  }

  const parsed = await readJson(c, updateCustomerSchema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const db = c.get('db');
  const existing = await db.select().from(customers).where(eq(customers.id, id)).get();
  if (!existing) {
    return c.json({ error: 'العميل غير موجود' }, 404);
  }

  const clientCode = body.clientCode !== undefined ? body.clientCode.trim() : existing.clientCode;
  if (clientCode.length < 1) {
    return c.json({ error: 'كود العميل مطلوب' }, 400);
  }
  if (clientCode.toLowerCase() !== existing.clientCode.toLowerCase()) {
    const duplicateCode = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(sql`lower(${customers.clientCode}) = ${clientCode.toLowerCase()}`, ne(customers.id, id)))
      .get();
    if (duplicateCode) {
      return c.json({ error: 'كود العميل مسجّل مسبقاً لعميل آخر' }, 409);
    }
  }

  const name = body.name !== undefined ? body.name.trim() : existing.name;
  if (name.length < 2 || name.length > 120) {
    return c.json({ error: 'يرجى إدخال اسم العميل (من حرفين حتى 120 حرفاً)' }, 400);
  }

  let defaultPhone = existing.defaultPhone;
  if (body.defaultPhone !== undefined) {
    const phone = readOptionalText(body.defaultPhone, 40);
    if (!phone.ok) {
      return c.json({ error: 'رقم الهاتف أطول من الحد المسموح' }, 400);
    }
    defaultPhone = phone.value;
  }

  let defaultLocation = existing.defaultLocation;
  if (body.defaultLocation !== undefined) {
    const location = readOptionalText(body.defaultLocation, 160);
    if (!location.ok) {
      return c.json({ error: 'العنوان أطول من الحد المسموح' }, 400);
    }
    defaultLocation = location.value;
  }

  let representativeName = existing.representativeName;
  if (body.representativeName !== undefined) {
    const representative = readOptionalText(body.representativeName, 80);
    if (!representative.ok) {
      return c.json({ error: 'اسم المندوب أطول من الحد المسموح' }, 400);
    }
    representativeName = representative.value;
  }

  let updated;
  try {
    updated = await db
      .update(customers)
      .set({ clientCode, name, defaultPhone, defaultLocation, representativeName })
      .where(eq(customers.id, id))
      .returning()
      .get();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json({ error: 'كود العميل مسجّل مسبقاً لعميل آخر' }, 409);
    }
    throw error;
  }

  const subCount = await db
    .select({ total: count() })
    .from(subMerchants)
    .where(eq(subMerchants.customerId, id))
    .get();

  await bumpCacheVersions(db, [CACHE_NAMESPACES.customers, CACHE_NAMESPACES.dashboard, CACHE_NAMESPACES.reports]);
  return c.json({ customer: mapCustomer(updated, subCount?.total ?? 0) });
});

customersRoutes.delete('/:id', requirePermission('customers', 'delete'), async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) {
    return c.json({ error: 'معرّف العميل غير صالح' }, 400);
  }

  const db = c.get('db');
  const existing = await db.select({ id: customers.id, name: customers.name, clientCode: customers.clientCode }).from(customers).where(eq(customers.id, id)).get();
  if (!existing) {
    return c.json({ error: 'العميل غير موجود' }, 404);
  }

  const linked = await db
    .select({ total: count() })
    .from(clientOrders)
    .where(eq(clientOrders.customerId, id))
    .get();

  if (linked && linked.total > 0) {
    return c.json(
      {
        error: 'لا يمكن حذف هذا العميل لارتباطه بطلبات مسجّلة في أوردرات اليوم.',
        code: 'CUSTOMER_IN_USE',
      },
      400
    );
  }

  const merchants = await db
    .select({ total: count() })
    .from(subMerchants)
    .where(eq(subMerchants.customerId, id))
    .get();
  const subMerchantsCount = merchants?.total ?? 0;
  if (subMerchantsCount > 0) {
    return c.json(
      {
        error: `لا يمكن حذف العميل لوجود ${subMerchantsCount} تاجر فرعي مرتبط به؛ احذف التجار الفرعيين أولاً`,
        code: 'CUSTOMER_HAS_MERCHANTS',
      },
      400,
    );
  }

  await db.delete(customers).where(eq(customers.id, id));
  const user = c.get('user');
  await recordAuditLog(db, {
    actorUserId: user.id,
    actorUsername: user.username,
    actorFullName: user.fullName,
    module: 'customers',
    action: 'delete_customer',
    entityType: 'customer',
    entityId: id,
    entityLabel: `${existing.clientCode} — ${existing.name}`,
    summary: `حذف العميل ${existing.name} (${existing.clientCode})`,
    ipAddress: clientIp((name) => c.req.header(name)),
  });
  await bumpCacheVersions(db, [CACHE_NAMESPACES.customers, CACHE_NAMESPACES.dashboard, CACHE_NAMESPACES.reports]);
  return c.json({ ok: true, deletedId: id });
});
