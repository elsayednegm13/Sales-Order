import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Edit3,
  FileSpreadsheet,
  Layers,
  Loader2,
  Plus,
  Printer,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiClientError } from '@/client/lib/api';
import { exportRowsToExcel, triggerPrintPdfView } from '@/client/lib/export';
import { useExcelExport } from '@/client/lib/useExcelExport';
import { ReportPrint } from '@/client/components/print/ReportPrint';
import { useAuth } from '@/client/contexts/AuthContext';
import { Pagination } from '@/client/components/ui/Pagination';
import { BulkImportModal } from '@/client/components/import/BulkImportModal';
import { useToast } from '@/client/components/ui/Toast';
import {
  CATEGORY_LABELS_AR,
  formatPackingLabel,
  formatWeightLabel,
  GRADE_LABELS_AR,
  ITEM_TYPE_LABELS_AR,
  ITEM_TYPES,
  PRODUCT_CATEGORIES,
  PRODUCT_GRADES,
} from '@/shared/labels';
import { requiresPacking } from '@/shared/domain';
import type { ItemType, ProductCategory, ProductDTO, ProductGrade } from '@/shared/types';

interface ProductForm {
  code: string;
  name: string;
  category: ProductCategory;
  grade: ProductGrade;
  itemType: ItemType;
  packingCapacity: string;
  weight: string;
  isActive: boolean;
}

const EMPTY_FORM: ProductForm = {
  code: '',
  name: '',
  category: 'blanket',
  grade: 'first_grade',
  itemType: 'carton',
  packingCapacity: '',
  weight: '',
  isActive: true,
};

const fieldClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

