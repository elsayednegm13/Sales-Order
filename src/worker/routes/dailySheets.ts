import { Hono } from 'hono';
import { and, count, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { clientOrders, dailySheets, type DailySheetRow } from '@/db/schema';
import type { DailySheetListItemDTO } from '@/shared/types';
import type { AppContextEnv } from '@/worker/types';
import { requireAuth, requirePermission } from '@/worker/middleware/auth';
import { createDailySheetSchema, isUniqueConstraintError, readJson, updateDailySheetSchema } from '@/worker/schemas';
import { loadSheetDetail, nextSheetNumber, readLiveNextSheetNumber } from '@/worker/services/dailySheets';
import { bumpCacheVersions, CACHE_NAMESPACES } from '@/worker/cache';
import { recordAuditLog } from '@/worker/services/auditLog';
import { clientIp } from '@/worker/utils/loginRateLimit';
import { chunkedInArrayQuery } from '@/worker/utils/dbChunk';
import { containsLike } from '@/worker/utils/like';

export const dailySheetsRoutes = new Hono<AppContextEnv>();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function mapListItem(row: DailySheetRow, orderCount: number): DailySheetListItemDTO {
  return {
    id: row.id,
    sheetNumber: row.sheetNumber,
    sheetDate: row.sheetDate,
    status: row.status,
    totalCartons: row.totalCartons,
    totalPieces: row.totalPieces,
    totalWeightKg: row.totalWeightKg,
    notes: row.notes,
    createdBy: row.createdBy,
    orderCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

dailySheetsRoutes.use('*', requireAuth);

dailySheetsRoutes.get('/', requirePermission('dailySheets', 'view'), async (c) => {
  const rawStatus = c.req.query('status')?.trim() ?? '';
  if (rawStatus && rawStatus !== 'open' && rawStatus !== 'closed' && rawStatus !== 'archived') {
    return c.json({ error: 'حالة الأوردر غير صالحة' }, 400);
  }
  const status = rawStatus as '' | 'open' | 'closed' | 'archived';
  const search = c.req.query('search')?.trim() ?? '';
  const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1);
  const requestedSize = Number.parseInt(c.req.query('pageSize') ?? '20', 10) || 20;
  const pageSize = Math.min(100, Math.max(1, requestedSize));
  const db = c.get('db');
  const filters: SQL[] = [];
  if (status) filters.push(eq(dailySheets.status, status));
  if (search) filters.push(containsLike(dailySheets.sheetNumber, search));
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [totalRow, rows, suggestion] = await Promise.all([
    db.select({ total: count() }).from(dailySheets).where(where).get(),
    db
      .select()
      .from(dailySheets)
      .where(where)
      .orderBy(desc(dailySheets.sheetDate), desc(dailySheets.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all(),
    nextSheetNumber(db),
  ]);

  const ids = rows.map((row) => row.id);
  const counts = await chunkedInArrayQuery(ids, 75, (chunk) =>
    db
      .select({ sheetId: clientOrders.dailySheetId, total: count() })
      .from(clientOrders)
      .where(and(inArray(clientOrders.dailySheetId, chunk), ne(clientOrders.fulfillmentStatus, 'cancelled')))
      .groupBy(clientOrders.dailySheetId)
      .all(),
  );
  const countMap = new Map(counts.map((row) => [row.sheetId, row.total]));

  return c.json({
    sheets: rows.map((row) => mapListItem(row, countMap.get(row.id) ?? 0)),
    page,
    pageSize,
    total: totalRow?.total ?? 0,
    nextSheetNumber: suggestion,
  });
});

dailySheetsRoutes.post('/', requirePermission('dailySheets', 'create'), async (c) => {
  const parsed = await readJson(c, createDailySheetSchema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const db = c.get('db');
  const explicitNumber = parsed.data.sheetNumber?.trim() ?? '';
  const user = c.get('user');
  const attempts = explicitNumber ? 1 : 4;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt * 25));
    const sheetNumber = explicitNumber || (await readLiveNextSheetNumber(db));
    try {
      const inserted = await db
        .insert(dailySheets)
        .values({
          sheetNumber,
          sheetDate: parsed.data.sheetDate ?? today(),
          status: 'open',
          notes: parsed.data.notes ?? null,
          createdBy: user.id,
          totalCartons: 0,
          totalPieces: 0,
        })
        .returning()
        .get();
      await bumpCacheVersions(db, [CACHE_NAMESPACES.dashboard, CACHE_NAMESPACES.nextSheet, CACHE_NAMESPACES.reports]);
      return c.json({ sheet: mapListItem(inserted, 0) }, 201);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      if (explicitNumber || attempt === attempts - 1) {
        return c.json(
          { error: `رقم الأوردر ${sheetNumber} مستخدم مسبقاً. اختر رقماً آخر.`, code: 'DUPLICATE_SHEET_NUMBER' },
          409,
        );
      }
    }
  }
});

dailySheetsRoutes.get('/:id', requirePermission('dailySheets', 'view'), async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'معرّف الأوردر غير صالح' }, 400);
  const db = c.get('db');
  const sheet = await db.select().from(dailySheets).where(eq(dailySheets.id, id)).get();
  if (!sheet) return c.json({ error: 'أوردر اليوم غير موجود' }, 404);
  return c.json({ sheet: await loadSheetDetail(db, sheet) });
});

