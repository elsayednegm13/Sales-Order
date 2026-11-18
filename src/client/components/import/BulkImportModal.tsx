import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { api } from '@/client/lib/api';
import { downloadCustomerTemplate, downloadProductTemplate } from '@/client/lib/importTemplates';
import {
  customerIssue,
  merchantIssue,
  normalizeCode,
  normalizeName,
  productIssue,
  parseCustomerWorkbook,
  parseProductWorkbook,
  type CustomerImportRow,
  type MerchantImportRow,
  type ProductImportRow,
} from '@/client/lib/excelImportParser';
import { CATEGORY_LABELS_AR, GRADE_LABELS_AR, ITEM_TYPE_LABELS_AR } from '@/shared/labels';
import type { CustomerDTO, ProductDTO } from '@/shared/types';

type Mode = 'products' | 'customers';

const fieldClass = 'h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

function Chip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>
      {label}
      <span className="tabular-nums">{value.toLocaleString('en-US')}</span>
    </span>
  );
}

export function BulkImportModal({
  open,
  mode,
  products,
  customers,
  onClose,
  onImported,
}: {
  open: boolean;
  mode: Mode;
  products: ProductDTO[];
  customers: CustomerDTO[];
  onClose: () => void;
  onImported: () => Promise<void> | void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [productRows, setProductRows] = useState<ProductImportRow[]>([]);
  const [customerRows, setCustomerRows] = useState<CustomerImportRow[]>([]);
  const [merchantRows, setMerchantRows] = useState<MerchantImportRow[]>([]);
  const [productFields, setProductFields] = useState({
    category: true,
    grade: true,
    itemType: true,
    packingCapacity: true,
    weight: true,
    isActive: true,
  });
  const [customerFields, setCustomerFields] = useState({ defaultLocation: true, defaultPhone: true, representativeName: true });
  const [merchantFields, setMerchantFields] = useState({ location: true, phone: true });
  const [isBusy, setIsBusy] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFileName('');
    setFileError(null);
    setProductRows([]);
    setCustomerRows([]);
    setMerchantRows([]);
    setResultText(null);
    setIsBusy(false);
    busyRef.current = false;
  }, [open]);

  const productCodes = useMemo(() => new Set(products.map((item) => item.code.toLowerCase())), [products]);
  const customerCodes = useMemo(() => new Set(customers.map((item) => item.clientCode.toLowerCase())), [customers]);
  const merchantNames = useMemo(() => {
    const names = new Set<string>();
    for (const customer of customers) {
      for (const merchant of customer.subMerchants ?? []) {
        names.add(`${customer.clientCode.toLowerCase()}:${merchant.name.trim().replace(/\s+/g, ' ').toLowerCase()}`);
      }
    }
    return names;
  }, [customers]);

  const knownParents = useMemo(() => {
    const codes = new Set(customerCodes);
    for (const row of customerRows) {
      if (row.clientCode && row.name.trim().length >= 2) codes.add(row.clientCode.toLowerCase());
    }
    return codes;
  }, [customerCodes, customerRows]);

  const productStats = useMemo(() => classify(productRows, (row) => productIssue(row), (row) => productCodes.has(row.code.toLowerCase())), [productCodes, productRows]);
  const customerStats = useMemo(() => classify(customerRows, (row) => customerIssue(row), (row) => customerCodes.has(row.clientCode.toLowerCase())), [customerCodes, customerRows]);
  const merchantStats = useMemo(
    () => classify(merchantRows, (row) => merchantIssue(row, knownParents), (row) => merchantNames.has(`${row.clientCode.toLowerCase()}:${row.name.trim().replace(/\s+/g, ' ').toLowerCase()}`)),
    [knownParents, merchantNames, merchantRows],
  );
  const totals = mode === 'products'
    ? productStats
    : {
        total: customerStats.total + merchantStats.total,
        created: customerStats.created + merchantStats.created,
        updated: customerStats.updated + merchantStats.updated,
        errors: customerStats.errors + merchantStats.errors,
      };
  const blocked = totals.total === 0 || totals.errors > 0 || isBusy;

  if (!open) return null;

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setIsBusy(true);
    setFileError(null);
    setResultText(null);
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      if (mode === 'products') {
        const parsed = await parseProductWorkbook(buffer);
        setFileError(parsed.error ?? null);
        setProductRows(parsed.rows);
      } else {
        const parsed = await parseCustomerWorkbook(buffer);
        setFileError(parsed.error ?? null);
        setCustomerRows(parsed.customers);
        setMerchantRows(parsed.subMerchants);
      }
    } catch {
      setFileError('تعذر قراءة ملف Excel');
    } finally {
      setIsBusy(false);
    }
  };

  const downloadTemplate = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsBusy(true);
    try {
      if (mode === 'products') await downloadProductTemplate();
      else await downloadCustomerTemplate();
    } catch {
      setFileError('تعذر إنشاء قالب Excel');
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  };

  const submit = async () => {
    if (busyRef.current || blocked) return;
    busyRef.current = true;
    setIsBusy(true);
    setFileError(null);
    try {
      if (mode === 'products') {
        const result = await api.products.bulkImport({
          items: productRows.map((row) => ({
            code: row.code,
            name: row.name,
            category: row.category,
            grade: row.grade,
            itemType: row.itemType,
            packingCapacity: row.packingCapacity,
            weight: row.weight,
            isActive: row.isActive,
          })),
          selectedFields: (Object.entries(productFields) as Array<[keyof typeof productFields, boolean]>)
            .filter(([, checked]) => checked)
            .map(([key]) => key),
        });
        setResultText(`تمت إضافة ${result.created.toLocaleString('en-US')} وتحديث ${result.updated.toLocaleString('en-US')}`);
      } else {
        const result = await api.customers.bulkImport({
          customers: customerRows,
          subMerchants: merchantRows,
          selectedCustomerFields: (Object.entries(customerFields) as Array<[keyof typeof customerFields, boolean]>)
            .filter(([, checked]) => checked)
            .map(([key]) => key),
          selectedMerchantFields: (Object.entries(merchantFields) as Array<[keyof typeof merchantFields, boolean]>)
            .filter(([, checked]) => checked)
            .map(([key]) => key),
        });
        setResultText(`تمت إضافة ${result.created.toLocaleString('en-US')} وتحديث ${result.updated.toLocaleString('en-US')}`);
      }
      await onImported();
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'تعذر حفظ الاستيراد');
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" onClick={() => !isBusy && onClose()}>
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 border-r-4 border-r-blue-600 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">{mode === 'products' ? 'استيراد وتكويد المنتجات' : 'استيراد العملاء والتجار'}</h2>
            <p className="mt-1 text-xs text-slate-500">{fileName || 'اختر ملف Excel المطابق للقالب'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={isBusy} onClick={() => void downloadTemplate()} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <Download className="h-3.5 w-3.5" />
              تحميل القالب الجاهز (.xlsx)
            </button>
            <button type="button" disabled={isBusy} onClick={() => fileRef.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-3 text-xs font-bold text-white disabled:opacity-50">
              <Upload className="h-3.5 w-3.5" />
              اختيار ملف
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(event) => void chooseFile(event)} />
          </div>
        </div>
        <div className="space-y-3 overflow-y-auto px-5 py-4">
          <fieldset className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <legend className="px-1 text-xs font-bold text-slate-700 dark:text-slate-200">اختيار الحقول المراد استيرادها والكتابة عليها</legend>
            <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold text-slate-700 dark:text-slate-200">
              {mode === 'products' ? (
                <>
                  <Check label="الفئة" checked={productFields.category} onChange={(checked) => setProductFields((prev) => ({ ...prev, category: checked }))} />
                  <Check label="الدرجة" checked={productFields.grade} onChange={(checked) => setProductFields((prev) => ({ ...prev, grade: checked }))} />
                  <Check label="نوع التحميل" checked={productFields.itemType} onChange={(checked) => setProductFields((prev) => ({ ...prev, itemType: checked }))} />
                  <Check label="التعبئة" checked={productFields.packingCapacity} onChange={(checked) => setProductFields((prev) => ({ ...prev, packingCapacity: checked }))} />
                  <Check label="الوزن المرجعي" checked={productFields.weight} onChange={(checked) => setProductFields((prev) => ({ ...prev, weight: checked }))} />
                  <Check label="الحالة" checked={productFields.isActive} onChange={(checked) => setProductFields((prev) => ({ ...prev, isActive: checked }))} />
                </>
              ) : (
                <>
                  <Check label="المخزن / المنطقة" checked={customerFields.defaultLocation} onChange={(checked) => setCustomerFields((prev) => ({ ...prev, defaultLocation: checked }))} />
                  <Check label="رقم الهاتف" checked={customerFields.defaultPhone} onChange={(checked) => setCustomerFields((prev) => ({ ...prev, defaultPhone: checked }))} />
                  <Check label="المندوب" checked={customerFields.representativeName} onChange={(checked) => setCustomerFields((prev) => ({ ...prev, representativeName: checked }))} />
                  <Check label="منطقة التاجر" checked={merchantFields.location} onChange={(checked) => setMerchantFields((prev) => ({ ...prev, location: checked }))} />
                  <Check label="هاتف التاجر" checked={merchantFields.phone} onChange={(checked) => setMerchantFields((prev) => ({ ...prev, phone: checked }))} />
                </>
              )}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">الخلايا الفارغة في ملف Excel تُبقي قيمة الحقل الحالية في قاعدة البيانات كما هي عند التحديث.</p>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Chip label="إجمالي السطور" value={totals.total} tone="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" />
            <Chip label="إضافة جديد (New)" value={totals.created} tone="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" />
            <Chip label="تحديث حالي (Update)" value={totals.updated} tone="bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200" />
            <Chip label="أخطاء تحتاج مراجعة" value={totals.errors} tone="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" />
          </div>
          {fileError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:bg-red-950/40 dark:text-red-200">{fileError}</p> : null}
          {resultText ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">{resultText}</p> : null}
          {mode === 'products' ? (
            <PreviewTable
              headers={['الكود', 'الاسم', 'الفئة', 'الدرجة', 'نوع التحميل', 'التعبئة', 'الوزن المرجعي', 'الحالة']}
              rows={productRows.map((row, index) => ({
                key: `p-${index}`,
                issue: productIssue(row),
                kind: productCodes.has(row.code.toLowerCase()) ? 'update' as const : 'new' as const,
                cells: [
                  row.code,
                  row.name,
                  row.category ? CATEGORY_LABELS_AR[row.category] : '—',
                  row.grade ? GRADE_LABELS_AR[row.grade] : '—',
                  row.itemType ? ITEM_TYPE_LABELS_AR[row.itemType] : '—',
                  row.packingCapacity ?? '—',
                  row.weight ?? '—',
                  row.isActive === null ? '—' : row.isActive ? 'نشط' : 'موقوف',
                ],
                editCode: !row.code,
                editName: row.name.trim().length < 2,
                code: row.code,
                name: row.name,
                onCode: (value: string) => setProductRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, code: normalizeCode(value), problem: null } : item)),
                onName: (value: string) => setProductRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: normalizeName(value), problem: null } : item)),
              }))}
            />
          ) : (
            <div className="space-y-4">
              <PreviewTable
                title="العملاء الرئيسيين"
                headers={['الكود', 'الاسم', 'المخزن / المنطقة', 'الهاتف', 'المندوب']}
                rows={customerRows.map((row, index) => ({
                  key: `c-${index}`,
                  issue: customerIssue(row),
                  kind: customerCodes.has(row.clientCode.toLowerCase()) ? 'update' as const : 'new' as const,
                  cells: [row.clientCode, row.name, row.defaultLocation ?? '—', row.defaultPhone ?? '—', row.representativeName ?? '—'],
                  editCode: !row.clientCode,
                  editName: row.name.trim().length < 2,
                  code: row.clientCode,
                  name: row.name,
                  onCode: (value: string) => setCustomerRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, clientCode: normalizeCode(value) } : item)),
                  onName: (value: string) => setCustomerRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: normalizeName(value) } : item)),
                }))}
              />
              <PreviewTable
                title="التجار الفرعيين"
                headers={['كود العميل', 'الاسم', 'المنطقة', 'الهاتف']}
                rows={merchantRows.map((row, index) => ({
                  key: `m-${index}`,
                  issue: merchantIssue(row, knownParents),
                  kind: merchantNames.has(`${row.clientCode.toLowerCase()}:${row.name.trim().replace(/\s+/g, ' ').toLowerCase()}`) ? 'update' as const : 'new' as const,
                  cells: [row.clientCode, row.name, row.location ?? '—', row.phone ?? '—'],
                  editCode: !row.clientCode || !knownParents.has(row.clientCode.toLowerCase()),
                  editName: row.name.trim().length < 2,
                  code: row.clientCode,
                  name: row.name,
                  onCode: (value: string) => setMerchantRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, clientCode: normalizeCode(value) } : item)),
                  onName: (value: string) => setMerchantRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: normalizeName(value) } : item)),
                }))}
              />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <button type="button" disabled={isBusy} onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200">إغلاق</button>
          <button type="button" disabled={blocked} onClick={() => void submit()} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            <FileSpreadsheet className="h-4 w-4" />
            تأكيد الاستيراد
          </button>
        </div>
      </div>
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function classify<T>(rows: T[], issue: (row: T) => string | null, exists: (row: T) => boolean) {
  let created = 0;
  let updated = 0;
  let errors = 0;
  for (const row of rows) {
    if (issue(row)) errors += 1;
    else if (exists(row)) updated += 1;
    else created += 1;
  }
  return { total: rows.length, created, updated, errors };
}

