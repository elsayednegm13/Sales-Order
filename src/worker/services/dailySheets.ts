import { asc, eq, inArray, sql } from 'drizzle-orm';
import {
  clientOrders,
  customers,
  dailySheets,
  orderItems,
  products,
  subMerchants,
  systemSettings,
  type ClientOrderRow,
  type DailySheetRow,
  type ProductRow,
} from '@/db/schema';
import type { AppDatabase } from '@/db';
import { CACHE_NAMESPACES, readVersionedCache } from '@/worker/cache';
import { chunkedInArrayQuery } from '@/worker/utils/dbChunk';
import { calculateOrderItemTotals, computeNextSheetNumber } from '@/shared/domain';
import type { ClientOrderDetailDTO, DailySheetDetailDTO, OrderItemDetailDTO, OrderMode } from '@/shared/types';

export interface ParsedOrderItem {
  productId: number;
  orderMode: OrderMode;
  cartonsQty: number;
  loosePiecesQty: number;
  weightKg: number;
  notes?: string | null;
}

async function computeStoredNextSheetNumber(db: AppDatabase): Promise<string> {
  const settings = await db
    .select({ startingOrderNumber: systemSettings.startingOrderNumber })
    .from(systemSettings)
    .where(eq(systemSettings.id, 1))
    .get();

  const maxRow = await db
    .select({
      maxNum: sql<number | null>`MAX(CAST(${dailySheets.sheetNumber} AS INTEGER))`,
    })
    .from(dailySheets)
    .where(sql`${dailySheets.sheetNumber} != '' AND ${dailySheets.sheetNumber} NOT GLOB '*[^0-9]*'`)
    .get();

  return computeNextSheetNumber(settings?.startingOrderNumber ?? 1000, maxRow?.maxNum ?? null);
}

export async function nextSheetNumber(db: AppDatabase): Promise<string> {
  return readVersionedCache(db, CACHE_NAMESPACES.nextSheet, 'current', () => computeStoredNextSheetNumber(db));
}

/** Bypasses the next-sheet cache so a collided auto-allocation can read the latest number. */
export async function readLiveNextSheetNumber(db: AppDatabase): Promise<string> {
  return computeStoredNextSheetNumber(db);
}

export function syncSheetTotals(db: AppDatabase, sheetId: number) {
  return db
    .update(dailySheets)
    .set({
      totalCartons: sql`(SELECT COALESCE(SUM(${clientOrders.totalCartons}), 0) FROM ${clientOrders} WHERE ${clientOrders.dailySheetId} = ${sheetId})`,
      totalPieces: sql`(SELECT COALESCE(SUM(${clientOrders.totalPieces}), 0) FROM ${clientOrders} WHERE ${clientOrders.dailySheetId} = ${sheetId})`,
      totalWeightKg: sql`(SELECT COALESCE(SUM(${clientOrders.totalWeightKg}), 0) FROM ${clientOrders} WHERE ${clientOrders.dailySheetId} = ${sheetId})`,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(dailySheets.id, sheetId));
}

export async function buildOrderItemRows(
  db: AppDatabase,
  items: ParsedOrderItem[]
): Promise<{ ok: true; rows: Array<{
  productId: number;
  orderMode: OrderMode;
  cartonsQty: number;
  packingCapacitySnapshot: number;
  totalPieces: number;
  weightKg: number;
  notes: string | null;
}> } | { ok: false; error: string }> {
  const ids = [...new Set(items.map((item) => item.productId))];
  const productRows = await chunkedInArrayQuery(ids, 75, (chunk) =>
    db.select().from(products).where(inArray(products.id, chunk)).all(),
  );
  const byId = new Map<number, ProductRow>(productRows.map((row) => [row.id, row]));
  const rows = [];

  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) {
      return { ok: false, error: 'أحد الأصناف المحددة غير موجود في الكتالوج' };
    }
    if (!product.isActive) {
      return { ok: false, error: `الصنف ${product.name} موقوف ولا يمكن إضافته إلى الأوردر` };
    }
    const totals = calculateOrderItemTotals({
      orderMode: item.orderMode,
      cartonsQty: item.cartonsQty,
      packingCapacitySnapshot: product.packingCapacity,
      directPiecesQty: item.loosePiecesQty,
      weightKg: item.weightKg,
    });
    if (totals.totalPieces < 1) {
      return { ok: false, error: `كمية ${product.name} يجب أن تكون أكبر من صفر` };
    }
    if (item.orderMode === 'kg' && totals.weightKg <= 0) {
      return { ok: false, error: `أدخل وزن ${product.name} بالكيلو` };
    }
    rows.push({
      productId: product.id,
      orderMode: item.orderMode,
      cartonsQty: totals.cartonsQty,
      packingCapacitySnapshot: product.packingCapacity,
      totalPieces: totals.totalPieces,
      weightKg: totals.weightKg,
      notes: item.notes?.trim() || null,
    });
  }

  return { ok: true, rows };
}