export function CatalogPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const canManage = Boolean(user?.role === 'admin' || user?.permissions.catalog.manage);
  const canBulkImport = Boolean(user?.role === 'admin' || user?.permissions.catalog.bulkImport);
  const canDelete = Boolean(user?.role === 'admin' || user?.permissions.catalog.delete);
  const canExport = Boolean(user?.role === 'admin' || user?.permissions.reports.exportExcel);
  const canPrint = Boolean(user?.role === 'admin' || user?.permissions.reports.exportPdf);
  const { isExporting, runExport } = useExcelExport();

  const [products, setProducts] = useState<ProductDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<'' | ProductCategory>('');
  const [grade, setGrade] = useState<'' | ProductGrade>('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [itemType, setItemType] = useState<'' | ItemType>('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProductDTO | null>(null);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const loadProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.products.list({ sort: 'code' });
      setProducts(res.products);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : 'تعذر تحميل الكتالوج', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    setPage(1);
  }, [search, category, grade, status, itemType]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((item) => {
      if (category && item.category !== category) return false;
      if (grade && item.grade !== grade) return false;
      if (status === 'active' && !item.isActive) return false;
      if (status === 'inactive' && item.isActive) return false;
      if (itemType && item.itemType !== itemType) return false;
      if (!query) return true;
      return item.code.toLowerCase().includes(query) || item.name.toLowerCase().includes(query);
    });
  }, [products, search, category, grade, status, itemType]);

  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (product: ProductDTO) => {
    setEditing(product);
    setForm({
      code: product.code,
      name: product.name,
      category: product.category,
      grade: product.grade,
      itemType: product.itemType,
      packingCapacity: product.itemType === 'piece' || product.itemType === 'kg' ? '' : String(product.packingCapacity),
      weight: product.weight ?? '',
      isActive: product.isActive,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const submitForm = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    const packed = requiresPacking(form.itemType);
    const packing = packed ? Number(form.packingCapacity) : 0;
    if (!form.code.trim()) {
      setFormError('يرجى إدخال كود الصنف');
      return;
    }
    if (form.name.trim().length < 2) {
      setFormError('يرجى إدخال اسم الصنف');
      return;
    }
    if (packed && (!Number.isInteger(packing) || packing < 1)) {
      setFormError('سعة التعبئة يجب أن تكون رقماً صحيحاً أكبر من صفر');
      return;
    }

    setFormError(null);
    savingRef.current = true;
    setIsSaving(true);
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      category: form.category,
      grade: form.grade,
      itemType: form.itemType,
      packingCapacity: packing,
      weight: form.weight.trim() || null,
      isActive: form.isActive,
    };
    try {
      if (editing) {
        const res = await api.products.update(editing.id, payload);
        setProducts((prev) => prev.map((item) => (item.id === res.product.id ? res.product : item)));
        notify('تم تحديث بيانات الصنف');
      } else {
        const res = await api.products.create(payload);
        setProducts((prev) =>
          [...prev, res.product].sort((a, b) => a.code.localeCompare(b.code, 'ar'))
        );
        notify('تمت إضافة الصنف إلى الكتالوج');
      }
      setEditing(null);
      setModalOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiClientError ? err.message : 'تعذر حفظ الصنف');
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const toggleActive = async (product: ProductDTO) => {
    setBusyId(product.id);
    try {
      const res = await api.products.update(product.id, { isActive: !product.isActive });
      setProducts((prev) => prev.map((item) => (item.id === res.product.id ? res.product : item)));
      notify(res.product.isActive ? `تم تفعيل ${res.product.name}` : `تم إيقاف ${res.product.name}`);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : 'تعذر تغيير حالة الصنف', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const removeProduct = async (product: ProductDTO) => {
    setBusyId(product.id);
    try {
      await api.products.remove(product.id);
      setProducts((prev) => prev.filter((item) => item.id !== product.id));
      setConfirmDeleteId(null);
      notify(`تم حذف ${product.name}`);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : 'تعذر حذف الصنف', 'error');
      setConfirmDeleteId(null);
    } finally {
      setBusyId(null);
    }
  };

  const exportExcel = () => {
    void runExport(() => exportRowsToExcel({
      filename: 'الكتالوج.xlsx',
      sheetName: 'الكتالوج',
      rows: products,
      columns: [
        { header: 'كود الصنف', width: 16, accessor: (row) => row.code },
        { header: 'اسم الصنف', width: 32, accessor: (row) => row.name },
        { header: 'الفئة', width: 14, accessor: (row) => CATEGORY_LABELS_AR[row.category] },
        { header: 'الدرجة', width: 14, accessor: (row) => GRADE_LABELS_AR[row.grade] },
        { header: 'نوع التحميل', width: 14, accessor: (row) => ITEM_TYPE_LABELS_AR[row.itemType] },
        { header: 'التعبئة', width: 12, accessor: (row) => (requiresPacking(row.itemType) ? row.packingCapacity : '') },
        { header: 'الوزن المرجعي', width: 16, accessor: (row) => row.weight ?? '' },
        { header: 'الحالة', width: 12, accessor: (row) => (row.isActive ? 'نشط' : 'موقوف') },
      ],
    }));
  };

  const catalogPrintRows = products.map((product, index) => [
    index + 1,
    product.code,
    product.name,
    CATEGORY_LABELS_AR[product.category],
    GRADE_LABELS_AR[product.grade],
    ITEM_TYPE_LABELS_AR[product.itemType],
    requiresPacking(product.itemType) ? product.packingCapacity : '',
    product.weight ?? '',
  ]);

  return (
    <>
    <div className="no-print space-y-3">
      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-950">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">الكتالوج والمنتجات</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">أصناف الجملة ووحدات التحميل والتعبئة القياسية</p>
        </div>
        <div className="inline-flex flex-wrap items-center overflow-hidden rounded-lg border border-slate-200 bg-white text-xs dark:border-slate-800 dark:bg-slate-900">
          <span className="tabular-nums px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200">إجمالي الأصناف: {products.length.toLocaleString('en-US')}</span>
          <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <span className="tabular-nums px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200">الأصناف النشطة: {products.filter((item) => item.isActive).length.toLocaleString('en-US')}</span>
          <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <span className="tabular-nums px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200">غير نشط: {products.filter((item) => !item.isActive).length.toLocaleString('en-US')}</span>
        </div>
      </section>

      <div className="no-print sticky top-16 z-20 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
          <div className="relative w-52 shrink-0">
            <Search className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث بالكود أو اسم الصنف..."
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pr-9 pl-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
          <div className="flex w-full min-w-0 flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-950">
            <button type="button" onClick={() => setItemType('')} className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-bold ${itemType === '' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white'}`}>الكل</button>
            {ITEM_TYPES.map((type) => (
              <button key={type} type="button" onClick={() => setItemType(type)} className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-bold ${itemType === type ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white'}`}>{ITEM_TYPE_LABELS_AR[type]}</button>
            ))}
          </div>
          <select
            aria-label="تصفية الحالة"
            value={status}
            onChange={(event) => setStatus(event.target.value as 'all' | 'active' | 'inactive')}
            className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value="all">كل الحالات</option>
            <option value="active">الأصناف النشطة</option>
            <option value="inactive">الأصناف الموقوفة</option>
          </select>
          <select
            aria-label="تصفية الفئة"
            value={category}
            onChange={(event) => setCategory(event.target.value as '' | ProductCategory)}
            className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value="">كل الفئات</option>
            {PRODUCT_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {CATEGORY_LABELS_AR[item]}
              </option>
            ))}
          </select>
          <select
            aria-label="تصفية الدرجة"
            value={grade}
            onChange={(event) => setGrade(event.target.value as '' | ProductGrade)}
            className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value="">كل الدرجات</option>
            {PRODUCT_GRADES.map((item) => (
              <option key={item} value={item}>
                {GRADE_LABELS_AR[item]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
          {canManage && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              إضافة صنف
            </button>
          )}
          {canBulkImport && (
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white"
            >
              <FileSpreadsheet className="h-4 w-4 text-blue-600" />
              استيراد Excel
            </button>
          )}
          {canExport && (
            <button
              type="button"
              onClick={exportExcel}
              disabled={filtered.length === 0 || isExporting}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800/90 dark:text-emerald-300 dark:hover:border-emerald-600 dark:hover:bg-emerald-950 dark:hover:text-emerald-100"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              تصدير Excel
            </button>
          )}
          {canPrint && (
            <button
              type="button"
              onClick={triggerPrintPdfView}
              disabled={filtered.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white"
            >
              <Printer className="h-4 w-4" />
              طباعة
            </button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {isLoading ? (
                <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />)}</div>
              ) : filtered.length === 0 ? (
                <div className="px-6 py-14 text-center">
                    <Layers className="mx-auto h-9 w-9 text-slate-400" />
                    <p className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-200">
                      لا توجد أصناف مطابقة
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      غيّر التصفية، أو أضف صنفاً جديداً مع سعة التعبئة والوزن المرجعي.
                    </p>
                </div>
              ) : (
                pageItems.map((product) => (
                  modalOpen && editing?.id === product.id ? (
                    <div key={product.id} className="p-3">
                      <form onSubmit={submitForm} className="rounded-lg border border-slate-200 border-r-4 border-r-blue-600 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                        <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                          <h2 className="text-sm font-bold text-slate-900 dark:text-white">تعديل {product.name}</h2>
                          <button type="button" onClick={() => { setModalOpen(false); setEditing(null); }} aria-label="إغلاق" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white">✕</button>
                        </div>
                        {formError && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">{formError}</p>}
                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                          <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">الكود<input dir="ltr" required value={form.code} onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))} className={`${fieldClass} mt-1 text-left`} /></label>
                          <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">اسم الصنف<input required value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} className={`${fieldClass} mt-1`} /></label>
                          <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">الفئة<select value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value as ProductCategory }))} className={`${fieldClass} mt-1`}>{PRODUCT_CATEGORIES.map((item) => <option key={item} value={item}>{CATEGORY_LABELS_AR[item]}</option>)}</select></label>
                          <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">الدرجة<select value={form.grade} onChange={(event) => setForm((prev) => ({ ...prev, grade: event.target.value as ProductGrade }))} className={`${fieldClass} mt-1`}>{PRODUCT_GRADES.map((item) => <option key={item} value={item}>{GRADE_LABELS_AR[item]}</option>)}</select></label>
                          <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">نوع التحميل<select value={form.itemType} onChange={(event) => setForm((prev) => ({ ...prev, itemType: event.target.value as ItemType }))} className={`${fieldClass} mt-1`}>{ITEM_TYPES.map((item) => <option key={item} value={item}>{ITEM_TYPE_LABELS_AR[item]}</option>)}</select></label>
                          {requiresPacking(form.itemType) && <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">التعبئة<input dir="ltr" required type="number" min={1} step={1} value={form.packingCapacity} onChange={(event) => setForm((prev) => ({ ...prev, packingCapacity: event.target.value }))} className={`${fieldClass} mt-1 text-left`} /></label>}
                          <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">الوزن المرجعي<input dir="ltr" value={form.weight} onChange={(event) => setForm((prev) => ({ ...prev, weight: event.target.value }))} className={`${fieldClass} mt-1 text-left`} /></label>
                        </div>
                        <label className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">الصنف نشط<input type="checkbox" checked={form.isActive} onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))} className="h-4 w-4 accent-blue-600" /></label>
                        <div className="mt-3 flex justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                          <button type="button" onClick={() => { setModalOpen(false); setEditing(null); }} className="h-9 rounded-lg border border-slate-300 px-3 text-xs font-bold dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white">إلغاء</button>
                          <button type="submit" disabled={isSaving} className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-bold text-white disabled:opacity-60">{isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}حفظ التعديل</button>
                        </div>
                      </form>
                    </div>
                  ) : (
                  <div key={product.id} className="grid grid-cols-12 items-center gap-3 px-4 py-2.5 hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <div className="col-span-12 flex min-w-0 items-center gap-2.5 sm:col-span-5">
                      <span dir="ltr" className="rounded bg-blue-600 px-2 py-0.5 font-mono text-xs font-bold text-white">{product.code}</span>
                      <span className="min-w-0 whitespace-normal break-words text-sm font-bold text-slate-900 dark:text-white">{product.name}</span>
                    </div>
                    <div className="col-span-12 flex flex-wrap items-center gap-4 text-xs tabular-nums sm:col-span-5 sm:text-sm">
                      <span className="inline-flex w-16 items-center gap-1.5 text-slate-600 dark:text-slate-300">
                        <span className={`h-1.5 w-1.5 rounded-full ${product.itemType === 'bag' ? 'bg-indigo-500' : product.itemType === 'piece' ? 'bg-amber-500' : product.itemType === 'kg' ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                        {ITEM_TYPE_LABELS_AR[product.itemType]}
                      </span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{requiresPacking(product.itemType) ? `التعبئة القياسية: ${formatPackingLabel(product.packingCapacity, product.itemType)}` : formatWeightLabel(product.weight)}</span>
                      <span className="text-slate-500 dark:text-slate-400">{GRADE_LABELS_AR[product.grade]}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${product.isActive ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>{product.isActive ? 'نشط' : 'موقوف'}</span>
                    </div>
                    <div className="col-span-12 flex justify-end sm:col-span-2">
                      {(canManage || canDelete) && (
                        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-950">
                          {canManage && (
                          <button type="button" onClick={() => openEdit(product)} title="تعديل" aria-label="تعديل" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white">
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          )}
                          {canManage && (
                          <button type="button" disabled={busyId === product.id} onClick={() => void toggleActive(product)} className="px-2 text-[11px] font-bold text-slate-600 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white">
                            {product.isActive ? 'إيقاف' : 'تفعيل'}
                          </button>
                          )}
                          {canDelete && (confirmDeleteId === product.id ? (
                            <span className="inline-flex items-center gap-1 px-1">
                              <button type="button" onClick={() => void removeProduct(product)} className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white">تأكيد</button>
                              <button type="button" onClick={() => setConfirmDeleteId(null)} className="text-[11px] font-semibold text-slate-500">إلغاء</button>
                            </span>
                          ) : (
                            <button type="button" onClick={() => setConfirmDeleteId(product.id)} title="حذف" aria-label={`حذف ${product.name}`} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/70 dark:hover:text-red-200">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  )
                ))
              )}
        </div>
      </div>

      <Pagination page={currentPage} pageSize={pageSize} total={filtered.length} onPage={setPage} />

      <BulkImportModal open={importOpen} mode="products" products={products} customers={[]} onClose={() => setImportOpen(false)} onImported={loadProducts} />
      {modalOpen && !editing && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-xs sm:p-4" role="dialog" aria-modal="true" onClick={() => !isSaving && setModalOpen(false)}>
          <form
            onSubmit={submitForm}
            onClick={(event) => event.stopPropagation()}
            className="relative z-10 flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-slate-200 border-r-4 border-r-blue-600 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  إضافة منتج جديد
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  الوزن مرجع للرد على العميل ولا يدخل في حساب الكراتين أو القطع.
                </p>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="إغلاق" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {formError && (
              <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                {formError}
              </p>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                الكود
                <input dir="ltr" required value={form.code} onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))} className={`${fieldClass} mt-1.5 text-left`} />
              </label>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                اسم الصنف
                <input required value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} className={`${fieldClass} mt-1.5`} />
              </label>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                الفئة
                <select value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value as ProductCategory }))} className={`${fieldClass} mt-1.5`}>
                  {PRODUCT_CATEGORIES.map((item) => (
                    <option key={item} value={item}>{CATEGORY_LABELS_AR[item]}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                الدرجة
                <select value={form.grade} onChange={(event) => setForm((prev) => ({ ...prev, grade: event.target.value as ProductGrade }))} className={`${fieldClass} mt-1.5`}>
                  {PRODUCT_GRADES.map((item) => (
                    <option key={item} value={item}>{GRADE_LABELS_AR[item]}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 sm:col-span-2">
                نوع التحميل
                <select
                  value={form.itemType}
                  onChange={(event) => setForm((prev) => ({ ...prev, itemType: event.target.value as ItemType }))}
                  className={`${fieldClass} mt-1.5`}
                >
                  {ITEM_TYPES.map((item) => (
                    <option key={item} value={item}>{ITEM_TYPE_LABELS_AR[item]}</option>
                  ))}
                </select>
              </label>
              {requiresPacking(form.itemType) && (
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  التعبئة
                  <input dir="ltr" required type="number" min={1} step={1} value={form.packingCapacity} onChange={(event) => setForm((prev) => ({ ...prev, packingCapacity: event.target.value }))} className={`${fieldClass} tabular-nums mt-1.5 text-left`} />
                </label>
              )}
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                الوزن المرجعي
                <input dir="ltr" value={form.weight} onChange={(event) => setForm((prev) => ({ ...prev, weight: event.target.value }))} placeholder="2.5" className={`${fieldClass} mt-1.5 text-left`} />
              </label>
            </div>
            <label className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-bold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              الصنف نشط ومتاح في الأوردرات
              <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))} className="h-4 w-4 accent-blue-600" />
            </label>
            </div>
            <div className="flex shrink-0 justify-end gap-2.5 border-t border-slate-200 px-4 py-4 dark:border-slate-800">
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white">
                إلغاء
              </button>
              <button type="submit" disabled={isSaving} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                إضافة الصنف
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
    <ReportPrint
      title="الكتالوج والمنتجات"
      columns={['م', 'كود الصنف', 'اسم المنتج', 'الفئة', 'الدرجة', 'نوع التحميل', 'التعبئة', 'الوزن المرجعي']}
      rows={catalogPrintRows}
    />
    </>
  );
}
