import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardList, FileSpreadsheet, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { api, ApiClientError } from '@/client/lib/api';
import { exportRowsToExcel } from '@/client/lib/export';
import { useExcelExport } from '@/client/lib/useExcelExport';
import { localDateInputValue } from '@/client/lib/localDate';
import { useBranding } from '@/client/contexts/BrandingContext';
import { Pagination } from '@/client/components/ui/Pagination';
import { SkeletonTableRows } from '@/client/components/ui/Skeleton';
import { PrintSelectionModal } from '@/client/components/print/PrintSelectionModal';
import { useAuth } from '@/client/contexts/AuthContext';
import { useSilentAutoRefresh } from '@/client/hooks/useSilentAutoRefresh';
import { useToast } from '@/client/components/ui/Toast';
import type { DailySheetListItemDTO } from '@/shared/types';

const fieldClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

export function DailySheetsPage() {
  const { user, refreshUser } = useAuth();
  const { refreshSettings } = useBranding();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const canCreate = user?.role === 'admin' || Boolean(user?.permissions.dailySheets.create);
  const canDelete = user?.role === 'admin' || Boolean(user?.permissions.dailySheets.delete);
  const canExport = user?.role === 'admin' || Boolean(user?.permissions.reports.exportExcel);
  const canPrint = user?.role === 'admin' || Boolean(user?.permissions.reports.exportPdf);

  const [status, setStatus] = useState<'' | 'open' | 'closed' | 'archived'>('');
  const [sheetQuery, setSheetQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const appliedSearch = useRef('');
  const { isExporting, runExport } = useExcelExport();
  const [page, setPage] = useState(1);
  const [sheets, setSheets] = useState<DailySheetListItemDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [nextNumber, setNextNumber] = useState('1000');
  const [isLoading, setIsLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [sheetNumber, setSheetNumber] = useState('');
  const [sheetDate, setSheetDate] = useState(() => localDateInputValue());
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const savingOrderRef = useRef(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const etagRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.dailySheets.listSilent({ status, page, pageSize: 20, search: debouncedSearch });
      if (res.notModified) return;
      etagRef.current = res.etag;
      setSheets(res.data.sheets);
      setTotal(res.data.total);
      setNextNumber(res.data.nextSheetNumber);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : 'تعذر تحميل أوردرات اليوم', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, notify, page, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = sheetQuery.trim();
      if (appliedSearch.current === next) return;
      appliedSearch.current = next;
      setDebouncedSearch(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [sheetQuery]);

  useEffect(() => {
    etagRef.current = null;
  }, [status, page, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  useSilentAutoRefresh({
    paused: modalOpen || printOpen || confirmId !== null,
    resetKey: `${status}|${page}|${debouncedSearch}`,
    onTick: async (signal) => {
      const res = await api.dailySheets.listSilent({
        status,
        page,
        pageSize: 20,
        search: debouncedSearch,
        etag: etagRef.current,
        signal,
      });
      if (res.notModified) {
        etagRef.current = res.etag ?? etagRef.current;
        return;
      }
      etagRef.current = res.etag;
      setSheets(res.data.sheets);
      setTotal(res.data.total);
      setNextNumber(res.data.nextSheetNumber);
    },
  });

  useEffect(() => {
    if (!isLoading && params.get('new') === '1' && canCreate) {
      setSheetNumber(nextNumber);
      setSheetDate(localDateInputValue());
      setNotes('');
      setFormError(null);
      setModalOpen(true);
      setParams({}, { replace: true });
    }
  }, [canCreate, isLoading, nextNumber, params, setParams]);

  const openCreate = () => {
    setSheetNumber(nextNumber);
    setSheetDate(localDateInputValue());
    setNotes('');
    setFormError(null);
    setModalOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingOrderRef.current || isSaving) return;
    savingOrderRef.current = true;
    setIsSaving(true);
    setFormError(null);
    try {
      const res = await api.dailySheets.create({
        sheetNumber: sheetNumber.trim(),
        sheetDate,
        notes: notes.trim() || null,
      });
      setModalOpen(false);
      notify(`تم فتح الأوردر رقم ${res.sheet.sheetNumber}`);
      await Promise.all([refreshSettings(), refreshUser()]);
      navigate(`/daily-sheets/${res.sheet.id}`);
    } catch (err) {
      setFormError(err instanceof ApiClientError ? err.message : 'تعذر فتح الأوردر');
    } finally {
      savingOrderRef.current = false;
      setIsSaving(false);
    }
  };

  const remove = async (sheet: DailySheetListItemDTO) => {
    if (sheet.status === 'closed' || sheet.status === 'archived') {
      notify('لا يمكن حذف أوردر مغلق أو مؤرشف. أعد فتحه أولاً.', 'error');
      setConfirmId(null);
      return;
    }
    if (sheet.orderCount > 0) {
      notify(`لا يمكن حذف أوردر اليوم لوجود ${sheet.orderCount} طلب مسجل بداخله؛ احذف الطلبات أولاً أو أرشف الأوردر`, 'error');
      setConfirmId(null);
      return;
    }
    try {
      await api.dailySheets.remove(sheet.id);
      setConfirmId(null);
      notify(`تم حذف الأوردر ${sheet.sheetNumber}`);
      await Promise.all([load(), refreshSettings(), refreshUser()]);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : 'تعذر حذف الأوردر', 'error');
    }
  };

  return (
    <div className="space-y-3">
      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-950">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">أوردر اليوم</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">القادم: <span dir="ltr" className="font-mono font-bold">{nextNumber}</span></p>
        </div>
        <div className="inline-flex flex-wrap items-center overflow-hidden rounded-lg border border-slate-200 bg-white text-xs dark:border-slate-800 dark:bg-slate-900">
          <span className="tabular-nums px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200">إجمالي الأوردرات: {total.toLocaleString('en-US')}</span>
          <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <span className="tabular-nums px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200">مفتوح: {sheets.filter((sheet) => sheet.status === 'open').length.toLocaleString('en-US')}</span>
          <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <span className="tabular-nums px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200">الكراتين: {sheets.reduce((sum, sheet) => sum + sheet.totalCartons, 0).toLocaleString('en-US')}</span>
        </div>
      </section>
      <div className="no-print sticky top-16 z-20 -mx-4 flex flex-col justify-between gap-2 border-y border-slate-200 bg-slate-50/95 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:flex-row lg:items-center lg:px-8 dark:border-slate-800 dark:bg-slate-950/95">
        <div className="relative w-full min-w-[240px] lg:w-80">
          <Search className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={sheetQuery}
            onChange={(event) => {
              setSheetQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              const term = sheetQuery.trim();
              const exact = sheets.find((sheet) => sheet.sheetNumber === term);
              if (exact) navigate(`/daily-sheets/${exact.id}`);
            }}
            placeholder="بحث برقم الأوردر 2523..."
            className="h-9 w-full rounded-lg border border-slate-300 bg-white pr-9 pl-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <select
          aria-label="تصفية حالة الأوردر"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as '' | 'open' | 'closed' | 'archived');
            setPage(1);
          }}
          className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="">كل الحالات</option>
          <option value="open">مفتوح</option>
          <option value="closed">مغلق</option>
          <option value="archived">مؤرشف</option>
        </select>
        <div className="flex flex-wrap gap-2.5">
          {canExport && (
            <button type="button" disabled={sheets.length === 0 || isExporting} onClick={() => void runExport(() => exportRowsToExcel({
              filename: `أوردرات-اليوم-${new Date().toISOString().slice(0, 10)}.xlsx`,
              sheetName: 'أوردرات اليوم',
              rows: sheets,
              columns: [
                { header: 'رقم الأوردر', width: 16, accessor: (row) => row.sheetNumber },
                { header: 'التاريخ', width: 14, accessor: (row) => row.sheetDate },
                { header: 'الحالة', width: 12, accessor: (row) => (row.status === 'open' ? 'مفتوح' : row.status === 'closed' ? 'مغلق' : 'مؤرشف') },
                { header: 'الكراتين', width: 12, accessor: (row) => row.totalCartons },
                { header: 'القطع', width: 12, accessor: (row) => row.totalPieces },
                { header: 'عدد الطلبات', width: 14, accessor: (row) => row.orderCount },
              ],
            }))} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-800 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800/90 dark:text-emerald-300 dark:hover:border-emerald-600 dark:hover:bg-emerald-950 dark:hover:text-emerald-100">
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              تصدير Excel
            </button>
          )}
          {canPrint && (
            <button type="button" onClick={() => setPrintOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-800 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-700 dark:hover:text-white">
              <Printer className="h-4 w-4" />
              طباعة
            </button>
          )}
          {canCreate && (
            <button type="button" onClick={openCreate} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700">
              <Plus className="h-3.5 w-3.5" />
              إنشاء أوردر يوم جديد
            </button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
        <table className="w-full border-collapse text-right text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              <th className="px-4 py-2">رقم الأوردر</th>
              <th className="px-3 py-2">التاريخ</th>
              <th className="px-3 py-2">الحالة</th>
              <th className="px-3 py-2">الكراتين</th>
              <th className="px-3 py-2">القطع</th>
              <th className="no-print px-4 py-2">الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {isLoading ? (
              <SkeletonTableRows rows={8} columns={6} />
            ) : sheets.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-14 text-center">
                  <ClipboardList className="mx-auto h-9 w-9 text-slate-400" />
                  <p className="mt-3 text-sm font-bold">لا توجد أوردرات في هذا العرض</p>
                  <p className="mt-1 text-xs text-slate-500">الرقم التالي المقترح هو {nextNumber} ويمكن تعديله عند الفتح.</p>
                </td>
              </tr>
            ) : sheets.map((sheet) => (
              <tr key={sheet.id} className="text-slate-800 dark:text-slate-100">
                <td className="px-4 py-2 font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-white">{sheet.sheetNumber}</td>
                <td dir="ltr" className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">{sheet.sheetDate}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${sheet.status === 'open' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>
                    {sheet.status === 'open' ? 'مفتوح' : sheet.status === 'closed' ? 'مغلق' : 'مؤرشف'}
                  </span>
                </td>
                <td className="px-3 py-2 font-semibold tabular-nums text-slate-900 dark:text-white">{sheet.totalCartons.toLocaleString('en-US')}</td>
                <td className="px-3 py-2 font-semibold tabular-nums text-slate-900 dark:text-white">{sheet.totalPieces.toLocaleString('en-US')}</td>
                <td className="no-print px-4 py-2">
                  <div className="flex items-center justify-end gap-1.5">
                    <Link to={`/daily-sheets/${sheet.id}`} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white">عرض وتعديل</Link>
                    {canDelete && (confirmId === sheet.id ? (
                      <button type="button" onClick={() => void remove(sheet)} className="rounded bg-red-600 px-2 py-1 text-[11px] font-bold text-white">تأكيد الحذف</button>
                    ) : (
                      <button type="button" onClick={() => setConfirmId(sheet.id)} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 dark:border-slate-700 dark:hover:bg-red-950/70 dark:hover:text-red-200" aria-label={`حذف الأوردر ${sheet.sheetNumber}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <Pagination page={page} pageSize={20} total={total} onPage={setPage} />

      {modalOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs" role="dialog" aria-modal="true" onClick={() => !isSaving && setModalOpen(false)}>
          <form onSubmit={submit} onClick={(event) => event.stopPropagation()} className="relative z-10 w-full max-w-md rounded-lg border border-slate-200 border-r-4 border-r-blue-600 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <h2 className="text-base font-bold">إنشاء أوردر يوم جديد</h2>
            <p className="mt-1 text-xs text-slate-500">الرقم يُقترح تلقائياً من آخر أوردر أو من رقم البداية، ويمكنك تغييره.</p>
            {formError && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">{formError}</p>}
            <label className="mt-4 block text-xs font-bold">رقم الأوردر
              <input dir="ltr" required value={sheetNumber} onChange={(event) => setSheetNumber(event.target.value)} className={`${fieldClass} mt-1.5 text-left`} />
            </label>
            <label className="mt-3 block text-xs font-bold">التاريخ
              <input dir="ltr" required type="date" value={sheetDate} onChange={(event) => setSheetDate(event.target.value)} className={`${fieldClass} mt-1.5 text-left`} />
            </label>
            <label className="mt-3 block text-xs font-bold">ملاحظات
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className={`${fieldClass} mt-1.5`} rows={2} />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border px-4 py-2 text-sm font-bold dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white">إلغاء</button>
              <button type="submit" disabled={isSaving} className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-60">فتح الأوردر</button>
            </div>
          </form>
        </div>
      )}
      <PrintSelectionModal open={printOpen} onClose={() => setPrintOpen(false)} />
    </div>
  );
}