function itemTotals(rows: Array<{ cartonsQty: number; totalPieces: number; weightKg: number }>) {
  return {
    totalCartons: rows.reduce((sum, row) => sum + row.cartonsQty, 0),
    totalPieces: rows.reduce((sum, row) => sum + row.totalPieces, 0),
    totalWeightKg: rows.reduce((sum, row) => sum + row.weightKg, 0),
  };
}

export async function insertOrderAtomic(
  db: AppDatabase,
  input: {
    sheetId: number;
    customerId: number;
    deliveryType: 'client_warehouse' | 'sub_merchant';
    subMerchantId: number | null;
    recipientName: string | null;
    deliveryPhone: string;
    deliveryLocation: string;
    trucksCount: number;
    representativeName: string | null;
    warehouseRef: string | null;
    notes: string | null;
    items: ParsedOrderItem[];
  }
): Promise<{ ok: true; orderId: number } | { ok: false; error: string }> {
  const built = await buildOrderItemRows(db, input.items);
  if (!built.ok) return built;
  const totals = itemTotals(built.rows);
  const inserted = await db.batch([
    db
      .insert(clientOrders)
      .values({
        dailySheetId: input.sheetId,
        customerId: input.customerId,
        deliveryType: input.deliveryType,
        subMerchantId: input.subMerchantId,
        recipientName: input.recipientName,
        deliveryPhone: input.deliveryPhone,
        deliveryLocation: input.deliveryLocation,
        trucksCount: input.trucksCount,
        representativeName: input.representativeName,
        warehouseRef: input.warehouseRef,
        notes: input.notes,
        ...totals,
      })
      .returning({ id: clientOrders.id }),
    db.insert(orderItems).values(
      built.rows.map((row) => ({
        ...row,
        clientOrderId: sql<number>`last_insert_rowid()`,
      }))
    ),
    syncSheetTotals(db, input.sheetId),
  ]);
  const orderId = inserted[0][0]?.id;
  if (!orderId) return { ok: false, error: 'تعذر حفظ الطلب' };
  return { ok: true, orderId };
}

