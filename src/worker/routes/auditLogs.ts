import { Hono } from 'hono';
import { and, asc, count, desc, eq, gte, lte, or, type SQL } from 'drizzle-orm';
import { auditLogs } from '@/db/schema';
import { AUDIT_MODULES } from '@/shared/auditLog';
import type { AppContextEnv } from '@/worker/types';
import { requireAdmin, requireAuth } from '@/worker/middleware/auth';
import { cairoRangeToEpoch } from '@/worker/services/auditLog';
import { containsLike } from '@/worker/utils/like';

export const auditLogRoutes = new Hono<AppContextEnv>();

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EXPORT_CAP = 5000;

auditLogRoutes.use('*', requireAuth, requireAdmin);

function parseDetails(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

auditLogRoutes.get('/', async (c) => {
  const exportMode = c.req.query('export') === 'true';
  const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1);
  const requestedSize = Number.parseInt(c.req.query('pageSize') ?? '25', 10) || 25;
  const pageSize = exportMode ? EXPORT_CAP : Math.min(100, Math.max(1, requestedSize));
  const moduleName = c.req.query('module')?.trim() ?? '';
  const actorRaw = c.req.query('actorUserId')?.trim() ?? '';
  const from = c.req.query('from')?.trim() ?? '';
  const to = c.req.query('to')?.trim() ?? '';
  const q = (c.req.query('q') ?? '').trim().slice(0, 80);

  if (moduleName && !AUDIT_MODULES.includes(moduleName as (typeof AUDIT_MODULES)[number])) {
    return c.json({ error: 'قسم السجل غير صالح' }, 400);
  }
  if ((from && !DATE_PATTERN.test(from)) || (to && !DATE_PATTERN.test(to))) {
    return c.json({ error: 'صيغة التاريخ يجب أن تكون YYYY-MM-DD' }, 400);
  }
  if (from && to && from > to) {
    return c.json({ error: 'تاريخ البداية بعد تاريخ النهاية' }, 400);
  }

  const filters: SQL[] = [];
  if (moduleName) filters.push(eq(auditLogs.module, moduleName));
  if (actorRaw) {
    const actorUserId = Number.parseInt(actorRaw, 10);
    if (!Number.isFinite(actorUserId)) return c.json({ error: 'معرّف المستخدم غير صالح' }, 400);
    filters.push(eq(auditLogs.actorUserId, actorUserId));
  }
  if (from || to) {
    const bounds = cairoRangeToEpoch(from || to, to || from);
    filters.push(gte(auditLogs.createdAt, bounds.fromMs));
    filters.push(lte(auditLogs.createdAt, bounds.toMs));
  }
  if (q) {
    const search = or(
      containsLike(auditLogs.summary, q),
      containsLike(auditLogs.entityLabel, q),
      containsLike(auditLogs.actorUsername, q),
    );
    if (search) filters.push(search);
  }
  const where = filters.length > 0 ? and(...filters) : undefined;
  const db = c.get('db');
  const totalRow = await db.select({ total: count() }).from(auditLogs).where(where).get();
  const total = totalRow?.total ?? 0;
  const offset = exportMode ? 0 : (page - 1) * pageSize;
  const rows = await db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(pageSize)
    .offset(offset)
    .all();
  const actors = await db
    .selectDistinct({
      id: auditLogs.actorUserId,
      username: auditLogs.actorUsername,
      fullName: auditLogs.actorFullName,
    })
    .from(auditLogs)
    .orderBy(asc(auditLogs.actorFullName), asc(auditLogs.actorUsername))
    .all();

  return c.json({
    logs: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      actorUserId: row.actorUserId,
      actorUsername: row.actorUsername,
      actorFullName: row.actorFullName,
      module: row.module,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      entityLabel: row.entityLabel,
      summary: row.summary,
      details: parseDetails(row.detailsJson),
      ipAddress: row.ipAddress,
    })),
    page: exportMode ? 1 : page,
    pageSize,
    total,
    truncated: exportMode && total > EXPORT_CAP,
    actors,
  });
});
