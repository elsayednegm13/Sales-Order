import { eq, inArray } from 'drizzle-orm';
import type { AppDatabase } from '@/db';
import { customers, products, subMerchants } from '@/db/schema';
import type { ItemType, ProductCategory, ProductGrade } from '@/shared/types';
import { chunkedInArrayQuery } from '@/worker/utils/dbChunk';

export interface ProductImportInput {
  code: string;
  name: string;
  category?: ProductCategory | null;
  grade?: ProductGrade | null;
  itemType?: ItemType | null;
  packingCapacity?: number | null;
  weight?: string | null;
  isActive?: boolean | null;
}

export interface CustomerImportInput {
  clientCode: string;
  name: string;
  defaultLocation?: string | null;
  defaultPhone?: string | null;
  representativeName?: string | null;
}

export interface MerchantImportInput {
  clientCode: string;
  name: string;
  location?: string | null;
  phone?: string | null;
}

export interface BulkImportResult {
  created: number;
  updated: number;
  errors: Array<{ code: string; message: string }>;
}

type ProductField = 'category' | 'grade' | 'itemType' | 'packingCapacity' | 'weight' | 'isActive';
type CustomerField = 'defaultLocation' | 'defaultPhone' | 'representativeName';
type MerchantField = 'location' | 'phone';

