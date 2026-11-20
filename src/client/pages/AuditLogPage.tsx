import React, { useEffect, useState } from 'react';
import { ChevronDown, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { api, ApiClientError } from '@/client/lib/api';
import { auditExportFilename, exportAuditLog } from '@/client/lib/auditLogExport';
import { useExcelExport } from '@/client/lib/useExcelExport';
import { useToast } from '@/client/components/ui/Toast';
import {
  AUDIT_MODULES,
  auditActionLabel,
  auditModuleLabel,
  cairoMonth,
  cairoToday,
  describeAuditDetails,
  formatCairoDateTime,
  monthBounds,
  type AuditActorOption,
  type AuditLogEntry,
} from '@/shared/auditLog';

type Period = 'all' | 'daily' | 'monthly' | 'custom';

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'all', label: 'الكل' },
  { id: 'daily', label: 'يومي' },
  { id: 'monthly', label: 'شهري' },
  { id: 'custom', label: 'فترة محددة' },
];

function rangeFor(period: Period, day: string, month: string, from: string, to: string): { from?: string; to?: string } {
  if (period === 'daily') return { from: day, to: day };
  if (period === 'monthly') return monthBounds(month);
  if (period === 'custom' && from && to) return { from, to };
  return {};
}

export function AuditLogPage() {
  const { notify } = useToast();
  const { isExporting, runExport } = useExcelExport();
  const [period, setPeriod] = useState<Period>('all');
  const [day, setDay] = useState(cairoToday);
  const [month, setMonth] = useState(cairoMonth);
  const [from, setFrom] = useState(cairoToday);
  const [to, setTo] = useState(cairoToday);
  const [moduleName, setModuleName] = useState('');
  const [actorUserId, setActorUserId] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [actors, setActors] = useState<AuditActorOption[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const load = async (nextPage = page) => {
    setLoading(true);
    try {
      const bounds = rangeFor(period, day, month, from, to);
      const result = await api.auditLogs.list({
        page: nextPage,
        pageSize,
        module: moduleName || undefined,
        actorUserId: actorUserId || undefined,
        q: query.trim() || undefined,
        ...bounds,
      });
      setLogs(result.logs);
      setActors(result.actors);
      setTotal(result.total);
      setPage(result.page);
    } catch (error) {
      notify(error instanceof ApiClientError ? error.message : 'تعذر تحميل سجل النشاط', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(1);
    // Filters reset the page. The load function closes over the current filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, day, month, from, to, moduleName, actorUserId, query]);

  const exportExcel = () => {
    void runExport(async () => {
      const bounds = rangeFor(period, day, month, from, to);
      const result = await api.auditLogs.list({
        export: true,
        module: moduleName || undefined,
        actorUserId: actorUserId || undefined,
        q: query.trim() || undefined,
        ...bounds,
      });
      await exportAuditLog(result.logs, auditExportFilename(period, from, to, month), result.truncated);
      if (result.truncated) notify('تم تصدير أحدث 5000 سجل مطابق للتصفية');
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">سجل النشاط</h2>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{total}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load(page)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
            <RefreshCw className="h-3.5 w-3.5" />تحديث
          </button>
          <button type="button" disabled={isExporting || total === 0} onClick={exportExcel} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-emerald-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-emerald-300">
            <FileSpreadsheet className="h-3.5 w-3.5" />{isExporting ? 'جارٍ التصدير...' : 'تصدير Excel'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-300 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-950">
            {PERIODS.map((item) => (
              <button key={item.id} type="button" onClick={() => setPeriod(item.id)} className={`rounded-md px-2.5 py-1 text-xs font-bold ${period === item.id ? 'bg-blue-600 text-white' : 'text-slate-700 dark:text-slate-200'}`}>{item.label}</button>
            ))}
          </div>
          {period === 'daily' && <input dir="ltr" type="date" value={day} onChange={(event) => setDay(event.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />}
          {period === 'monthly' && <input dir="ltr" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />}
          {period === 'custom' && (
            <>
              <label className="text-xs font-bold text-slate-500">من<input dir="ltr" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mr-1 h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></label>
              <label className="text-xs font-bold text-slate-500">إلى<input dir="ltr" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mr-1 h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></label>
            </>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <select value={moduleName} onChange={(event) => setModuleName(event.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
            <option value="">كل الأقسام</option>
            {AUDIT_MODULES.map((item) => <option key={item} value={item}>{auditModuleLabel(item)}</option>)}
          </select>
          <select value={actorUserId} onChange={(event) => setActorUserId(event.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
            <option value="">كل المستخدمين</option>
            {actors.filter((actor) => actor.id != null).map((actor) => (
              <option key={`${actor.id}-${actor.username}`} value={String(actor.id)}>{actor.fullName} (@{actor.username})</option>
            ))}
          </select>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث في الملخص أو العنصر..." className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="min-w-full text-right text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 font-bold">الوقت</th>
                <th className="px-3 py-2 font-bold">المنفّذ</th>
                <th className="px-3 py-2 font-bold">القسم</th>
                <th className="px-3 py-2 font-bold">الإجراء</th>
                <th className="px-3 py-2 font-bold">الملخص</th>
                <th className="px-3 py-2 font-bold" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-slate-500">جارٍ التحميل...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-slate-500">لا توجد سجلات مطابقة</td></tr>
              ) : logs.map((row) => {
                const details = describeAuditDetails(row.details);
                const open = openId === row.id;
                return (
                  <React.Fragment key={row.id}>
                    <tr className="border-t border-slate-100 dark:border-slate-800">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600 dark:text-slate-300">{formatCairoDateTime(row.createdAt)}</td>
                      <td className="px-3 py-2 text-xs font-bold text-slate-800 dark:text-slate-100">{row.actorFullName}<div className="font-medium text-slate-500" dir="ltr">@{row.actorUsername}</div></td>
                      <td className="px-3 py-2 text-xs">{auditModuleLabel(row.module)}</td>
                      <td className="px-3 py-2 text-xs font-bold">{auditActionLabel(row.action)}</td>
                      <td className="px-3 py-2 text-xs text-slate-700 dark:text-slate-200">{row.summary}</td>
                      <td className="px-3 py-2">
                        {(details.length > 0 || row.ipAddress) && (
                          <button type="button" onClick={() => setOpenId(open ? null : row.id)} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 dark:text-slate-300">
                            <ChevronDown className={`h-3.5 w-3.5 ${open ? 'rotate-180' : ''}`} />تفاصيل
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-t border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                        <td colSpan={6} className="px-4 py-3 text-xs leading-6 text-slate-700 dark:text-slate-200">
                          {details.map((line) => <p key={line}>{line}</p>)}
                          {row.ipAddress && <p>عنوان IP: <span dir="ltr">{row.ipAddress}</span></p>}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 dark:border-slate-800">
          <p className="text-xs font-bold text-slate-500">صفحة {page} من {pageCount}</p>
          <div className="flex gap-1">
            <button type="button" disabled={page <= 1} onClick={() => void load(page - 1)} className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-40 dark:border-slate-700 dark:text-slate-200">السابق</button>
            <button type="button" disabled={page >= pageCount} onClick={() => void load(page + 1)} className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-40 dark:border-slate-700 dark:text-slate-200">التالي</button>
          </div>
        </div>
      </div>
    </div>
  );
}
