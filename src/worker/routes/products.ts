import { Hono } from 'hono';
import { and, asc, count, desc, eq, ne, or, sql, type SQL } from 'drizzle-orm';
import { orderItems, products, type ProductRow } from '@/db/schema';
import type {
  CreateProductDTO,
  ItemType,
  ProductCategory,
  ProductDTO,
  ProductGrade,
  UpdateProductDTO,
} from '@/shared/types';
import type { AppContextEnv } from '@/worker/types';
import { requireAuth, requirePermission } from '@/worker/middleware/auth';
import { bumpCacheVersions, CACHE_NAMESPACES, readVersionedCache } from '@/worker/cache';
import { createProductSchema, isUniqueConstraintError, productBulkImportSchema, readJson, updateProductSchema } from '@/worker/schemas';
import { importProducts } from '@/worker/services/bulkImport';
import { containsLike } from '@/worker/utils/like';
import { recordAuditLog } from '@/worker/services/auditLog';
import { clientIp } from '@/worker/utils/loginRateLimit';

export const productsRoutes = new Hono<AppContextEnv>();

const CATEGORIES = new Set<ProductCategory>(['blanket', 'heater', 'other']);
const GRADES = new Set<ProductGrade>(['first_grade', 'second_grade']);
const ITEM_TYPES = new Set<ItemType>(['carton', 'bag', 'piece', 'kg']);

function mapProduct(row: ProductRow): ProductDTO {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    grade: row.grade,
    itemType: row.itemType,
    packingCapacity: row.packingCapacity,
    weight: row.weight,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

function readPositiveInt(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100_000) {
    return null;
  }
  return parsed;
}

function readWeight(value: unknown): { ok: true; weight: string | null } | { ok: false } {
  if (value === undefined || value === null) {
    return { ok: true, weight: null };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { ok: true, weight: String(value) };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return { ok: true, weight: null };
    }
    if (trimmed.length > 40) {
      return { ok: false };
    }
    return { ok: true, weight: trimmed };
  }
  return { ok: false };
}

async function codeTaken(db: AppContextEnv['Variables']['db'], code: string, exceptId?: number) {
  const conditions = [sql`lower(${products.code}) = ${code.toLowerCase()}`];
  if (exceptId !== undefined) {
    conditions.push(ne(products.id, exceptId));
  }
  const existing = await db
    .select({ id: products.id })
    .from(products)
    .where(and(...conditions))
    .get();
  return Boolean(existing);
}

productsRoutes.use('*', requireAuth);

productsRoutes.get('/', requirePermission('catalog', 'view'), async (c) => {
  const search = c.req.query('search')?.trim() ?? '';
  const category = c.req.query('category')?.trim() ?? '';
  const grade = c.req.query('grade')?.trim() ?? '';
  const active = c.req.query('is_active')?.trim() ?? '';
  const sort = c.req.query('sort') === 'created_at' ? 'created_at' : 'code';

  if (category && !CATEGORIES.has(category as ProductCategory)) {
    return c.json({ error: 'فئة المنتج غير صالحة' }, 400);
  }
  if (grade && !GRADES.has(grade as ProductGrade)) {
    return c.json({ error: 'درجة المنتج غير صالحة' }, 400);
  }
  if (active && active !== 'true' && active !== 'false') {
    return c.json({ error: 'قيمة حالة النشاط غير صالحة' }, 400);
  }

  const filters: SQL[] = [];
  if (search) {
    const nameOrCode = or(containsLike(products.code, search), containsLike(products.name, search));
    if (nameOrCode) filters.push(nameOrCode);
  }
  if (category) {
    filters.push(eq(products.category, category as ProductCategory));
  }
  if (grade) {
    filters.push(eq(products.grade, grade as ProductGrade));
  }
  if (active) {
    filters.push(eq(products.isActive, active === 'true'));
  }

  const pageQuery = c.req.query('page');
  const paginate = pageQuery !== undefined && pageQuery !== '';
  const page = Math.max(1, Number.parseInt(pageQuery ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(c.req.query('pageSize') ?? '20', 10) || 20));
  const cacheKey = `${search}:${category}:${grade}:${active}:${sort}:${paginate ? `${page}:${pageSize}` : 'all'}`;
  const payload = await readVersionedCache(c.get('db'), CACHE_NAMESPACES.products, cacheKey, async () => {
    const db = c.get('db');
    const where = filters.length > 0 ? and(...filters) : undefined;
    const order = sort === 'created_at' ? desc(products.createdAt) : asc(products.code);
    if (!paginate) {
      const rows = await db.select().from(products).where(where).orderBy(order).all();
      return { products: rows.map(mapProduct) };
    }
    const [totalRow, rows] = await Promise.all([
      db.select({ total: count() }).from(products).where(where).get(),
      db.select().from(products).where(where).orderBy(order).limit(pageSize).offset((page - 1) * pageSize).all(),
    ]);
    return { products: rows.map(mapProduct), page, pageSize, total: totalRow?.total ?? 0 };
  });

  return c.json(payload);
});

