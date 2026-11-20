import { Hono } from 'hono';
import { and, asc, count, eq, gte, inArray, lte, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { clientOrders, customers, dailySheets, orderItems, products, subMerchants } from '@/db/schema';
import type { AppContextEnv } from '@/worker/types';
import { requireAuth, requirePermission } from '@/worker/middleware/auth';
import { CACHE_NAMESPACES, readVersionedCache } from '@/worker/cache';
import { chunkedInArrayQuery } from '@/worker/utils/dbChunk';
import type {
  DeliveryType,
  FulfillmentCustomerSummaryDTO,
  FulfillmentItemDTO,
  FulfillmentProductSplitDTO,
  ItemType,
  OrderMode,
  ReportChannelDTO,
  ReportCustomerDTO,
  ReportProductTotalDTO,
  ReportSheetProductsDTO,
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
    fulfillment: z.enum(['all', 'dispatched', 'pending']).default('all'),
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

function splitMetrics() {
  return {
    dispatchedOrdersCount: sql<number>`COUNT(DISTINCT CASE WHEN ${clientOrders.fulfillmentStatus} = 'dispatched' THEN ${clientOrders.id} END)`,
    pendingOrdersCount: sql<number>`COUNT(DISTINCT CASE WHEN ${clientOrders.fulfillmentStatus} = 'pending' THEN ${clientOrders.id} END)`,
    dispatchedCartons: sql<number>`COALESCE(SUM(CASE WHEN ${clientOrders.fulfillmentStatus} = 'dispatched' THEN ${orderItems.cartonsQty} ELSE 0 END), 0)`,
    pendingCartons: sql<number>`COALESCE(SUM(CASE WHEN ${clientOrders.fulfillmentStatus} = 'pending' THEN ${orderItems.cartonsQty} ELSE 0 END), 0)`,
    dispatchedPieces: sql<number>`COALESCE(SUM(CASE WHEN ${clientOrders.fulfillmentStatus} = 'dispatched' THEN ${orderItems.totalPieces} ELSE 0 END), 0)`,
    pendingPieces: sql<number>`COALESCE(SUM(CASE WHEN ${clientOrders.fulfillmentStatus} = 'pending' THEN ${orderItems.totalPieces} ELSE 0 END), 0)`,
    dispatchedWeightKg: sql<number>`COALESCE(SUM(CASE WHEN ${clientOrders.fulfillmentStatus} = 'dispatched' THEN ${orderItems.weightKg} ELSE 0 END), 0)`,
    pendingWeightKg: sql<number>`COALESCE(SUM(CASE WHEN ${clientOrders.fulfillmentStatus} = 'pending' THEN ${orderItems.weightKg} ELSE 0 END), 0)`,
  };
}

function readSplit(row: {
  dispatchedOrdersCount: unknown;
  pendingOrdersCount: unknown;
  dispatchedCartons: unknown;
  pendingCartons: unknown;
  dispatchedPieces: unknown;
  pendingPieces: unknown;
  dispatchedWeightKg: unknown;
  pendingWeightKg: unknown;
}) {
  return {
    dispatchedOrdersCount: num(row.dispatchedOrdersCount),
    pendingOrdersCount: num(row.pendingOrdersCount),
    dispatchedCartons: num(row.dispatchedCartons),
    pendingCartons: num(row.pendingCartons),
    dispatchedPieces: num(row.dispatchedPieces),
    pendingPieces: num(row.pendingPieces),
    dispatchedWeightKg: num(row.dispatchedWeightKg),
    pendingWeightKg: num(row.pendingWeightKg),
  };
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
    fulfillment: c.req.query('fulfillment') || undefined,
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
    if (filters.fulfillment === 'dispatched') conditions.push(eq(clientOrders.fulfillmentStatus, 'dispatched'));
    if (filters.fulfillment === 'pending') conditions.push(eq(clientOrders.fulfillmentStatus, 'pending'));
    conditions.push(ne(clientOrders.fulfillmentStatus, 'cancelled'));
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
        ...splitMetrics(),
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
        ...splitMetrics(),
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
        ...splitMetrics(),
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
        ...splitMetrics(),
      })
      .from(orderItems)
      .innerJoin(clientOrders, eq(orderItems.clientOrderId, clientOrders.id))
      .innerJoin(dailySheets, eq(clientOrders.dailySheetId, dailySheets.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(where)
      .groupBy(products.id, products.code, products.name, products.itemType)
      .all();

    const sheetProductQuery = db
      .select({
        sheetId: dailySheets.id,
        sheetNumber: dailySheets.sheetNumber,
        sheetDate: dailySheets.sheetDate,
        productId: products.id,
        productCode: products.code,
        productName: products.name,
        unitType: orderItems.orderMode,
        ordersCount: sql<number>`COUNT(DISTINCT ${clientOrders.id})`,
        totalCartons: sql<number>`COALESCE(SUM(${orderItems.cartonsQty}), 0)`,
        totalPieces: sql<number>`COALESCE(SUM(${orderItems.totalPieces}), 0)`,
        totalWeightKg: sql<number>`COALESCE(SUM(${orderItems.weightKg}), 0)`,
        ...splitMetrics(),
      })
      .from(orderItems)
      .innerJoin(clientOrders, eq(orderItems.clientOrderId, clientOrders.id))
      .innerJoin(dailySheets, eq(clientOrders.dailySheetId, dailySheets.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(where)
      .groupBy(dailySheets.id, dailySheets.sheetNumber, dailySheets.sheetDate, products.id, products.code, products.name, orderItems.orderMode)
      .orderBy(asc(dailySheets.sheetDate), asc(dailySheets.id))
      .all();

    const [summaryRow, customerRows, channelRows, channelProductRows, productRows, sheetProductRows] = await Promise.all([
      summaryQuery,
      customerQuery,
      channelQuery,
      channelProductQuery,
      productQuery,
      sheetProductQuery,
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
      ...readSplit(row),
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
        ...readSplit(row),
        products: [],
      });
    }
    for (const row of channelProductRows) {
      const channel = channels.get(channelKey(row.customerId, row.deliveryType, row.subMerchantId));
      channel?.products.push(toProduct(row));
    }
    for (const channel of channels.values()) {
      channel.products.sort((a, b) => b.totalPieces - a.totalPieces || b.totalWeightKg - a.totalWeightKg);
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
        ...readSplit(row),
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
        ...readSplit(row),
      }))
      .sort((a, b) => b.totalPieces - a.totalPieces || b.totalWeightKg - a.totalWeightKg);

    const sheets = new Map<number, ReportSheetProductsDTO>();
    for (const row of sheetProductRows) {
      const current = sheets.get(row.sheetId) ?? {
        sheetId: row.sheetId,
        sheetNumber: row.sheetNumber,
        sheetDate: row.sheetDate,
        totals: {
          ordersCount: 0,
          totalCartons: 0,
          totalPieces: 0,
          totalWeightKg: 0,
          dispatchedCartons: 0,
          dispatchedPieces: 0,
          dispatchedWeightKg: 0,
          pendingCartons: 0,
          pendingPieces: 0,
          pendingWeightKg: 0,
        },
        products: [],
      };
      const product: ReportProductTotalDTO = {
        productId: row.productId,
        productCode: row.productCode,
        productName: row.productName,
        unitType: row.unitType as ItemType,
        ordersCount: num(row.ordersCount),
        totalCartons: num(row.totalCartons),
        totalPieces: num(row.totalPieces),
        totalWeightKg: num(row.totalWeightKg),
        ...readSplit(row),
      };
      current.products.push(product);
      current.totals.ordersCount += product.ordersCount;
      current.totals.totalCartons += product.totalCartons;
      current.totals.totalPieces += product.totalPieces;
      current.totals.totalWeightKg += product.totalWeightKg;
      current.totals.dispatchedCartons += product.dispatchedCartons;
      current.totals.dispatchedPieces += product.dispatchedPieces;
      current.totals.dispatchedWeightKg += product.dispatchedWeightKg;
      current.totals.pendingCartons += product.pendingCartons;
      current.totals.pendingPieces += product.pendingPieces;
      current.totals.pendingWeightKg += product.pendingWeightKg;
      sheets.set(row.sheetId, current);
    }
    const productsBySheet = [...sheets.values()].map((sheet) => ({
      ...sheet,
      products: sheet.products.sort((a, b) => b.totalPieces - a.totalPieces || b.totalWeightKg - a.totalWeightKg),
    }));

    const payload: SalesReportDTO = {
      period: filters.period,
      label: bounds.label,
      from: bounds.from,
      to: bounds.to,
      summary,
      customers: customerTotals,
      products: productTotals,
      productsBySheet,
    };
    return payload;
  });

  return c.json({ report });
});