export async function updateOrderAtomic(
  db: AppDatabase,
  orderId: number,
  sheetId: number,
  input: {
    customerId: number;
    deliveryType: 'client_warehouse' | 'sub_merchant';
    subMerchantId: number | null;
    recipientName: string | null;
    deliveryPhone: string;
    deliveryLocation: string;
    trucksCount: number;
    representativeName: string | null;
    warehouseRef: string | null;
    notes: string | null;
    items: ParsedOrderItem[];
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const built = await buildOrderItemRows(db, input.items);
  if (!built.ok) return built;
  const totals = itemTotals(built.rows);
  const updated = await db.batch([
    db
      .update(clientOrders)
      .set({
        customerId: input.customerId,
        deliveryType: input.deliveryType,
        subMerchantId: input.subMerchantId,
        recipientName: input.recipientName,
        deliveryPhone: input.deliveryPhone,
        deliveryLocation: input.deliveryLocation,
        trucksCount: input.trucksCount,
        representativeName: input.representativeName,
        warehouseRef: input.warehouseRef,
        notes: input.notes,
        ...totals,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(clientOrders.id, orderId))
      .returning({ id: clientOrders.id }),
    db.delete(orderItems).where(eq(orderItems.clientOrderId, orderId)),
    db.insert(orderItems).values(built.rows.map((row) => ({ ...row, clientOrderId: orderId }))),
    syncSheetTotals(db, sheetId),
  ]);
  if (updated[0][0]?.id !== orderId) return { ok: false, error: 'تعذر تحديث الطلب في مكانه' };
  return { ok: true };
}

function mapOrderDetail(
  order: ClientOrderRow,
  customerCode: string,
  customerName: string,
  subMerchantName: string | null,
  subMerchantPhone: string | null,
  items: OrderItemDetailDTO[],
): ClientOrderDetailDTO {
  return {
    id: order.id,
    dailySheetId: order.dailySheetId,
    customerId: order.customerId,
    customerCode,
    customerName,
    deliveryType: order.deliveryType,
    subMerchantId: order.subMerchantId,
    subMerchantName,
    subMerchantPhone,
    recipientName: order.recipientName,
    deliveryPhone: order.deliveryPhone,
    deliveryLocation: order.deliveryLocation,
    trucksCount: order.trucksCount,
    representativeName: order.representativeName,
    warehouseRef: order.warehouseRef,
    notes: order.notes,
    totalCartons: order.totalCartons,
    totalPieces: order.totalPieces,
    totalWeightKg: order.totalWeightKg,
    items,
  };
}

export async function loadSheetDetail(db: AppDatabase, sheet: DailySheetRow): Promise<DailySheetDetailDTO> {
  const [orders, items] = await Promise.all([
    db
      .select()
      .from(clientOrders)
      .where(eq(clientOrders.dailySheetId, sheet.id))
      .orderBy(asc(clientOrders.id))
      .all(),
    db
      .select({
        item: orderItems,
        productCode: products.code,
        productName: products.name,
      })
      .from(orderItems)
      .innerJoin(clientOrders, eq(orderItems.clientOrderId, clientOrders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(eq(clientOrders.dailySheetId, sheet.id))
      .orderBy(asc(orderItems.id))
      .all(),
  ]);

  const customerIds = [...new Set(orders.map((order) => order.customerId))];
  const merchantIds = [...new Set(orders.map((order) => order.subMerchantId).filter((id): id is number => id !== null))];
  const customerRows = await chunkedInArrayQuery(customerIds, 75, (chunk) =>
    db.select().from(customers).where(inArray(customers.id, chunk)).all(),
  );
  const merchantRows = await chunkedInArrayQuery(merchantIds, 75, (chunk) =>
    db.select().from(subMerchants).where(inArray(subMerchants.id, chunk)).all(),
  );

  const customerNames = new Map(customerRows.map((row) => [row.id, row.name]));
  const customerCodes = new Map(customerRows.map((row) => [row.id, row.clientCode]));
  const merchantNames = new Map(merchantRows.map((row) => [row.id, row.name]));
  const merchantPhones = new Map(merchantRows.map((row) => [row.id, row.phone]));
  const itemsByOrder = new Map<number, OrderItemDetailDTO[]>();
  for (const row of items) {
    const detail: OrderItemDetailDTO = {
      id: row.item.id,
      productId: row.item.productId,
      productCode: row.productCode,
      productName: row.productName,
      orderMode: row.item.orderMode,
      cartonsQty: row.item.cartonsQty,
      packingCapacitySnapshot: row.item.packingCapacitySnapshot,
      totalPieces: row.item.totalPieces,
      weightKg: row.item.weightKg,
      notes: row.item.notes,
    };
    const list = itemsByOrder.get(row.item.clientOrderId) ?? [];
    list.push(detail);
    itemsByOrder.set(row.item.clientOrderId, list);
  }

  return {
    id: sheet.id,
    sheetNumber: sheet.sheetNumber,
    sheetDate: sheet.sheetDate,
    status: sheet.status,
    totalCartons: sheet.totalCartons,
    totalPieces: sheet.totalPieces,
    totalWeightKg: sheet.totalWeightKg,
    notes: sheet.notes,
    createdBy: sheet.createdBy,
    orderCount: orders.length,
    createdAt: sheet.createdAt,
    updatedAt: sheet.updatedAt,
    orders: orders.map((order) =>
      mapOrderDetail(
        order,
        customerCodes.get(order.customerId) ?? '',
        customerNames.get(order.customerId) ?? 'عميل محذوف',
        order.subMerchantId ? (merchantNames.get(order.subMerchantId) ?? null) : null,
        order.subMerchantId ? (merchantPhones.get(order.subMerchantId) ?? null) : null,
        [...(itemsByOrder.get(order.id) ?? [])].sort((a, b) => a.id - b.id),
      ),
    ),
  };
}

export async function deleteOrderAtomic(db: AppDatabase, orderId: number, sheetId: number): Promise<void> {
  await db.batch([
    db.delete(orderItems).where(eq(orderItems.clientOrderId, orderId)),
    db.delete(clientOrders).where(eq(clientOrders.id, orderId)),
    syncSheetTotals(db, sheetId),
  ]);
}