productsRoutes.post('/bulk-import', requirePermission('catalog', 'bulkImport'), async (c) => {
  const parsed = await readJson(c, productBulkImportSchema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const db = c.get('db');
  const result = await importProducts(db, parsed.data.items, parsed.data.selectedFields);
  await bumpCacheVersions(db, [CACHE_NAMESPACES.products, CACHE_NAMESPACES.dashboard, CACHE_NAMESPACES.reports]);
  const conflict = result.errors.find((row) => row.message.includes('مسجّل'));
  if (conflict && result.created === 0 && result.updated === 0) {
    return c.json({ error: conflict.message, ...result }, 409);
  }
  const user = c.get('user');
  await recordAuditLog(db, {
    actorUserId: user.id,
    actorUsername: user.username,
    actorFullName: user.fullName,
    module: 'catalog',
    action: 'bulk_import',
    entityType: 'product',
    summary: `استيراد منتجات: أُنشئ ${result.created} وحُدّث ${result.updated}`,
    details: { created: result.created, updated: result.updated, rows: parsed.data.items.length, errorCount: result.errors.length },
    ipAddress: clientIp((name) => c.req.header(name)),
  });
  return c.json(result);
});

productsRoutes.post('/', requirePermission('catalog', 'manage'), async (c) => {
  const parsed = await readJson(c, createProductSchema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body: CreateProductDTO = {
    ...parsed.data,
    isActive: parsed.data.isActive,
    weight: parsed.data.weight,
  };

  const code = body.code?.trim() ?? '';
  if (code.length < 1 || code.length > 40) {
    return c.json({ error: 'كود الصنف يجب أن يكون بين حرف واحد و40 حرفاً' }, 400);
  }
  const name = body.name?.trim() ?? '';
  if (name.length < 2 || name.length > 120) {
    return c.json({ error: 'يرجى إدخال اسم الصنف (من حرفين حتى 120 حرفاً)' }, 400);
  }
  if (!body.category || !CATEGORIES.has(body.category)) {
    return c.json({ error: 'فئة المنتج غير صالحة' }, 400);
  }
  if (!body.grade || !GRADES.has(body.grade)) {
    return c.json({ error: 'درجة المنتج غير صالحة' }, 400);
  }
  const itemType = body.itemType;
  if (!ITEM_TYPES.has(itemType)) {
    return c.json({ error: 'نوع الصنف غير صالح' }, 400);
  }
  const packingCapacity =
    itemType === 'piece' || itemType === 'kg' ? 0 : readPositiveInt(body.packingCapacity);
  if (packingCapacity === null) {
    return c.json({ error: 'سعة التعبئة يجب أن تكون رقماً صحيحاً أكبر من صفر' }, 400);
  }
  const weight = readWeight(body.weight);
  if (!weight.ok) {
    return c.json({ error: 'الوزن المرجعي يجب ألا يتجاوز 40 حرفاً' }, 400);
  }

  const db = c.get('db');
  if (await codeTaken(db, code)) {
    return c.json({ error: 'كود الصنف مسجّل مسبقاً لمنتج آخر' }, 409);
  }

  try {
    const inserted = await db
      .insert(products)
      .values({
        code,
        name,
        category: body.category,
        grade: body.grade,
        itemType,
        packingCapacity,
        weight: weight.weight,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
      })
      .returning()
      .get();

    await bumpCacheVersions(c.get('db'), [CACHE_NAMESPACES.products, CACHE_NAMESPACES.dashboard, CACHE_NAMESPACES.reports]);
    return c.json({ product: mapProduct(inserted) }, 201);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json({ error: 'كود الصنف مسجّل مسبقاً لمنتج آخر' }, 409);
    }
    throw error;
  }
});

productsRoutes.put('/:id', requirePermission('catalog', 'manage'), async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) {
    return c.json({ error: 'معرّف المنتج غير صالح' }, 400);
  }

  const parsed = await readJson(c, updateProductSchema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body: UpdateProductDTO = parsed.data;

  const db = c.get('db');
  const existing = await db.select().from(products).where(eq(products.id, id)).get();
  if (!existing) {
    return c.json({ error: 'المنتج غير موجود' }, 404);
  }

  const code = body.code !== undefined ? body.code.trim() : existing.code;
  if (code.length < 1 || code.length > 40) {
    return c.json({ error: 'كود الصنف يجب أن يكون بين حرف واحد و40 حرفاً' }, 400);
  }
  const name = body.name !== undefined ? body.name.trim() : existing.name;
  if (name.length < 2 || name.length > 120) {
    return c.json({ error: 'يرجى إدخال اسم الصنف (من حرفين حتى 120 حرفاً)' }, 400);
  }
  const category = body.category !== undefined ? body.category : existing.category;
  if (!CATEGORIES.has(category)) {
    return c.json({ error: 'فئة المنتج غير صالحة' }, 400);
  }
  const grade = body.grade !== undefined ? body.grade : existing.grade;
  if (!GRADES.has(grade)) {
    return c.json({ error: 'درجة المنتج غير صالحة' }, 400);
  }
  const itemType = body.itemType !== undefined ? body.itemType : existing.itemType;
  if (!ITEM_TYPES.has(itemType)) {
    return c.json({ error: 'نوع الصنف غير صالح' }, 400);
  }
  const packingCapacity =
    itemType === 'piece' || itemType === 'kg'
      ? 0
      : body.packingCapacity !== undefined
        ? readPositiveInt(body.packingCapacity)
        : existing.packingCapacity;
  if (packingCapacity === null) {
    return c.json({ error: 'سعة التعبئة يجب أن تكون رقماً صحيحاً أكبر من صفر' }, 400);
  }
  let weight = existing.weight;
  if (body.weight !== undefined) {
    const parsed = readWeight(body.weight);
    if (!parsed.ok) {
      return c.json({ error: 'الوزن المرجعي يجب ألا يتجاوز 40 حرفاً' }, 400);
    }
    weight = parsed.weight;
  }
  const isActive = body.isActive !== undefined ? Boolean(body.isActive) : existing.isActive;

  if (code.toLowerCase() !== existing.code.toLowerCase() && (await codeTaken(db, code, id))) {
    return c.json({ error: 'كود الصنف مسجّل مسبقاً لمنتج آخر' }, 409);
  }
  if (code.toLowerCase() === existing.code.toLowerCase() && code !== existing.code) {
    if (await codeTaken(db, code, id)) {
      return c.json({ error: 'كود الصنف مسجّل مسبقاً لمنتج آخر' }, 409);
    }
  }

  try {
    const updated = await db
      .update(products)
      .set({ code, name, category, grade, itemType, packingCapacity, weight, isActive })
      .where(eq(products.id, id))
      .returning()
      .get();

    await bumpCacheVersions(c.get('db'), [CACHE_NAMESPACES.products, CACHE_NAMESPACES.dashboard, CACHE_NAMESPACES.reports]);
    return c.json({ product: mapProduct(updated) });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json({ error: 'كود الصنف مسجّل مسبقاً لمنتج آخر' }, 409);
    }
    throw error;
  }
});

