import { Hono } from 'hono';
import { and, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { clientOrders, customers, dailySheets, orderItems, products, subMerchants } from '@/db/schema';
import type { AppContextEnv } from '@/worker/types';
import { requireAuth, requirePermission } from '@/worker/middleware/auth';
import { CACHE_NAMESPACES, readVersionedCache } from '@/worker/cache';
import type {
  DeliveryType,
  ItemType,
  ReportChannelDTO,
  ReportCustomerDTO,
  ReportProductTotalDTO,
  ReportSummaryDTO,
  SalesReportDTO,
} from '@/shared/types';

export const reportsRoutes = new Hono<AppContextEnv>();

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const monthPattern = /^\d{4}-\d{2}$/;
const yearPattern = /^\d{4}$/;

const querySchema = z
  .object({
    period: z.enum(['daily', 'monthly', 'yearly', 'custom']),
    date: z.string().regex(datePattern).optional(),
    month: z.string().regex(monthPattern).optional(),
    year: z.string().regex(yearPattern).optional(),
    from: z.string().regex(datePattern).optional(),
    to: z.string().regex(datePattern).optional(),
    customerId: z.coerce.number().int().positive().optional(),
    subMerchantId: z.coerce.number().int().positive().optional(),
    productId: z.coerce.number().int().positive().optional(),
    deliveryType: z.enum(['all', 'warehouse', 'sub_merchant']).default('all'),
    status: z.enum(['all', 'open', 'closed']).default('all'),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.period === 'daily' && !value.date) context.addIssue({ code: 'custom', message: 'حدد تاريخ اليوم', path: ['date'] });
    if (value.period === 'monthly' && !value.month) context.addIssue({ code: 'custom', message: 'حدد الشهر', path: ['month'] });
    if (value.period === 'yearly' && !value.year) context.addIssue({ code: 'custom', message: 'حدد السنة', path: ['year'] });
    if (value.period === 'custom' && (!value.from || !value.to || value.from > value.to)) {
      context.addIssue({ code: 'custom', message: 'حدد فترة صحيحة', path: ['from'] });
    }
  });

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function periodBounds(input: z.infer<typeof querySchema>): { from: string; to: string; label: string } {
  if (input.period === 'daily') return { from: input.date!, to: input.date!, label: input.date! };
  if (input.period === 'monthly') {
    const [year, month] = input.month!.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return { from: `${input.month}-01`, to: `${input.month}-${String(lastDay).padStart(2, '0')}`, label: input.month! };
  }
  if (input.period === 'yearly') return { from: `${input.year}-01-01`, to: `${input.year}-12-31`, label: input.year! };
  return { from: input.from!, to: input.to!, label: `${input.from} → ${input.to}` };
}

reportsRoutes.use('*', requireAuth);

