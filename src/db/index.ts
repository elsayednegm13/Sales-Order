import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { count, eq } from 'drizzle-orm';
import * as schema from './schema';
import { hashPassword } from '@/worker/utils/crypto';
import { getDefaultPermissionsForRole } from '@/shared/permissions';
import type { ProductCategory, ProductGrade } from '@/shared/types';

export type AppDatabase = DrizzleD1Database<typeof schema>;

export function createDb(d1: D1Database): AppDatabase {
  return drizzle(d1, { schema });
}

let isBootstrappedInIsolate = false;

/**
 * Guarantees singleton `system_settings` (id = 1) and an initial Admin user
 * exist on first boot after D1 schema creation.
 */
export async function ensureSystemBootstrapped(
  db: AppDatabase,
  env: { APP_ENV?: string; ALLOW_DEV_SEED?: string; DEV_SEED_ADMIN_PASSWORD?: string }
): Promise<void> {
  if (isBootstrappedInIsolate) {
    return;
  }
  isBootstrappedInIsolate = true;
  if (env.APP_ENV === 'production' || env.ALLOW_DEV_SEED !== 'true') {
    return;
  }

  const seedPassword = env.DEV_SEED_ADMIN_PASSWORD?.trim() ?? '';
  if (!seedPassword) {
    console.warn('[dev-seed] DEV_SEED_ADMIN_PASSWORD is missing; admin bootstrap was skipped');
    return;
  }

  const existingUsers = await db.select({ total: count() }).from(schema.users).get();
  if (existingUsers && existingUsers.total > 0) {
    return;
  }

  const existingSettings = await db
    .select({ id: schema.systemSettings.id })
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.id, 1))
    .get();

  if (!existingSettings) {
    await db
      .insert(schema.systemSettings)
      .values({
        id: 1,
        companyName: 'نظام إدارة المبيعات',
        logoUrl: null,
        faviconUrl: null,
        startingOrderNumber: 1000,
      })
      .onConflictDoNothing();
  }

  const userCountRow = await db
    .select({ total: count() })
    .from(schema.users)
    .get();

  if (!userCountRow || userCountRow.total === 0) {
    const defaultPasswordHash = await hashPassword(seedPassword);
    await db
      .insert(schema.users)
      .values({
        username: 'admin',
        passwordHash: defaultPasswordHash,
        fullName: 'مدير النظام',
        role: 'admin',
        permissions: JSON.stringify(getDefaultPermissionsForRole('admin')),
        isActive: true,
      })
      .onConflictDoNothing();
  }

  await ensureDemoCatalog(db);
  isBootstrappedInIsolate = true;
}

const DEMO_PRODUCTS: Array<{
  code: string;
  name: string;
  category: ProductCategory;
  grade: ProductGrade;
  packingCapacity: number;
  weight: string;
}> = [
  {
    code: 'BL-060',
    name: 'بطانية صوف مزدوجة فاخرة',
    category: 'blanket',
    grade: 'first_grade',
    packingCapacity: 6,
    weight: '3.2',
  },
  {
    code: 'BL-080',
    name: 'بطانية قطن مشجرة مفردة',
    category: 'blanket',
    grade: 'first_grade',
    packingCapacity: 8,
    weight: '2.4',
  },
  {
    code: 'BL-100',
    name: 'بطانية فليس ناعمة',
    category: 'blanket',
    grade: 'second_grade',
    packingCapacity: 10,
    weight: '1.8',
  },
  {
    code: 'HT-060',
    name: 'دفاية كهربائية ثلاث درجات',
    category: 'heater',
    grade: 'first_grade',
    packingCapacity: 6,
    weight: '2.2',
  },
  {
    code: 'HT-080',
    name: 'دفاية مخمل مزدوجة',
    category: 'heater',
    grade: 'first_grade',
    packingCapacity: 8,
    weight: '2.0',
  },
  {
    code: 'HT-120',
    name: 'دفاية حرارية خفيفة',
    category: 'heater',
    grade: 'second_grade',
    packingCapacity: 12,
    weight: '1.5',
  },
];

async function ensureDemoCatalog(db: AppDatabase): Promise<void> {
  const productCount = await db.select({ total: count() }).from(schema.products).get();
  if (!productCount || productCount.total === 0) {
    await db.insert(schema.products).values(
      DEMO_PRODUCTS.map((product) => ({
        ...product,
        itemType: 'carton' as const,
        isActive: true,
      }))
    );
  }

  const customerCount = await db.select({ total: count() }).from(schema.customers).get();
  if (customerCount && customerCount.total > 0) {
    return;
  }

  const nour = await db
    .insert(schema.customers)
    .values({
      clientCode: 'C-101',
      name: 'مؤسسة النور للتجارة',
      defaultPhone: '01001234567',
      defaultLocation: 'مخزن العاشر من رمضان',
    })
    .returning()
    .get();

  const amal = await db
    .insert(schema.customers)
    .values({
      clientCode: 'C-102',
      name: 'شركة الأمل للتوزيع',
      defaultPhone: '01112223334',
      defaultLocation: 'مخزن العبور',
    })
    .returning()
    .get();

  const salam = await db
    .insert(schema.customers)
    .values({
      clientCode: 'C-103',
      name: 'محلات السلام',
      defaultPhone: '01225556677',
      defaultLocation: 'مخزن الإسكندرية',
    })
    .returning()
    .get();

  await db.insert(schema.subMerchants).values([
    {
      customerId: nour.id,
      name: 'تاجر المعادي',
      phone: '01009887766',
      location: 'المعادي، القاهرة',
    },
    {
      customerId: nour.id,
      name: 'تاجر مدينة نصر',
      phone: '01005554433',
      location: 'مدينة نصر، القاهرة',
    },
    {
      customerId: amal.id,
      name: 'فرع شبرا',
      phone: '01116667788',
      location: 'شبرا، القاهرة',
    },
    {
      customerId: salam.id,
      name: 'تاجر سموحة',
      phone: '01221112233',
      location: 'سموحة، الإسكندرية',
    },
    {
      customerId: salam.id,
      name: 'تاجر المنتزه',
      phone: '01224445566',
      location: 'المنتزه، الإسكندرية',
    },
  ]);
}