function filled(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function storedPacking(itemType: ItemType, packing: number | null | undefined): number {
  if (itemType === 'piece' || itemType === 'kg') return 1;
  return packing && packing > 0 ? packing : 1;
}

async function runStatements(statements: Array<Promise<unknown>>): Promise<void> {
  for (let index = 0; index < statements.length; index += 20) {
    const chunk = statements.slice(index, index + 20);
    for (const statement of chunk) await statement;
  }
}

export async function importProducts(
  db: AppDatabase,
  items: ProductImportInput[],
  selectedFields: ProductField[],
): Promise<BulkImportResult> {
  const selected = new Set(selectedFields);
  const existing = await db
    .select({
      id: products.id,
      code: products.code,
      category: products.category,
      grade: products.grade,
      itemType: products.itemType,
      packingCapacity: products.packingCapacity,
      weight: products.weight,
    })
    .from(products)
    .all();
  const byCode = new Map(existing.map((row) => [row.code.toLowerCase(), row]));
  const errors: BulkImportResult['errors'] = [];
  let created = 0;
  let updated = 0;
  const inserts: Array<typeof products.$inferInsert> = [];
  const updates: Array<Promise<unknown>> = [];

  for (const item of items) {
    const code = item.code.trim().toUpperCase();
    const name = item.name.trim();
    if (!code || name.length < 2) {
      errors.push({ code: code || '—', message: 'يحتاج استكمال الكود' });
      continue;
    }
    const current = byCode.get(code.toLowerCase());
    const nextType = selected.has('itemType') && item.itemType ? item.itemType : current?.itemType ?? 'carton';
    if (current && current.id < 0) {
      const pending = inserts.find((row) => row.code.toLowerCase() === code.toLowerCase());
      if (pending) {
        pending.name = name;
        if (selected.has('category') && item.category) pending.category = item.category;
        if (selected.has('grade') && item.grade) pending.grade = item.grade;
        if (selected.has('itemType') && item.itemType) pending.itemType = item.itemType;
        if (selected.has('packingCapacity') && item.packingCapacity) pending.packingCapacity = storedPacking(pending.itemType ?? 'carton', item.packingCapacity);
        if (selected.has('weight') && filled(item.weight)) pending.weight = item.weight.trim();
        if (selected.has('isActive') && item.isActive !== null && item.isActive !== undefined) pending.isActive = item.isActive;
      }
      continue;
    }
    if (!current) {
      inserts.push({
        code,
        name,
        category: selected.has('category') && item.category ? item.category : 'blanket',
        grade: selected.has('grade') && item.grade ? item.grade : 'first_grade',
        itemType: nextType,
        packingCapacity: storedPacking(nextType, selected.has('packingCapacity') ? item.packingCapacity : null),
        weight: selected.has('weight') && filled(item.weight) ? item.weight.trim() : null,
        isActive: selected.has('isActive') && item.isActive !== null && item.isActive !== undefined ? item.isActive : true,
      });
        byCode.set(code.toLowerCase(), {
        id: -1,
        code,
        category: selected.has('category') && item.category ? item.category : 'blanket',
        grade: selected.has('grade') && item.grade ? item.grade : 'first_grade',
        itemType: nextType,
        packingCapacity: storedPacking(nextType, item.packingCapacity ?? null),
        weight: selected.has('weight') && filled(item.weight) ? item.weight.trim() : null,
      });
      created += 1;
      continue;
    }
    const patch: Partial<typeof products.$inferInsert> = { code, name };
    if (selected.has('category') && item.category) patch.category = item.category;
    if (selected.has('grade') && item.grade) patch.grade = item.grade;
    if (selected.has('itemType') && item.itemType) patch.itemType = item.itemType;
    if (selected.has('packingCapacity') && item.packingCapacity) {
      patch.packingCapacity = storedPacking(patch.itemType ?? current.itemType, item.packingCapacity);
    } else if (patch.itemType === 'piece' || patch.itemType === 'kg') {
      patch.packingCapacity = 1;
    }
    if (selected.has('weight') && filled(item.weight)) patch.weight = item.weight.trim();
    if (selected.has('isActive') && item.isActive !== null && item.isActive !== undefined) patch.isActive = item.isActive;
    updates.push(db.update(products).set(patch).where(eq(products.id, current.id)));
    updated += 1;
  }

  for (let index = 0; index < inserts.length; index += 8) {
    await db.insert(products).values(inserts.slice(index, index + 8));
  }
  await runStatements(updates);
  return { created, updated, errors };
}

export async function importCustomers(
  db: AppDatabase,
  customerRows: CustomerImportInput[],
  merchantRows: MerchantImportInput[],
  selectedCustomerFields: CustomerField[],
  selectedMerchantFields: MerchantField[],
): Promise<BulkImportResult> {
  const customerFields = new Set(selectedCustomerFields);
  const merchantFields = new Set(selectedMerchantFields);
  const errors: BulkImportResult['errors'] = [];
  let created = 0;
  let updated = 0;

  const existingCustomers = await db
    .select({ id: customers.id, clientCode: customers.clientCode })
    .from(customers)
    .all();
  const byCode = new Map(existingCustomers.map((row) => [row.clientCode.toLowerCase(), row]));
  const customerInserts: Array<typeof customers.$inferInsert> = [];
  const customerUpdates: Array<Promise<unknown>> = [];

  for (const row of customerRows) {
    const clientCode = row.clientCode.trim().toUpperCase();
    const name = row.name.trim();
    if (!clientCode || name.length < 2) {
      errors.push({ code: clientCode || '—', message: 'يحتاج استكمال الكود' });
      continue;
    }
    const current = byCode.get(clientCode.toLowerCase());
    if (current && current.id === 0) {
      const pending = customerInserts.find((row) => row.clientCode.toLowerCase() === clientCode.toLowerCase());
      if (pending) {
        pending.name = name;
        if (customerFields.has('defaultLocation') && filled(row.defaultLocation)) pending.defaultLocation = row.defaultLocation.trim();
        if (customerFields.has('defaultPhone') && filled(row.defaultPhone)) pending.defaultPhone = row.defaultPhone.trim();
        if (customerFields.has('representativeName') && filled(row.representativeName)) pending.representativeName = row.representativeName.trim();
      }
      continue;
    }
    if (!current) {
      customerInserts.push({
        clientCode,
        name,
        defaultLocation: customerFields.has('defaultLocation') && filled(row.defaultLocation) ? row.defaultLocation.trim() : null,
        defaultPhone: customerFields.has('defaultPhone') && filled(row.defaultPhone) ? row.defaultPhone.trim() : null,
        representativeName: customerFields.has('representativeName') && filled(row.representativeName) ? row.representativeName.trim() : null,
      });
      byCode.set(clientCode.toLowerCase(), { id: 0, clientCode });
      created += 1;
      continue;
    }
    const patch: Partial<typeof customers.$inferInsert> = { clientCode, name };
    if (customerFields.has('defaultLocation') && filled(row.defaultLocation)) patch.defaultLocation = row.defaultLocation.trim();
    if (customerFields.has('defaultPhone') && filled(row.defaultPhone)) patch.defaultPhone = row.defaultPhone.trim();
    if (customerFields.has('representativeName') && filled(row.representativeName)) patch.representativeName = row.representativeName.trim();
    if (current.id > 0) {
      customerUpdates.push(db.update(customers).set(patch).where(eq(customers.id, current.id)));
      updated += 1;
    }
  }

  for (let index = 0; index < customerInserts.length; index += 8) {
    await db.insert(customers).values(customerInserts.slice(index, index + 8));
  }
  await runStatements(customerUpdates);

  const refreshed = await db.select({ id: customers.id, clientCode: customers.clientCode }).from(customers).all();
  const idsByCode = new Map(refreshed.map((row) => [row.clientCode.toLowerCase(), row.id]));
  const parentIds = [...new Set(merchantRows.map((row) => idsByCode.get(row.clientCode.trim().toLowerCase())).filter((id): id is number => Boolean(id)))];
  const existingMerchants = await chunkedInArrayQuery(parentIds, 75, (chunk) =>
    db
      .select({
        id: subMerchants.id,
        customerId: subMerchants.customerId,
        name: subMerchants.name,
      })
      .from(subMerchants)
      .where(inArray(subMerchants.customerId, chunk))
      .all(),
  );
  const merchantKey = (customerId: number, name: string) => `${customerId}:${name.trim().replace(/\s+/g, ' ').toLowerCase()}`;
  const merchantsByKey = new Map(existingMerchants.map((row) => [merchantKey(row.customerId, row.name), row]));
  const merchantInserts: Array<typeof subMerchants.$inferInsert> = [];
  const merchantUpdates: Array<Promise<unknown>> = [];

  for (const row of merchantRows) {
    const clientCode = row.clientCode.trim().toUpperCase();
    const name = row.name.trim().replace(/\s+/g, ' ');
    const customerId = idsByCode.get(clientCode.toLowerCase());
    if (!clientCode || name.length < 2 || !customerId) {
      errors.push({ code: clientCode || name || '—', message: 'يحتاج استكمال الكود' });
      continue;
    }
    const current = merchantsByKey.get(merchantKey(customerId, name));
    if (!current) {
      merchantInserts.push({
        customerId,
        name,
        location: merchantFields.has('location') && filled(row.location) ? row.location.trim() : null,
        phone: merchantFields.has('phone') && filled(row.phone) ? row.phone.trim() : null,
      });
      merchantsByKey.set(merchantKey(customerId, name), { id: 0, customerId, name });
      created += 1;
      continue;
    }
    if (current.id <= 0) continue;
    const patch: Partial<typeof subMerchants.$inferInsert> = {};
    if (merchantFields.has('location') && filled(row.location)) patch.location = row.location.trim();
    if (merchantFields.has('phone') && filled(row.phone)) patch.phone = row.phone.trim();
    if (Object.keys(patch).length > 0) {
      merchantUpdates.push(db.update(subMerchants).set(patch).where(eq(subMerchants.id, current.id)));
      updated += 1;
    }
  }

  for (let index = 0; index < merchantInserts.length; index += 8) {
    await db.insert(subMerchants).values(merchantInserts.slice(index, index + 8));
  }
  await runStatements(merchantUpdates);
  return { created, updated, errors };
}