productsRoutes.delete('/:id', requirePermission('catalog', 'delete'), async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) {
    return c.json({ error: 'معرّف المنتج غير صالح' }, 400);
  }

  const db = c.get('db');
  const existing = await db.select({ id: products.id, name: products.name, code: products.code }).from(products).where(eq(products.id, id)).get();
  if (!existing) {
    return c.json({ error: 'المنتج غير موجود' }, 404);
  }

  const used = await db
    .select({ total: count() })
    .from(orderItems)
    .where(eq(orderItems.productId, id))
    .get();

  if (used && used.total > 0) {
    return c.json(
      {
        error:
          'لا يمكن حذف هذا الصنف لأنه مستخدم في طلبات سابقة. يمكنك إيقافه (غير نشط) بدلاً من الحذف.',
        code: 'PRODUCT_IN_USE',
      },
      400
    );
  }

  await db.delete(products).where(eq(products.id, id));
  const user = c.get('user');
  await recordAuditLog(db, {
    actorUserId: user.id,
    actorUsername: user.username,
    actorFullName: user.fullName,
    module: 'catalog',
    action: 'delete_product',
    entityType: 'product',
    entityId: id,
    entityLabel: `${existing.code} — ${existing.name}`,
    summary: `حذف الصنف ${existing.name} (${existing.code})`,
    ipAddress: clientIp((name) => c.req.header(name)),
  });
  await bumpCacheVersions(c.get('db'), [CACHE_NAMESPACES.products, CACHE_NAMESPACES.dashboard, CACHE_NAMESPACES.reports]);
  return c.json({ ok: true, deletedId: id });
});
