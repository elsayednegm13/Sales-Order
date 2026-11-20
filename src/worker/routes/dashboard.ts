import { Hono } from 'hono';
import { and, count, desc, eq, ne, sql } from 'drizzle-orm';
import { clientOrders, customers, dailySheets, products, subMerchants } from '@/db/schema';
import type { AppContextEnv } from '@/worker/types';
import { requireAuth, requirePermission } from '@/worker/middleware/auth';
import { CACHE_NAMESPACES, dashboardCacheEtag, ifNoneMatchSatisfied, readCacheVersion, readVersionedCache } from '@/worker/cache';

export const dashboardRoutes = new Hono<AppContextEnv>();

dashboardRoutes.use('*', requireAuth);

dashboardRoutes.get('/stats', requirePermission('dailySheets', 'view'), async (c) => {
  const db = c.get('db');
  const etag = dashboardCacheEtag(await readCacheVersion(db, CACHE_NAMESPACES.dashboard));
  if (ifNoneMatchSatisfied(c.req.header('If-None-Match'), etag)) {
    c.header('ETag', etag);
    c.header('Cache-Control', 'private, no-cache');
    return c.body(null, 304);
  }
  const stats = await readVersionedCache(db, CACHE_NAMESPACES.dashboard, 'stats', async () => {
  const openOnly = eq(dailySheets.status, 'open');
  const latest = await db
    .select({ sheetDate: sql<string>`MAX(${dailySheets.sheetDate})` })
    .from(dailySheets)
    .get();
  const onLatestDay = () =>
    latest?.sheetDate ? eq(dailySheets.sheetDate, latest.sheetDate) : eq(dailySheets.status, 'open');
  const [activeProducts, customerCount, merchantCount, openSheets, openTotals, todayOrders, recent] =
    await Promise.all([
      db.select({ total: count() }).from(products).where(eq(products.isActive, true)).get(),
      db.select({ total: count() }).from(customers).get(),
      db.select({ total: count() }).from(subMerchants).get(),
      db.select({ total: count() }).from(dailySheets).where(openOnly).get(),
      db
        .select({
          cartons: sql<number>`COALESCE(SUM(${dailySheets.totalCartons}), 0)`,
          pieces: sql<number>`COALESCE(SUM(${dailySheets.totalPieces}), 0)`,
          weight: sql<number>`COALESCE(SUM(${dailySheets.totalWeightKg}), 0)`,
        })
        .from(dailySheets)
        .where(onLatestDay())
        .get(),
      db
        .select({ total: count() })
        .from(clientOrders)
        .innerJoin(dailySheets, eq(clientOrders.dailySheetId, dailySheets.id))
        .where(and(onLatestDay(), ne(clientOrders.fulfillmentStatus, 'cancelled')))
        .get(),
      db
        .select({
          id: dailySheets.id,
          sheetNumber: dailySheets.sheetNumber,
          sheetDate: dailySheets.sheetDate,
          status: dailySheets.status,
          totalCartons: dailySheets.totalCartons,
          totalPieces: dailySheets.totalPieces,
          totalWeightKg: dailySheets.totalWeightKg,
          updatedAt: dailySheets.updatedAt,
        })
        .from(dailySheets)
        .orderBy(desc(dailySheets.updatedAt))
        .limit(5)
        .all(),
    ]);

  return {
      activeProducts: activeProducts?.total ?? 0,
      customers: customerCount?.total ?? 0,
      subMerchants: merchantCount?.total ?? 0,
      openDailySheets: openSheets?.total ?? 0,
      openCartons: Number(openTotals?.cartons ?? 0),
      openPieces: Number(openTotals?.pieces ?? 0),
      todayOrderCount: todayOrders?.total ?? 0,
      openWeightKg: Number(openTotals?.weight ?? 0),
      recentSheets: recent,
    };
  });
  c.header('ETag', etag);
  c.header('Cache-Control', 'private, no-cache');
  return c.json({ stats });
});
