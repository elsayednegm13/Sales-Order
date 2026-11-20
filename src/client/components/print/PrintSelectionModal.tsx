import { useEffect, useState } from 'react';
import { api, ApiClientError } from '@/client/lib/api';
import { exportOrderSheetExcel } from '@/client/lib/sheetExport';
import { useExcelExport } from '@/client/lib/useExcelExport';
import type { ClientOrderDetailDTO, DailySheetDetailDTO, DailySheetListItemDTO } from '@/shared/types';
import { OrderSheetPrint, type SheetPrintModel } from '@/client/components/print/OrderSheetPrint';

export function PrintSelectionModal({
  open,
  initialSheetId,
  onClose,
}: {
  open: boolean;
  initialSheetId?: number;
  onClose: () => void;
}) {
  const [sheets, setSheets] = useState<DailySheetListItemDTO[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [sheetId, setSheetId] = useState<number | null>(initialSheetId ?? null);
  const [detail, setDetail] = useState<DailySheetDetailDTO | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [orderQuery, setOrderQuery] = useState('');
  const [job, setJob] = useState<SheetPrintModel | null>(null);
  const { isExporting, runExport } = useExcelExport();

  useEffect(() => {
    if (!open) return;
    setPage(1);
    setSheetId(initialSheetId ?? null);
  }, [initialSheetId, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.dailySheets
      .list({ page, pageSize: 100 })
      .then((res) => {
        if (cancelled) return;
        setSheets(res.sheets);
        setTotal(res.total);
        setSheetId((current) => current ?? (!initialSheetId && page === 1 ? res.sheets[0]?.id ?? null : current));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiClientError ? err.message : 'تعذر تحميل الأوردرات');
      });
    setOrderQuery('');
    return () => {
      cancelled = true;
    };
  }, [initialSheetId, open, page]);

  useEffect(() => {
    if (!open || !sheetId) return;
    api.dailySheets
      .get(sheetId)
      .then((res) => {
        setDetail(res.sheet);
        setSelected(res.sheet.orders.map((order) => order.id));
        setOrderQuery('');
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err.message : 'تعذر تحميل الأوردر');
      });
  }, [open, sheetId]);

  const chosenOrders = (detail?.orders ?? []).filter((order) => selected.includes(order.id));
  const term = orderQuery.trim().toLowerCase();
  const visibleOrders = (detail?.orders ?? []).filter((order) => {
    if (!term) return true;
    return order.customerName.toLowerCase().includes(term) || order.customerCode.toLowerCase().includes(term);
  });
  const visibleIds = visibleOrders.map((order) => order.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));

  const toggleAll = () => {
    setSelected((current) =>
      allVisibleSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : [...new Set([...current, ...visibleIds])]
    );
  };

  const printNow = () => {
    if (!detail || chosenOrders.length === 0) {
      setError('اختر طلباً واحداً على الأقل للطباعة');
      return;
    }
    const previousTitle = document.title;
    document.title = `SALES ORDER ${detail.sheetNumber}`;
    const restoreTitle = () => {
      document.title = previousTitle;
      window.removeEventListener('afterprint', restoreTitle);
    };
    window.addEventListener('afterprint', restoreTitle);
    setJob({ sheet: detail, orders: chosenOrders });
    window.setTimeout(() => window.print(), 50);
  };

  const toggle = (order: ClientOrderDetailDTO) => {
    setSelected((current) =>
      current.includes(order.id) ? current.filter((id) => id !== order.id) : [...current, order.id]
    );
  };

  return (
    <>
      {open && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-slate-950/50" onClick={onClose} />
          <div className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
            <div className="sticky top-0 z-10 shrink-0 bg-white px-5 pt-5 dark:bg-[#111827]">
              <h2 className="text-base font-bold">اختيار الأوردر المراد طباعته</h2>
              <p className="mt-1 text-xs text-slate-500">حدد الشيت ثم الطلبات التي تظهر في كشف ORDERS NO.</p>
              {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
              <label className="mt-4 block text-xs font-bold">
                أوردر اليوم
                <select
                  value={sheetId ?? ''}
                  onChange={(event) => setSheetId(Number(event.target.value))}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                >
                  {sheets.map((sheet) => (
                    <option key={sheet.id} value={sheet.id}>
                      ORDERS NO {sheet.sheetNumber} — {sheet.sheetDate}
                    </option>
                  ))}
                </select>
              </label>
              <input
                value={orderQuery}
                onChange={(event) => setOrderQuery(event.target.value)}
                placeholder="بحث باسم العميل أو الكود"
                className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
              {total > 100 && (
                <div className="mt-3 flex items-center justify-between text-xs font-bold">
                  <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border px-3 py-1.5 disabled:opacity-40 dark:border-slate-700">السابق</button>
                  <span className="tabular-nums">{page} / {Math.ceil(total / 100)}</span>
                  <button type="button" disabled={page * 100 >= total} onClick={() => setPage((current) => current + 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40 dark:border-slate-700">التالي</button>
                </div>
              )}
              <div className="mt-3 flex items-center justify-between pb-2">
                <span className="text-xs font-bold">طلبات العملاء</span>
                <button type="button" className="text-xs font-bold text-blue-600 dark:text-blue-300 dark:hover:text-blue-100" onClick={toggleAll}>
                  تحديد الكل
                </button>
              </div>
            </div>
            <ul className="mx-5 mb-3 max-h-[320px] min-h-0 flex-1 divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {visibleOrders.map((order) => (
                <li key={order.id}>
                  <label className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span>
                      <span className="font-bold">{order.customerCode}</span> {order.customerName}
                      <span className="mt-0.5 block text-xs text-slate-500">{order.deliveryLocation}</span>
                    </span>
                    <input type="checkbox" checked={selected.includes(order.id)} onChange={() => toggle(order)} />
                  </label>
                </li>
              ))}
              {detail && visibleOrders.length === 0 && (
                <li className="px-3 py-4 text-center text-xs text-slate-500">
                  {detail.orders.length === 0 ? 'هذا الأوردر لا يحتوي طلبات.' : 'لا توجد طلبات مطابقة للبحث.'}
                </li>
              )}
            </ul>
            <div className="sticky bottom-0 z-10 flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-[#111827]">
              <button type="button" onClick={onClose} className="rounded-xl border px-4 py-2 text-sm font-bold dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white">إغلاق</button>
              <button
                type="button"
                disabled={isExporting || !detail}
                onClick={() => {
                  if (!detail) return;
                  void runExport(() => exportOrderSheetExcel(detail, chosenOrders)).catch(() => setError('تعذر تصدير ملف Excel'));
                }}
                className="rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white"
              >
                Excel
              </button>
              <button type="button" onClick={printNow} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">طباعة</button>
            </div>
          </div>
        </div>
      )}
      {job && <OrderSheetPrint model={job} />}
    </>
  );
}