reportsRoutes.get('/', requirePermission('reports', 'view'), async (c) => {
  const parsed = querySchema.safeParse({
    period: c.req.query('period'),
    date: c.req.query('date') || undefined,
    month: c.req.query('month') || undefined,
    year: c.req.query('year') || undefined,
    from: c.req.query('from') || undefined,
    to: c.req.query('to') || undefined,
    customerId: c.req.query('customerId') || undefined,
    subMerchantId: c.req.query('subMerchantId') || undefined,
    productId: c.req.query('productId') || undefined,
    deliveryType: c.req.query('deliveryType') || undefined,
    status: c.req.query('status') || undefined,
  });
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'معايير التقرير غير صالحة', code: 'VALIDATION_ERROR' }, 400);
  }

  const filters = parsed.data;
  const bounds = periodBounds(filters);
  const db = c.get('db');
  const cacheSuffix = JSON.stringify({ ...filters, ...bounds });
  const report = await readVersionedCache(db, CACHE_NAMESPACES.reports, cacheSuffix, async () => {
    const conditions: SQL[] = [gte(dailySheets.sheetDate, bounds.from), lte(dailySheets.sheetDate, bounds.to)];
    if (filters.customerId) conditions.push(eq(clientOrders.customerId, filters.customerId));
    if (filters.subMerchantId) conditions.push(eq(clientOrders.subMerchantId, filters.subMerchantId));
    if (filters.productId) conditions.push(eq(orderItems.productId, filters.productId));
    if (filters.deliveryType === 'warehouse') conditions.push(eq(clientOrders.deliveryType, 'client_warehouse'));
    if (filters.deliveryType === 'sub_merchant') conditions.push(eq(clientOrders.deliveryType, 'sub_merchant'));
    if (filters.status !== 'all') conditions.push(eq(dailySheets.status, filters.status));
    const where = and(...conditions);

    const summaryQuery = db
      .select({
        totalSheets: sql<number>`COUNT(DISTINCT ${dailySheets.id})`,
        totalOrders: sql<number>`COUNT(DISTINCT ${clientOrders.id})`,
        totalCartons: sql<number>`COALESCE(SUM(${orderItems.cartonsQty}), 0)`,
        totalPieces: sql<number>`COALESCE(SUM(${orderItems.totalPieces}), 0)`,
        totalWeightKg: sql<number>`COALESCE(SUM(${orderItems.weightKg}), 0)`,
        uniqueCustomers: sql<number>`COUNT(DISTINCT ${clientOrders.customerId})`,
      })
      .from(orderItems)
      .innerJoin(clientOrders, eq(orderItems.clientOrderId, clientOrders.id))
      .innerJoin(dailySheets, eq(clientOrders.dailySheetId, dailySheets.id))
      .where(where)
      .get();

    const customerQuery = db
      .select({
        customerId: customers.id,
        clientCode: customers.clientCode,
        customerName: customers.name,
        ordersCount: sql<number>`COUNT(DISTINCT ${clientOrders.id})`,
        totalCartons: sql<number>`COALESCE(SUM(${orderItems.cartonsQty}), 0)`,
        totalPieces: sql<number>`COALESCE(SUM(${orderItems.totalPieces}), 0)`,
        totalWeightKg: sql<number>`COALESCE(SUM(${orderItems.weightKg}), 0)`,
      })
      .from(orderItems)
      .innerJoin(clientOrders, eq(orderItems.clientOrderId, clientOrders.id))
      .innerJoin(dailySheets, eq(clientOrders.dailySheetId, dailySheets.id))
      .innerJoin(customers, eq(clientOrders.customerId, customers.id))
      .where(where)
      .groupBy(customers.id, customers.clientCode, customers.name)
      .all();

    const channelQuery = db
      .select({
        customerId: clientOrders.customerId,
        deliveryType: clientOrders.deliveryType,
        subMerchantId: clientOrders.subMerchantId,
        subMerchantName: subMerchants.name,
        ordersCount: sql<number>`COUNT(DISTINCT ${clientOrders.id})`,
        totalCartons: sql<number>`COALESCE(SUM(${orderItems.cartonsQty}), 0)`,
        totalPieces: sql<number>`COALESCE(SUM(${orderItems.totalPieces}), 0)`,
        totalWeightKg: sql<number>`COALESCE(SUM(${orderItems.weightKg}), 0)`,
      })
      .from(orderItems)
      .innerJoin(clientOrders, eq(orderItems.clientOrderId, clientOrders.id))
      .innerJoin(dailySheets, eq(clientOrders.dailySheetId, dailySheets.id))
      .leftJoin(subMerchants, eq(clientOrders.subMerchantId, subMerchants.id))
      .where(where)
      .groupBy(clientOrders.customerId, clientOrders.deliveryType, clientOrders.subMerchantId, subMerchants.name)
      .all();

    const channelProductQuery = db
      .select({
        customerId: clientOrders.customerId,
        deliveryType: clientOrders.deliveryType,
        subMerchantId: clientOrders.subMerchantId,
        productId: products.id,
        productCode: products.code,
        productName: products.name,
        unitType: products.itemType,
        ordersCount: sql<number>`COUNT(DISTINCT ${clientOrders.id})`,
        totalCartons: sql<number>`COALESCE(SUM(${orderItems.cartonsQty}), 0)`,
        totalPieces: sql<number>`COALESCE(SUM(${orderItems.totalPieces}), 0)`,
        totalWeightKg: sql<number>`COALESCE(SUM(${orderItems.weightKg}), 0)`,
      })
      .from(orderItems)
      .innerJoin(clientOrders, eq(orderItems.clientOrderId, clientOrders.id))
      .innerJoin(dailySheets, eq(clientOrders.dailySheetId, dailySheets.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(where)
      .groupBy(clientOrders.customerId, clientOrders.deliveryType, clientOrders.subMerchantId, products.id, products.code, products.name, products.itemType)
      .all();

    const productQuery = db
      .select({
        productId: products.id,
        productCode: products.code,
        productName: products.name,
        unitType: products.itemType,
        ordersCount: sql<number>`COUNT(DISTINCT ${clientOrders.id})`,
        totalCartons: sql<number>`COALESCE(SUM(${orderItems.cartonsQty}), 0)`,
        totalPieces: sql<number>`COALESCE(SUM(${orderItems.totalPieces}), 0)`,
        totalWeightKg: sql<number>`COALESCE(SUM(${orderItems.weightKg}), 0)`,
      })
      .from(orderItems)
      .innerJoin(clientOrders, eq(orderItems.clientOrderId, clientOrders.id))
      .innerJoin(dailySheets, eq(clientOrders.dailySheetId, dailySheets.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(where)
      .groupBy(products.id, products.code, products.name, products.itemType)
      .all();

    const [summaryRow, customerRows, channelRows, channelProductRows, productRows] = await Promise.all([
      summaryQuery,
      customerQuery,
      channelQuery,
      channelProductQuery,
      productQuery,
    ]);

    const summary: ReportSummaryDTO = {
      totalSheets: num(summaryRow?.totalSheets),
      totalOrders: num(summaryRow?.totalOrders),
      totalCartons: num(summaryRow?.totalCartons),
      totalPieces: num(summaryRow?.totalPieces),
      totalWeightKg: num(summaryRow?.totalWeightKg),
      uniqueCustomers: num(summaryRow?.uniqueCustomers),
    };

    const toProduct = (row: (typeof channelProductRows)[number]): ReportProductTotalDTO => ({
      productId: row.productId,
      productCode: row.productCode,
      productName: row.productName,
      unitType: row.unitType as ItemType,
      ordersCount: num(row.ordersCount),
      totalCartons: num(row.totalCartons),
      totalPieces: num(row.totalPieces),
      totalWeightKg: num(row.totalWeightKg),
    });

    const channelKey = (customerId: number, deliveryType: string, subMerchantId: number | null) =>
      `${customerId}:${deliveryType}:${subMerchantId ?? 0}`;

    const channels = new Map<string, ReportChannelDTO>();
    for (const row of channelRows) {
      channels.set(channelKey(row.customerId, row.deliveryType, row.subMerchantId), {
        deliveryType: row.deliveryType as DeliveryType,
        subMerchantId: row.subMerchantId,
        subMerchantName: row.subMerchantName,
        ordersCount: num(row.ordersCount),
        totalCartons: num(row.totalCartons),
        totalPieces: num(row.totalPieces),
        totalWeightKg: num(row.totalWeightKg),
        products: [],
      });
    }
    for (const row of channelProductRows) {
      const channel = channels.get(channelKey(row.customerId, row.deliveryType, row.subMerchantId));
      channel?.products.push(toProduct(row));
    }
    for (const channel of channels.values()) {
      channel.products.sort((a, b) => b.totalPieces - a.totalPieces || b.totalWeightKg - a.totalWeightKg);
      channel.products = channel.products.slice(0, 8);
    }

    const channelsByCustomer = new Map<number, ReportChannelDTO[]>();
    for (const [key, channel] of channels) {
      const customerId = Number(key.split(':')[0]);
      const list = channelsByCustomer.get(customerId) ?? [];
      list.push(channel);
      channelsByCustomer.set(customerId, list);
    }

    const customerTotals: ReportCustomerDTO[] = customerRows
      .map((row) => ({
        customerId: row.customerId,
        clientCode: row.clientCode,
        customerName: row.customerName,
        ordersCount: num(row.ordersCount),
        totalCartons: num(row.totalCartons),
        totalPieces: num(row.totalPieces),
        totalWeightKg: num(row.totalWeightKg),
        channels: (channelsByCustomer.get(row.customerId) ?? []).sort((a, b) => b.totalPieces - a.totalPieces),
      }))
      .sort((a, b) => b.totalCartons - a.totalCartons || b.totalPieces - a.totalPieces);

    const productTotals: ReportProductTotalDTO[] = productRows
      .map((row) => ({
        productId: row.productId,
        productCode: row.productCode,
        productName: row.productName,
        unitType: row.unitType as ItemType,
        ordersCount: num(row.ordersCount),
        totalCartons: num(row.totalCartons),
        totalPieces: num(row.totalPieces),
        totalWeightKg: num(row.totalWeightKg),
      }))
      .sort((a, b) => b.totalPieces - a.totalPieces || b.totalWeightKg - a.totalWeightKg);

    const payload: SalesReportDTO = {
      period: filters.period,
      label: bounds.label,
      from: bounds.from,
      to: bounds.to,
      summary,
      customers: customerTotals,
      products: productTotals,
    };
    return payload;
  });

  return c.json({ report });
});