dailySheetsRoutes.put('/:id', async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'معرّف الأوردر غير صالح' }, 400);
  const parsed = await readJson(c, updateDailySheetSchema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const db = c.get('db');
  const existing = await db.select().from(dailySheets).where(eq(dailySheets.id, id)).get();
  if (!existing) return c.json({ error: 'أوردر اليوم غير موجود' }, 404);

  const user = c.get('user');
  const can = (action: 'edit' | 'close' | 'archive') =>
    user.role === 'admin' || Boolean(user.permissions.dailySheets[action]);
  const nextSheetNumberValue = parsed.data.sheetNumber?.trim();
  const changesSheetNumber = nextSheetNumberValue !== undefined && nextSheetNumberValue !== existing.sheetNumber;
  const changesDate = parsed.data.sheetDate !== undefined && parsed.data.sheetDate !== existing.sheetDate;
  const changesNotes = parsed.data.notes !== undefined && (parsed.data.notes ?? null) !== (existing.notes ?? null);
  const changesMetadata = changesSheetNumber || changesDate || changesNotes;
  const nextStatus = parsed.data.status;
  const changesStatus = nextStatus !== undefined && nextStatus !== existing.status;
  if (changesMetadata && !can('edit')) {
    return c.json({ error: 'تعديل بيانات الشيت يتطلب صلاحية تعديل بيانات الشيت', code: 'FORBIDDEN' }, 403);
  }
  if (changesStatus && nextStatus) {
    const touchesArchive = existing.status === 'archived' || nextStatus === 'archived';
    const togglesOpenClosed =
      (existing.status === 'open' && nextStatus === 'closed') ||
      (existing.status === 'closed' && nextStatus === 'open');
    if (touchesArchive && !can('archive')) {
      return c.json({ error: 'أرشفة الشيت وإخراجه من الأرشيف يتطلب صلاحية الأرشفة', code: 'FORBIDDEN' }, 403);
    }
    if (togglesOpenClosed && !can('close')) {
      return c.json({ error: 'إغلاق الشيت وإعادة فتحه يتطلب صلاحية الإغلاق', code: 'FORBIDDEN' }, 403);
    }
  }
  const canArchive = can('archive');

  const changesOtherFields = changesMetadata;
  const leavesArchive = existing.status === 'archived' && parsed.data.status !== undefined && parsed.data.status !== 'archived';
  if (existing.status === 'archived') {
    if (leavesArchive && !canArchive) {
      return c.json({ error: 'إخراج الأوردر من الأرشيف متاح لمن يملك صلاحية الأرشفة فقط', code: 'FORBIDDEN' }, 403);
    }
    if (changesOtherFields) {
      return c.json({ error: 'لا يمكن تعديل بيانات أوردر مؤرشف قبل إخراجه من الأرشيف' }, 400);
    }
  }

  const sheetNumber = parsed.data.sheetNumber?.trim() ?? existing.sheetNumber;
  if (sheetNumber !== existing.sheetNumber) {
    const duplicate = await db
      .select({ id: dailySheets.id })
      .from(dailySheets)
      .where(and(sql`lower(${dailySheets.sheetNumber}) = ${sheetNumber.toLowerCase()}`, ne(dailySheets.id, id)))
      .get();
    if (duplicate) {
      return c.json({ error: `رقم الأوردر ${sheetNumber} مستخدم مسبقاً`, code: 'DUPLICATE_SHEET_NUMBER' }, 409);
    }
  }

  try {
    const updated = await db
      .update(dailySheets)
      .set({
        sheetNumber,
        sheetDate: parsed.data.sheetDate ?? existing.sheetDate,
        status: parsed.data.status ?? existing.status,
        notes: parsed.data.notes === undefined ? existing.notes : parsed.data.notes,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(dailySheets.id, id))
      .returning()
      .get();
    const orderCount = await db
      .select({ total: count() })
      .from(clientOrders)
      .where(and(eq(clientOrders.dailySheetId, id), ne(clientOrders.fulfillmentStatus, 'cancelled')))
      .get();
    await bumpCacheVersions(db, [CACHE_NAMESPACES.dashboard, CACHE_NAMESPACES.nextSheet, CACHE_NAMESPACES.reports]);
    const fromStatus = existing.status;
    const toStatus = updated.status;
    const auditAction = (fromStatus === 'open' && toStatus === 'closed') || (fromStatus === 'closed' && toStatus === 'open')
      ? (toStatus === 'closed' ? 'close' : 'reopen')
      : fromStatus !== 'archived' && toStatus === 'archived'
        ? 'archive'
        : fromStatus === 'archived' && toStatus !== 'archived'
          ? 'unarchive'
          : null;
    if (auditAction) {
      const verb = auditAction === 'close' ? 'إغلاق' : auditAction === 'reopen' ? 'إعادة فتح' : auditAction === 'archive' ? 'أرشفة' : 'إخراج من الأرشيف';
      await recordAuditLog(db, {
        actorUserId: user.id,
        actorUsername: user.username,
        actorFullName: user.fullName,
        module: 'dailySheets',
        action: auditAction,
        entityType: 'dailySheet',
        entityId: updated.id,
        entityLabel: updated.sheetNumber,
        summary: `${verb} الشيت ${updated.sheetNumber}`,
        details: { fromStatus, toStatus },
        ipAddress: clientIp((name) => c.req.header(name)),
      });
    }
    return c.json({ sheet: mapListItem(updated, orderCount?.total ?? 0) });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json({ error: `رقم الأوردر ${sheetNumber} مستخدم مسبقاً`, code: 'DUPLICATE_SHEET_NUMBER' }, 409);
    }
    throw error;
  }
});

