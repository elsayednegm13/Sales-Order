import { sanitizeExcelCell } from '@/client/lib/excelSanitize';
import type { ItemType, ProductCategory, ProductGrade } from '@/shared/types';

export type ProductFieldKey = 'category' | 'grade' | 'itemType' | 'packingCapacity' | 'weight' | 'isActive';
export type CustomerFieldKey = 'defaultLocation' | 'defaultPhone' | 'representativeName';
export type MerchantFieldKey = 'location' | 'phone';

export interface ProductImportRow {
  code: string;
  name: string;
  category: ProductCategory | null;
  grade: ProductGrade | null;
  itemType: ItemType | null;
  packingCapacity: number | null;
  weight: string | null;
  isActive: boolean | null;
  problem: string | null;
}

export interface CustomerImportRow {
  clientCode: string;
  name: string;
  defaultLocation: string | null;
  defaultPhone: string | null;
  representativeName: string | null;
}

export interface MerchantImportRow {
  clientCode: string;
  name: string;
  location: string | null;
  phone: string | null;
}

const EASTERN_DIGITS = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹';

export function toWesternDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => String(EASTERN_DIGITS.indexOf(digit) % 10));
}

export function collapseSpaces(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function protectCellText(value: string): string {
  const cleaned = sanitizeExcelCell(value);
  return typeof cleaned === 'string' ? cleaned : String(cleaned);
}

export function normalizeCode(value: unknown): string {
  const text = protectCellText(collapseSpaces(toWesternDigits(cellText(value))));
  return text.toUpperCase();
}

export function normalizeName(value: unknown): string {
  return protectCellText(collapseSpaces(toWesternDigits(cellText(value))));
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  return String(value);
}

/** Restores the trunk zero Excel drops from Egyptian mobiles stored as numbers. */
export function recoverEgyptianPhone(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const digits = toWesternDigits(cellText(value)).replace(/[^\d]/g, '');
  if (!digits) return null;
  const restored = /^1[0125]\d{8}$/.test(digits) ? `0${digits}` : digits;
  const safe = protectCellText(restored);
  return safe || null;
}

function normalizeArabic(value: unknown): string {
  return collapseSpaces(cellText(value))
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

export function mapCategory(value: unknown): ProductCategory | null | 'invalid' {
  const text = normalizeArabic(value);
  if (!text) return null;
  if (text === 'بطاطين' || text === 'بطانيه' || text === 'blanket') return 'blanket';
  if (text === 'دفايات' || text === 'دفايه' || text === 'heater') return 'heater';
  if (text === 'اخري' || text === 'other') return 'other';
  return 'invalid';
}

export function mapGrade(value: unknown): ProductGrade | null | 'invalid' {
  const text = normalizeArabic(value);
  if (!text) return null;
  if (text === 'درجه اولي' || text === 'اولي' || text === 'first' || text === 'first_grade') return 'first_grade';
  if (text === 'درجه ثانيه' || text === 'ثانيه' || text === 'second' || text === 'second_grade') return 'second_grade';
  return 'invalid';
}

export function mapWeight(value: unknown): string | null | 'invalid' {
  const raw = collapseSpaces(toWesternDigits(cellText(value))).replace(/[٫،,]/g, '.');
  if (!raw) return null;
  const numeric = raw.replace(/كجم|كغ|kg/gi, '').trim();
  if (!/^\d+(\.\d+)?$/.test(numeric) || numeric.length > 40) return 'invalid';
  return numeric;
}

export function mapItemType(value: unknown): ItemType | null | 'invalid' {
  const text = collapseSpaces(cellText(value)).replace(/[أإآ]/g, 'ا').toLowerCase();
  if (!text) return null;
  if (text === 'كرتونة' || text === 'كرتونه' || text === 'كراتين' || text === 'carton') return 'carton';
  if (text === 'كيس' || text === 'اكياس' || text === 'أكياس' || text === 'bag') return 'bag';
  if (text === 'قطعة' || text === 'قطعه' || text === 'قطع' || text === 'piece') return 'piece';
  if (text === 'كجم' || text === 'كيلو' || text === 'كيلوجرام' || text === 'kg') return 'kg';
  return 'invalid';
}

export function mapActiveStatus(value: unknown): boolean | null | 'invalid' {
  const text = collapseSpaces(cellText(value));
  if (!text) return null;
  if (text === 'نشط' || text === 'فعال') return true;
  if (text === 'موقوف' || text === 'غير نشط') return false;
  return 'invalid';
}

export function mapPacking(value: unknown, itemType: ItemType | null): number | null | 'invalid' {
  if (itemType === 'piece' || itemType === 'kg') return 1;
  const text = collapseSpaces(toWesternDigits(cellText(value)));
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100_000) return 'invalid';
  return parsed;
}

function headerLabel(value: unknown): string {
  return collapseSpaces(cellText(value)).replace(/\*/g, '').trim();
}

function matrixFromSheet(rows: unknown[][]): unknown[][] {
  return rows.filter((row) => row.some((cell) => collapseSpaces(cellText(cell)) !== ''));
}

export function parseProductMatrix(rows: unknown[][]): { rows: ProductImportRow[]; error?: string } {
  const matrix = matrixFromSheet(rows);
  if (matrix.length === 0) return { rows: [], error: 'ملف المنتجات فارغ' };
  const headers = matrix[0].map(headerLabel);
  const index = (...labels: string[]) => headers.findIndex((header) => labels.includes(header));
  const codeIndex = index('كود الصنف');
  const nameIndex = index('اسم الصنف', 'اسم المنتج');
  if (codeIndex < 0 || nameIndex < 0) {
    return { rows: [], error: 'استخدم قالب تكويد المنتجات. عمودا الكود والاسم مطلوبان.' };
  }
  const categoryIndex = index('الفئة');
  const gradeIndex = index('الدرجة');
  const typeIndex = index('نوع التحميل', 'نمط التحميل');
  const packingIndex = index('التعبئة', 'التعبئة القياسية');
  const weightIndex = index('الوزن المرجعي', 'الوزن');
  const statusIndex = index('الحالة');
  const parsed: ProductImportRow[] = [];
  for (const row of matrix.slice(1)) {
    const rawCategory = categoryIndex >= 0 ? mapCategory(row[categoryIndex]) : null;
    const rawGrade = gradeIndex >= 0 ? mapGrade(row[gradeIndex]) : null;
    const rawType = typeIndex >= 0 ? mapItemType(row[typeIndex]) : null;
    const itemType = rawType === 'invalid' ? null : rawType;
    const rawPacking = mapPacking(packingIndex >= 0 ? row[packingIndex] : '', itemType);
    const rawWeight = weightIndex >= 0 ? mapWeight(row[weightIndex]) : null;
    const rawStatus = statusIndex >= 0 ? mapActiveStatus(row[statusIndex]) : null;
    const code = normalizeCode(row[codeIndex]);
    const name = normalizeName(row[nameIndex]);
    if (!code && !name && rawCategory === null && rawGrade === null && rawType === null && rawPacking === null && rawWeight === null && rawStatus === null) continue;
    const problems = [
      rawCategory === 'invalid' ? 'الفئة غير معروفة' : '',
      rawGrade === 'invalid' ? 'الدرجة غير معروفة' : '',
      rawType === 'invalid' ? 'نوع التحميل غير معروف' : '',
      rawPacking === 'invalid' ? 'التعبئة غير صالحة' : '',
      rawWeight === 'invalid' ? 'الوزن المرجعي غير صالح' : '',
      rawStatus === 'invalid' ? 'الحالة غير معروفة' : '',
    ].filter(Boolean);
    parsed.push({
      code,
      name,
      category: rawCategory === 'invalid' ? null : rawCategory,
      grade: rawGrade === 'invalid' ? null : rawGrade,
      itemType,
      packingCapacity: rawPacking === 'invalid' ? null : rawPacking,
      weight: rawWeight === 'invalid' ? null : rawWeight,
      isActive: rawStatus === 'invalid' ? null : rawStatus,
      problem: problems[0] ?? null,
    });
  }
  return { rows: parsed };
}

export function parseCustomerMatrices(
  customerRows: unknown[][],
  merchantRows: unknown[][],
): { customers: CustomerImportRow[]; subMerchants: MerchantImportRow[]; error?: string } {
  const customersMatrix = matrixFromSheet(customerRows);
  const merchantsMatrix = matrixFromSheet(merchantRows);
  if (customersMatrix.length === 0 && merchantsMatrix.length === 0) {
    return { customers: [], subMerchants: [], error: 'ملف العملاء فارغ' };
  }
  const customers: CustomerImportRow[] = [];
  if (customersMatrix.length > 0) {
    const headers = customersMatrix[0].map(headerLabel);
    const at = (label: string) => headers.findIndex((header) => header === label);
    const codeIndex = at('كود العميل');
    const nameIndex = at('اسم العميل');
    if (codeIndex < 0 || nameIndex < 0) {
      return { customers: [], subMerchants: [], error: 'ورقة العملاء الرئيسيين لا تطابق القالب.' };
    }
    const locationIndex = at('المخزن / المنطقة');
    const phoneIndex = at('رقم الهاتف');
    const representativeIndex = at('المندوب');
    for (const row of customersMatrix.slice(1)) {
      const clientCode = normalizeCode(row[codeIndex]);
      const name = normalizeName(row[nameIndex]);
      const defaultLocation = locationIndex >= 0 ? normalizeName(row[locationIndex]) || null : null;
      const defaultPhone = phoneIndex >= 0 ? recoverEgyptianPhone(row[phoneIndex]) : null;
      const representativeName = representativeIndex >= 0 ? normalizeName(row[representativeIndex]) || null : null;
      if (!clientCode && !name && !defaultLocation && !defaultPhone && !representativeName) continue;
      customers.push({ clientCode, name, defaultLocation, defaultPhone, representativeName });
    }
  }
  const subMerchants: MerchantImportRow[] = [];
  if (merchantsMatrix.length > 0) {
    const headers = merchantsMatrix[0].map(headerLabel);
    const at = (label: string) => headers.findIndex((header) => header === label);
    const parentIndex = at('كود العميل الرئيسي');
    const nameIndex = at('اسم التاجر الفرعي');
    if (parentIndex < 0 || nameIndex < 0) {
      return { customers, subMerchants: [], error: 'ورقة التجار الفرعيين لا تطابق القالب.' };
    }
    const locationIndex = at('المنطقة / العنوان');
    const phoneIndex = at('رقم الهاتف');
    for (const row of merchantsMatrix.slice(1)) {
      const clientCode = normalizeCode(row[parentIndex]);
      const name = normalizeName(row[nameIndex]);
      const location = locationIndex >= 0 ? normalizeName(row[locationIndex]) || null : null;
      const phone = phoneIndex >= 0 ? recoverEgyptianPhone(row[phoneIndex]) : null;
      if (!clientCode && !name && !location && !phone) continue;
      subMerchants.push({ clientCode, name, location, phone });
    }
  }
  return { customers, subMerchants };
}

async function readMatrices(file: ArrayBuffer): Promise<unknown[][][]> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(file, { type: 'array' });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' }) as unknown[][];
  });
}

export async function parseProductWorkbook(file: ArrayBuffer): Promise<{ rows: ProductImportRow[]; error?: string }> {
  const sheets = await readMatrices(file);
  return parseProductMatrix(sheets[0] ?? []);
}

export async function parseCustomerWorkbook(file: ArrayBuffer): Promise<{
  customers: CustomerImportRow[];
  subMerchants: MerchantImportRow[];
  error?: string;
}> {
  const sheets = await readMatrices(file);
  return parseCustomerMatrices(sheets[0] ?? [], sheets[1] ?? []);
}

export function productIssue(row: ProductImportRow): string | null {
  if (!row.code || row.name.trim().length < 2) return 'يحتاج استكمال الكود';
  return row.problem;
}

export function customerIssue(row: CustomerImportRow): string | null {
  if (!row.clientCode || row.name.trim().length < 2) return 'يحتاج استكمال الكود';
  return null;
}

export function merchantIssue(row: MerchantImportRow, knownParentCodes: Set<string>): string | null {
  if (!row.clientCode || row.name.trim().length < 2) return 'يحتاج استكمال الكود';
  if (!knownParentCodes.has(row.clientCode.toLowerCase())) return 'يحتاج استكمال الكود';
  return null;
}