const fulfillmentQuerySchema = z.object({
  dateFrom: z.string().regex(datePattern).optional(),
  dateTo: z.string().regex(datePattern).optional(),
  status: z.enum(['all', 'pending', 'dispatched', 'cancelled']).default('all'),
  customerId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

function emptyBucket() {
  return { orders: 0, customers: 0, cartons: 0, pieces: 0, weightKg: 0 };
}

reportsRoutes.get('/fulfillment', requirePermission('reports', 'view'), async (c) => {
  const parsed = fulfillmentQuerySchema.safeParse({
    dateFrom: c.req.query('dateFrom') || undefined,
    dateTo: c.req.query('dateTo') || undefined,
    status: c.req.query('status') || undefined,
    customerId: c.req.query('customerId') || undefined,
    page: c.req.query('page') || undefined,
    pageSize: c.req.query('pageSize') || undefined,
  });
  if (!parsed.success) return c.json({ error: 'معاملات تقرير الخروج غير صالحة' }, 400);
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = parsed.data.dateFrom ?? today;
  const dateTo = parsed.data.dateTo ?? today;
  if (dateFrom > dateTo) return c.json({ error: 'تاريخ البداية بعد تاريخ النهاية' }, 400);

  const filters = parsed.data;
  const db = c.get('db');
  const report = await readVersionedCache(
    db,
    CACHE_NAMESPACES.reports,
    `fulfillment:${JSON.stringify({ ...filters, dateFrom, dateTo })}`,
    async () => {
      const summaryConditions: SQL[] = [gte(dailySheets.sheetDate, dateFrom), lte(dailySheets.sheetDate, dateTo)];
      if (filters.customerId) summaryConditions.push(eq(clientOrders.customerId, filters.customerId));
      const summaryWhere = and(...summaryConditions);
      const listConditions = [...summaryConditions];
      if (filters.status !== 'all') listConditions.push(eq(clientOrders.fulfillmentStatus, filters.status));
      const listWhere = and(...listConditions);
      const offset = (filters.page - 1) * filters.pageSize;

      const activeSummary = and(...summaryConditions, ne(clientOrders.fulfillmentStatus, 'cancelled'));
      const [grouped, totalRow, rows, customerStatusRows, customerProductRows] = await Promise.all([
        db
          .select({
            status: clientOrders.fulfillmentStatus,
            orders: sql<number>`COUNT(*)`,
            customers: sql<number>`COUNT(DISTINCT ${clientOrders.customerId})`,
            cartons: sql<number>`COALESCE(SUM(${clientOrders.totalCartons}), 0)`,
            pieces: sql<number>`COALESCE(SUM(${clientOrders.totalPieces}), 0)`,
            weightKg: sql<number>`COALESCE(SUM(${clientOrders.totalWeightKg}), 0)`,
          })
          .from(clientOrders)
          .innerJoin(dailySheets, eq(clientOrders.dailySheetId, dailySheets.id))
          .where(summaryWhere)
          .groupBy(clientOrders.fulfillmentStatus)
          .all(),
        db
          .select({ total: count() })
          .from(clientOrders)
          .innerJoin(dailySheets, eq(clientOrders.dailySheetId, dailySheets.id))
          .where(listWhere)
          .get(),
        db
          .select({
            id: clientOrders.id,
            sheetNumber: dailySheets.sheetNumber,
            orderSequence: sql<number>`(
              SELECT COUNT(*)
              FROM client_orders AS seq_orders
              WHERE seq_orders.daily_sheet_id = ${clientOrders.dailySheetId}
                AND seq_orders.id <= ${clientOrders.id}
            )`,
            sheetDate: dailySheets.sheetDate,
            customerName: customers.name,
            customerCode: customers.clientCode,
            recipientName: clientOrders.recipientName,
            subMerchantName: subMerchants.name,
            totalCartons: clientOrders.totalCartons,
            totalPieces: clientOrders.totalPieces,
            totalWeightKg: clientOrders.totalWeightKg,
            fulfillmentStatus: clientOrders.fulfillmentStatus,
            dispatchedAt: clientOrders.dispatchedAt,
            cancelledAt: clientOrders.cancelledAt,
          })
          .from(clientOrders)
          .innerJoin(dailySheets, eq(clientOrders.dailySheetId, dailySheets.id))
          .innerJoin(customers, eq(clientOrders.customerId, customers.id))
          .leftJoin(subMerchants, eq(clientOrders.subMerchantId, subMerchants.id))
          .where(listWhere)
          .orderBy(asc(dailySheets.sheetDate), asc(dailySheets.id), asc(clientOrders.id))
          .limit(filters.pageSize)
          .offset(offset)
          .all(),
        db
          .select({
            customerId: customers.id,
            clientCode: customers.clientCode,
            customerName: customers.name,
            status: clientOrders.fulfillmentStatus,
            orders: sql<number>`COUNT(DISTINCT ${clientOrders.id})`,
            cartons: sql<number>`COALESCE(SUM(${clientOrders.totalCartons}), 0)`,
            pieces: sql<number>`COALESCE(SUM(${clientOrders.totalPieces}), 0)`,
            weightKg: sql<number>`COALESCE(SUM(${clientOrders.totalWeightKg}), 0)`,
          })
          .from(clientOrders)
          .innerJoin(dailySheets, eq(clientOrders.dailySheetId, dailySheets.id))
          .innerJoin(customers, eq(clientOrders.customerId, customers.id))
          .where(activeSummary)
          .groupBy(customers.id, customers.clientCode, customers.name, clientOrders.fulfillmentStatus)
          .all(),
        db
          .select({
            customerId: clientOrders.customerId,
            status: clientOrders.fulfillmentStatus,
            productId: products.id,
            productCode: products.code,
            productName: products.name,
            cartons: sql<number>`COALESCE(SUM(${orderItems.cartonsQty}), 0)`,
            pieces: sql<number>`COALESCE(SUM(${orderItems.totalPieces}), 0)`,
            weightKg: sql<number>`COALESCE(SUM(${orderItems.weightKg}), 0)`,
          })
          .from(orderItems)
          .innerJoin(clientOrders, eq(orderItems.clientOrderId, clientOrders.id))
          .innerJoin(dailySheets, eq(clientOrders.dailySheetId, dailySheets.id))
          .innerJoin(products, eq(orderItems.productId, products.id))
          .where(activeSummary)
          .groupBy(clientOrders.customerId, clientOrders.fulfillmentStatus, products.id, products.code, products.name)
          .all(),
      ]);

      const itemRows = await chunkedInArrayQuery(rows.map((row) => row.id), 75, (chunk) =>
        db
          .select({
            orderId: orderItems.clientOrderId,
            productCode: products.code,
            productName: products.name,
            orderMode: orderItems.orderMode,
            cartonsQty: orderItems.cartonsQty,
            totalPieces: orderItems.totalPieces,
            weightKg: orderItems.weightKg,
          })
          .from(orderItems)
          .innerJoin(products, eq(orderItems.productId, products.id))
          .where(inArray(orderItems.clientOrderId, chunk))
          .all(),
      );
      const itemsByOrder = new Map<number, FulfillmentItemDTO[]>();
      for (const item of itemRows) {
        const list = itemsByOrder.get(item.orderId) ?? [];
        list.push({
          productCode: item.productCode,
          productName: item.productName,
          orderMode: item.orderMode as OrderMode,
          cartonsQty: item.cartonsQty,
          totalPieces: item.totalPieces,
          weightKg: num(item.weightKg),
        });
        itemsByOrder.set(item.orderId, list);
      }

      const customersById = new Map<number, FulfillmentCustomerSummaryDTO>();
      for (const row of customerStatusRows) {
        const current = customersById.get(row.customerId) ?? {
          customerId: row.customerId,
          clientCode: row.clientCode,
          customerName: row.customerName,
          dispatchedOrdersCount: 0,
          pendingOrdersCount: 0,
          dispatchedCartons: 0,
          dispatchedPieces: 0,
          dispatchedWeightKg: 0,
          pendingCartons: 0,
          pendingPieces: 0,
          pendingWeightKg: 0,
          products: [],
        };
        if (row.status === 'dispatched') {
          current.dispatchedOrdersCount = num(row.orders);
          current.dispatchedCartons = num(row.cartons);
          current.dispatchedPieces = num(row.pieces);
          current.dispatchedWeightKg = num(row.weightKg);
        } else if (row.status === 'pending') {
          current.pendingOrdersCount = num(row.orders);
          current.pendingCartons = num(row.cartons);
          current.pendingPieces = num(row.pieces);
          current.pendingWeightKg = num(row.weightKg);
        }
        customersById.set(row.customerId, current);
      }
      const productsByCustomer = new Map<number, Map<number, FulfillmentProductSplitDTO>>();
      for (const row of customerProductRows) {
        const productsForCustomer = productsByCustomer.get(row.customerId) ?? new Map<number, FulfillmentProductSplitDTO>();
        const product = productsForCustomer.get(row.productId) ?? {
          productId: row.productId,
          productCode: row.productCode,
          productName: row.productName,
          dispatchedCartons: 0,
          dispatchedPieces: 0,
          dispatchedWeightKg: 0,
          pendingCartons: 0,
          pendingPieces: 0,
          pendingWeightKg: 0,
        };
        if (row.status === 'dispatched') {
          product.dispatchedCartons = num(row.cartons);
          product.dispatchedPieces = num(row.pieces);
          product.dispatchedWeightKg = num(row.weightKg);
        } else if (row.status === 'pending') {
          product.pendingCartons = num(row.cartons);
          product.pendingPieces = num(row.pieces);
          product.pendingWeightKg = num(row.weightKg);
        }
        productsForCustomer.set(row.productId, product);
        productsByCustomer.set(row.customerId, productsForCustomer);
      }
      const customerSummary = [...customersById.values()]
        .map((customer) => ({
          ...customer,
          products: [...(productsByCustomer.get(customer.customerId)?.values() ?? [])].sort(
            (a, b) => b.dispatchedPieces + b.pendingPieces - (a.dispatchedPieces + a.pendingPieces),
          ),
        }))
        .sort((a, b) => b.dispatchedOrdersCount + b.pendingOrdersCount - (a.dispatchedOrdersCount + a.pendingOrdersCount));

      const bucket = (status: 'pending' | 'dispatched' | 'cancelled') => {
        const row = grouped.find((item) => item.status === status);
        if (!row) return emptyBucket();
        return {
          orders: num(row.orders),
          customers: num(row.customers),
          cartons: num(row.cartons),
          pieces: num(row.pieces),
          weightKg: num(row.weightKg),
        };
      };
      const dispatched = bucket('dispatched');
      const pending = bucket('pending');
      const cancelled = bucket('cancelled');
      return {
        from: dateFrom,
        to: dateTo,
        summary: {
          dispatchedCustomers: dispatched.customers,
          pendingCustomers: pending.customers,
          dispatched,
          pending,
          cancelled,
        },
        customerSummary,
        orders: rows.map((row) => ({
          id: row.id,
          sheetNumber: row.sheetNumber,
          orderSequence: num(row.orderSequence),
          sheetDate: row.sheetDate,
          customerName: row.customerName,
          customerCode: row.customerCode,
          receiverName: row.subMerchantName || row.recipientName || '',
          totalCartons: row.totalCartons,
          totalPieces: row.totalPieces,
          totalWeightKg: num(row.totalWeightKg),
          fulfillmentStatus: row.fulfillmentStatus,
          dispatchedAt: row.dispatchedAt,
          cancelledAt: row.cancelledAt,
          items: itemsByOrder.get(row.id) ?? [],
        })),
        page: filters.page,
        pageSize: filters.pageSize,
        total: totalRow?.total ?? 0,
      };
    },
  );

  return c.json({ report });
});