dailySheetsRoutes.delete('/:id', requirePermission('dailySheets', 'delete'), async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'معرّف الأوردر غير صالح' }, 400);
  const db = c.get('db');
  const existing = await db
    .select({ id: dailySheets.id, status: dailySheets.status, sheetNumber: dailySheets.sheetNumber })
    .from(dailySheets)
    .where(eq(dailySheets.id, id))
    .get();
  if (!existing) return c.json({ error: 'أوردر اليوم غير موجود' }, 404);
  if (existing.status === 'closed' || existing.status === 'archived') {
    return c.json({ error: 'لا يمكن حذف أوردر مغلق أو مؤرشف. أعد فتحه أولاً.' }, 400);
  }
  const linked = await db
    .select({ total: count() })
    .from(clientOrders)
    .where(eq(clientOrders.dailySheetId, id))
    .get();
  const ordersCount = linked?.total ?? 0;
  if (ordersCount > 0) {
    return c.json(
      {
        error: `لا يمكن حذف أوردر اليوم لوجود ${ordersCount} طلب مسجل بداخله؛ احذف الطلبات أولاً أو أرشف الأوردر`,
        code: 'SHEET_HAS_ORDERS',
      },
      400,
    );
  }
  await db.delete(dailySheets).where(eq(dailySheets.id, id));
  const user = c.get('user');
  await recordAuditLog(db, {
    actorUserId: user.id,
    actorUsername: user.username,
    actorFullName: user.fullName,
    module: 'dailySheets',
    action: 'delete_sheet',
    entityType: 'dailySheet',
    entityId: id,
    entityLabel: existing.sheetNumber,
    summary: `حذف الشيت ${existing.sheetNumber}`,
    ipAddress: clientIp((name) => c.req.header(name)),
  });
  await bumpCacheVersions(db, [CACHE_NAMESPACES.dashboard, CACHE_NAMESPACES.nextSheet, CACHE_NAMESPACES.reports]);
  return c.json({ ok: true, deletedId: id });
});