function PreviewTable({
  title,
  headers,
  rows,
}: {
  title?: string;
  headers: string[];
  rows: Array<{
    key: string;
    issue: string | null;
    kind: 'new' | 'update';
    cells: Array<string | number>;
    editCode: boolean;
    editName: boolean;
    code: string;
    name: string;
    onCode: (value: string) => void;
    onName: (value: string) => void;
  }>;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      {title ? <h3 className="mb-2 text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h3> : null}
      <div className="max-h-72 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full border-collapse text-right text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 font-bold">الحالة</th>
              {headers.map((header) => <th key={header} className="px-3 py-2 font-bold">{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2">
                  {row.issue ? <span className="rounded-full bg-red-100 px-2 py-0.5 font-bold text-red-800 dark:bg-red-950 dark:text-red-200">نقص كود</span> : row.kind === 'update' ? <span className="rounded-full bg-blue-100 px-2 py-0.5 font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-200">تحديث</span> : <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">جديد</span>}
                </td>
                <td className="px-3 py-2">
                  {row.editCode ? <input value={row.code} onChange={(event) => row.onCode(event.target.value)} className={fieldClass} placeholder="يحتاج استكمال الكود" /> : <span dir="ltr" className="font-mono">{row.cells[0]}</span>}
                </td>
                <td className="px-3 py-2">
                  {row.editName ? <input value={row.name} onChange={(event) => row.onName(event.target.value)} className={fieldClass} placeholder="يحتاج استكمال الكود" /> : row.cells[1]}
                </td>
                {row.cells.slice(2).map((cell, index) => <td key={index} className="px-3 py-2">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
