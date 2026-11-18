import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { clientOrders, customers, dailySheets, subMerchants } from '@/db/schema';
import type { AppContextEnv } from '@/worker/types';
import { requireAdmin, requireAuth, requirePermission } from '@/worker/middleware/auth';
import { clientOrderSchema, readJson, updateClientOrderSchema } from '@/worker/schemas';
import { deleteOrderAtomic, insertOrderAtomic, updateOrderAtomic } from '@/worker/services/dailySheets';
import { bumpCacheVersions, CACHE_NAMESPACES } from '@/worker/cache';

function sheetIsClosed(status: string | null | undefined): boolean {
  return status === 'archived' || status === 'closed';
}

export const dailyOrdersRoutes = new Hono<AppContextEnv>();

dailyOrdersRoutes.use('*', requireAuth);

async function resolveDelivery(
  db: AppContextEnv['Variables']['db'],
  input: {
    customerId: number;
    deliveryType: 'client_warehouse' | 'sub_merchant';
    subMerchantId?: number | null;
    recipientName: string | null;
    deliveryPhone: string;
    deliveryLocation: string;
  }
) {
  const customer = await db.select().from(customers).where(eq(customers.id, input.customerId)).get();
  if (!customer) return { ok: false as const, error: 'العميل غير موجود', status: 404 as const };

  if (input.deliveryType === 'client_warehouse') {
    return {
      ok: true as const,
      customer,
      subMerchantId: null,
      recipientName: input.recipientName || customer.name,
      deliveryPhone: input.deliveryPhone,
      deliveryLocation: input.deliveryLocation,
    };
  }

  const merchant = await db
    .select()
    .from(subMerchants)
    .where(and(eq(subMerchants.id, input.subMerchantId ?? 0), eq(subMerchants.customerId, customer.id)))
    .get();
  if (!merchant) {
    return { ok: false as const, error: 'التاجر الفرعي لا يتبع هذا العميل', status: 400 as const };
  }

  return {
    ok: true as const,
    customer,
    subMerchantId: merchant.id,
    recipientName: input.recipientName || merchant.name,
    deliveryPhone: input.deliveryPhone,
    deliveryLocation: input.deliveryLocation,
  };
}

dailyOrdersRoutes.post('/', requirePermission('orders', 'create'), async (c) => {
  const parsed = await readJson(c, clientOrderSchema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const db = c.get('db');
  const sheet = await db
    .select()
    .from(dailySheets)
    .where(eq(dailySheets.id, parsed.data.dailySheetId))
    .get();
  if (!sheet) return c.json({ error: 'أوردر اليوم غير موجود' }, 404);
  if (sheetIsClosed(sheet.status)) {
    return c.json({ error: 'لا يمكن إضافة طلبات إلا بعد إعادة فتح الأوردر' }, 400);
  }

  const delivery = await resolveDelivery(db, parsed.data);
  if (!delivery.ok) return c.json({ error: delivery.error }, delivery.status);

  const saved = await insertOrderAtomic(db, {
    sheetId: sheet.id,
    customerId: delivery.customer.id,
    deliveryType: parsed.data.deliveryType,
    subMerchantId: delivery.subMerchantId,
    recipientName: delivery.recipientName,
    deliveryPhone: delivery.deliveryPhone,
    deliveryLocation: delivery.deliveryLocation,
    trucksCount: parsed.data.trucksCount ?? 1,
    representativeName: parsed.data.representativeName ?? null,
    warehouseRef: parsed.data.warehouseRef ?? null,
    notes: parsed.data.notes ?? null,
    items: parsed.data.items,
  });
  if (!saved.ok) return c.json({ error: saved.error }, 400);
  await bumpCacheVersions(db, [CACHE_NAMESPACES.dashboard, CACHE_NAMESPACES.reports]);
  return c.json({ orderId: saved.orderId, dailySheetId: sheet.id }, 201);
});

dailyOrdersRoutes.put('/:orderId', requirePermission('orders', 'edit'), async (c) => {
  const orderId = Number.parseInt(c.req.param('orderId'), 10);
  if (!Number.isFinite(orderId)) return c.json({ error: 'معرّف الطلب غير صالح' }, 400);
  const parsed = await readJson(c, updateClientOrderSchema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const db = c.get('db');
  const existing = await db.select().from(clientOrders).where(eq(clientOrders.id, orderId)).get();
  if (!existing) return c.json({ error: 'طلب العميل غير موجود' }, 404);

  const sheet = await db.select().from(dailySheets).where(eq(dailySheets.id, existing.dailySheetId)).get();
  if (!sheet) return c.json({ error: 'أوردر اليوم غير موجود' }, 404);
  if (sheetIsClosed(sheet.status)) {
    return c.json({ error: 'لا يمكن تعديل طلبات إلا بعد إعادة فتح الأوردر' }, 400);
  }

  const delivery = await resolveDelivery(db, parsed.data);
  if (!delivery.ok) return c.json({ error: delivery.error }, delivery.status);

  const saved = await updateOrderAtomic(db, orderId, sheet.id, {
    customerId: delivery.customer.id,
    deliveryType: parsed.data.deliveryType,
    subMerchantId: delivery.subMerchantId,
    recipientName: delivery.recipientName,
    deliveryPhone: delivery.deliveryPhone,
    deliveryLocation: delivery.deliveryLocation,
    trucksCount: parsed.data.trucksCount ?? 1,
    representativeName: parsed.data.representativeName ?? null,
    warehouseRef: parsed.data.warehouseRef ?? null,
    notes: parsed.data.notes ?? null,
    items: parsed.data.items,
  });
  if (!saved.ok) return c.json({ error: saved.error }, 400);
  await bumpCacheVersions(db, [CACHE_NAMESPACES.dashboard, CACHE_NAMESPACES.reports]);
  return c.json({ orderId, dailySheetId: sheet.id });
});

dailyOrdersRoutes.delete('/:orderId', requireAdmin, async (c) => {
  const orderId = Number.parseInt(c.req.param('orderId'), 10);
  if (!Number.isFinite(orderId)) return c.json({ error: 'معرّف الطلب غير صالح' }, 400);

  const db = c.get('db');
  const existing = await db.select().from(clientOrders).where(eq(clientOrders.id, orderId)).get();
  if (!existing) return c.json({ error: 'طلب العميل غير موجود' }, 404);

  const sheet = await db.select().from(dailySheets).where(eq(dailySheets.id, existing.dailySheetId)).get();
  if (sheetIsClosed(sheet?.status)) {
    return c.json({ error: 'لا يمكن حذف طلبات إلا بعد إعادة فتح الأوردر' }, 400);
  }

  await deleteOrderAtomic(db, orderId, existing.dailySheetId);
  await bumpCacheVersions(db, [CACHE_NAMESPACES.dashboard, CACHE_NAMESPACES.reports]);
  return c.json({ ok: true, deletedId: orderId });
});
