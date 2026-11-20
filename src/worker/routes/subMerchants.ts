import { Hono } from 'hono';
import { count, eq } from 'drizzle-orm';
import { clientOrders, customers, subMerchants, type SubMerchantRow } from '@/db/schema';
import type { SubMerchantDTO } from '@/shared/types';
import type { AppContextEnv } from '@/worker/types';
import { requireAuth, requirePermission } from '@/worker/middleware/auth';
import { bumpCacheVersions, CACHE_NAMESPACES } from '@/worker/cache';
import { recordAuditLog } from '@/worker/services/auditLog';
import { clientIp } from '@/worker/utils/loginRateLimit';
import { createSubMerchantSchema, readJson, updateSubMerchantSchema } from '@/worker/schemas';

export const subMerchantsRoutes = new Hono<AppContextEnv>();

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

subMerchantsRoutes.use('*', requireAuth);

subMerchantsRoutes.post('/', requirePermission('customers', 'manage'), async (c) => {
  const parsed = await readJson(c, createSubMerchantSchema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const customerId = Number(body.customerId);
  if (!Number.isInteger(customerId) || customerId < 1) {
    return c.json({ error: 'يجب تحديد العميل التابع له التاجر' }, 400);
  }
  const name = body.name?.trim() ?? '';
  if (name.length < 2 || name.length > 120) {
    return c.json({ error: 'يرجى إدخال اسم التاجر (من حرفين حتى 120 حرفاً)' }, 400);
  }
  const phone = readOptionalText(body.phone, 40);
  const location = readOptionalText(body.location, 160);
  if (!phone.ok || !location.ok) {
    return c.json({ error: 'رقم الهاتف أو العنوان أطول من الحد المسموح' }, 400);
  }

  const db = c.get('db');
  const customer = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, customerId))
    .get();
  if (!customer) {
    return c.json({ error: 'العميل غير موجود' }, 404);
  }

  const inserted = await db
    .insert(subMerchants)
    .values({
      customerId,
      name,
      phone: phone.value,
      location: location.value,
    })
    .returning()
    .get();

  await bumpCacheVersions(c.get('db'), [CACHE_NAMESPACES.customers, CACHE_NAMESPACES.dashboard, CACHE_NAMESPACES.reports]);
  return c.json({ subMerchant: mapSubMerchant(inserted) }, 201);
});

subMerchantsRoutes.put('/:id', requirePermission('customers', 'manage'), async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) {
    return c.json({ error: 'معرّف التاجر غير صالح' }, 400);
  }

  const parsed = await readJson(c, updateSubMerchantSchema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const db = c.get('db');
  const existing = await db.select().from(subMerchants).where(eq(subMerchants.id, id)).get();
  if (!existing) {
    return c.json({ error: 'التاجر غير موجود' }, 404);
  }

  const name = body.name !== undefined ? body.name.trim() : existing.name;
  if (name.length < 2 || name.length > 120) {
    return c.json({ error: 'يرجى إدخال اسم التاجر (من حرفين حتى 120 حرفاً)' }, 400);
  }

  let phone = existing.phone;
  if (body.phone !== undefined) {
    const parsed = readOptionalText(body.phone, 40);
    if (!parsed.ok) {
      return c.json({ error: 'رقم الهاتف أطول من الحد المسموح' }, 400);
    }
    phone = parsed.value;
  }

  let location = existing.location;
  if (body.location !== undefined) {
    const parsed = readOptionalText(body.location, 160);
    if (!parsed.ok) {
      return c.json({ error: 'العنوان أطول من الحد المسموح' }, 400);
    }
    location = parsed.value;
  }

  const updated = await db
    .update(subMerchants)
    .set({ name, phone, location })
    .where(eq(subMerchants.id, id))
    .returning()
    .get();

  await bumpCacheVersions(c.get('db'), [CACHE_NAMESPACES.customers, CACHE_NAMESPACES.dashboard, CACHE_NAMESPACES.reports]);
  return c.json({ subMerchant: mapSubMerchant(updated) });
});

subMerchantsRoutes.delete('/:id', requirePermission('customers', 'deleteSubMerchant'), async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) {
    return c.json({ error: 'معرّف التاجر غير صالح' }, 400);
  }

  const db = c.get('db');
  const existing = await db.select({ id: subMerchants.id, name: subMerchants.name }).from(subMerchants).where(eq(subMerchants.id, id)).get();
  if (!existing) {
    return c.json({ error: 'التاجر غير موجود' }, 404);
  }

  const linked = await db
    .select({ total: count() })
    .from(clientOrders)
    .where(eq(clientOrders.subMerchantId, id))
    .get();

  if (linked && linked.total > 0) {
    return c.json(
      {
        error: 'لا يمكن حذف هذا التاجر لارتباطه بطلبات تسليم مسجّلة.',
        code: 'SUB_MERCHANT_IN_USE',
      },
      400
    );
  }

  await db.delete(subMerchants).where(eq(subMerchants.id, id));
  const user = c.get('user');
  await recordAuditLog(db, {
    actorUserId: user.id,
    actorUsername: user.username,
    actorFullName: user.fullName,
    module: 'customers',
    action: 'delete_sub_merchant',
    entityType: 'subMerchant',
    entityId: id,
    entityLabel: existing.name,
    summary: `حذف التاجر الفرعي ${existing.name}`,
    ipAddress: clientIp((name) => c.req.header(name)),
  });
  await bumpCacheVersions(c.get('db'), [CACHE_NAMESPACES.customers, CACHE_NAMESPACES.dashboard, CACHE_NAMESPACES.reports]);
  return c.json({ ok: true, deletedId: id });
});
