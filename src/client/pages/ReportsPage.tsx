import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Printer, Search } from 'lucide-react';
import { api, ApiClientError } from '@/client/lib/api';
import { localDateInputValue } from '@/client/lib/localDate';
import { exportSalesReport } from '@/client/lib/reportExport';
import { useExcelExport } from '@/client/lib/useExcelExport';
import { useAuth } from '@/client/contexts/AuthContext';
import { useBranding } from '@/client/contexts/BrandingContext';
import { useToast } from '@/client/components/ui/Toast';
import { ITEM_TYPE_LABELS_AR } from '@/shared/labels';
import type { CustomerDTO, ProductDTO, ReportPeriod, SalesReportDTO } from '@/shared/types';

const PERIODS: Array<{ id: ReportPeriod; label: string }> = [
  { id: 'daily', label: 'يومي' },
  { id: 'monthly', label: 'شهري' },
  { id: 'yearly', label: 'سنوي' },
  { id: 'custom', label: 'فترة مخصصة' },
];

const emptyReport: SalesReportDTO = {
  period: 'daily',
  label: '',
  from: '',
  to: '',
  summary: { totalSheets: 0, totalOrders: 0, totalCartons: 0, totalPieces: 0, totalWeightKg: 0, uniqueCustomers: 0 },
  customers: [],
  products: [],
};

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function modeDot(mode: string): string {
  if (mode === 'bag') return 'bg-indigo-500';
  if (mode === 'piece') return 'bg-amber-500';
  if (mode === 'kg') return 'bg-emerald-500';
  return 'bg-blue-500';
}

export function ReportsPage() {
  const { user } = useAuth();
  const { settings } = useBranding();
  const { notify } = useToast();
  const { isExporting, runExport } = useExcelExport();
  const canExport = user?.role === 'admin' || Boolean(user?.permissions.reports.exportExcel);
  const canPrint = user?.role === 'admin' || Boolean(user?.permissions.reports.exportPdf);
  const today = localDateInputValue();

  const [period, setPeriod] = useState<ReportPeriod>('daily');
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [year, setYear] = useState(today.slice(0, 4));
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [customerId, setCustomerId] = useState('');
  const [productId, setProductId] = useState('');
  const [deliveryType, setDeliveryType] = useState<'all' | 'warehouse' | 'sub_merchant'>('all');
  const [status, setStatus] = useState<'all' | 'open' | 'closed'>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'customers' | 'products'>('customers');
  const [expandAll, setExpandAll] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [customers, setCustomers] = useState<CustomerDTO[]>([]);
  const [products, setProducts] = useState<ProductDTO[]>([]);
  const [report, setReport] = useState<SalesReportDTO>(emptyReport);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void api.customers.list().then((res) => setCustomers(res.customers)).catch(() => undefined);
    void api.products.list().then((res) => setProducts(res.products)).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    void api.reports.get({
      period,
      date: period === 'daily' ? date : undefined,
      month: period === 'monthly' ? month : undefined,
      year: period === 'yearly' ? year : undefined,
      from: period === 'custom' ? from : undefined,
      to: period === 'custom' ? to : undefined,
      customerId: customerId || undefined,
      productId: productId || undefined,
      deliveryType,
      status,
    }).then((res) => {
      if (!cancelled) setReport(res.report);
    }).catch((err) => {
      if (!cancelled) notify(err instanceof ApiClientError ? err.message : 'تعذر تحميل التقرير', 'error');
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [period, date, month, year, from, to, customerId, productId, deliveryType, status, notify]);

  const term = query.trim().toLowerCase();
  const visibleCustomers = useMemo(() => {
    if (!term) return report.customers;
    return report.customers.filter((customer) =>
      customer.customerName.toLowerCase().includes(term)
      || customer.clientCode.toLowerCase().includes(term)
      || customer.channels.some((channel) => (channel.subMerchantName ?? '').toLowerCase().includes(term))
    );
  }, [report.customers, term]);
  const visibleProducts = useMemo(() => {
    if (!term) return report.products;
    return report.products.filter((product) => product.productName.toLowerCase().includes(term) || product.productCode.toLowerCase().includes(term));
  }, [report.products, term]);

  return (
    <>
      <div className="no-print space-y-3">
        <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">التقارير والإحصائيات</h2>
            <span className="rounded-md border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">{report.label || '—'}</span>
          </div>
          <div className="inline-flex flex-wrap items-center overflow-hidden rounded-lg border border-slate-200 bg-white text-xs dark:border-slate-800 dark:bg-slate-900">
            <span className="tabular-nums px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200">الأوردرات: {formatCount(report.summary.totalSheets)}</span>
            <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
            <span className="tabular-nums px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200">الطلبات: {formatCount(report.summary.totalOrders)}</span>
            <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
            <span className="tabular-nums px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200">الكراتين: {formatCount(report.summary.totalCartons)}</span>
            <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
            <span className="tabular-nums px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200">القطع: {formatCount(report.summary.totalPieces)}</span>
            <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
            <span className="tabular-nums px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200">الوزن كجم: {formatCount(report.summary.totalWeightKg)}</span>
          </div>
        </section>

        <div className="no-print sticky top-16 z-20 -mx-4 flex flex-col gap-2 border-y border-slate-200 bg-slate-50/95 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 dark:border-slate-800 dark:bg-slate-950/95">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
                {PERIODS.map((item) => (
                  <button key={item.id} type="button" onClick={() => setPeriod(item.id)} className={`rounded-md px-2.5 py-1 text-xs font-bold ${period === item.id ? 'bg-blue-600 text-white' : 'text-slate-700 dark:text-slate-200'}`}>{item.label}</button>
                ))}
              </div>
              {period === 'daily' && <input dir="ltr" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900" />}
              {period === 'monthly' && <input dir="ltr" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900" />}
              {period === 'yearly' && <input dir="ltr" type="number" min={2000} max={2100} value={year} onChange={(event) => setYear(event.target.value)} className="h-9 w-24 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900" />}
              {period === 'custom' && (
                <>
                  <input dir="ltr" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
                  <input dir="ltr" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
                </>
              )}
              <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} aria-label="العميل" className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                <option value="">كل العملاء</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.clientCode} — {customer.name}</option>)}
              </select>
              <select value={deliveryType} onChange={(event) => setDeliveryType(event.target.value as 'all' | 'warehouse' | 'sub_merchant')} aria-label="جهة التسليم" className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                <option value="all">كل جهات التسليم</option>
                <option value="warehouse">مخزن العميل</option>
                <option value="sub_merchant">تاجر فرعي</option>
              </select>
              <select value={status} onChange={(event) => setStatus(event.target.value as 'all' | 'open' | 'closed')} aria-label="حالة الأوردر" className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                <option value="all">كل الحالات</option>
                <option value="open">مفتوح</option>
                <option value="closed">مغلق</option>
              </select>
              <select value={productId} onChange={(event) => setProductId(event.target.value)} aria-label="الصنف" className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                <option value="">كل الأصناف</option>
                {products.map((product) => <option key={product.id} value={product.id}>{product.code} — {product.name}</option>)}
              </select>
              <div className="relative w-full min-w-[280px] sm:w-80">
                <Search className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث بالعميل أو الصنف..." className="h-9 w-full rounded-lg border border-slate-300 bg-white pr-9 pl-3 text-sm dark:border-slate-700 dark:bg-slate-900" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
                <button type="button" onClick={() => setView('customers')} className={`rounded-md px-2.5 py-1 text-xs font-bold ${view === 'customers' ? 'bg-blue-600 text-white' : 'text-slate-700 dark:text-slate-200'}`}>مسحوبات العملاء والتجار</button>
                <button type="button" onClick={() => setView('products')} className={`rounded-md px-2.5 py-1 text-xs font-bold ${view === 'products' ? 'bg-blue-600 text-white' : 'text-slate-700 dark:text-slate-200'}`}>مسحوبات الأصناف</button>
              </div>
              {view === 'customers' && (
                <button type="button" onClick={() => { setExpandAll((value) => !value); setExpanded({}); }} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-900">{expandAll ? 'طي الكل' : 'توسيع الكل'}</button>
              )}
              {canExport && <button type="button" disabled={isExporting} onClick={() => void runExport(() => exportSalesReport(report))} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"><FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />تصدير Excel</button>}
              {canPrint && <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-900"><Printer className="h-3.5 w-3.5" />طباعة</button>}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}</div>
        ) : view === 'products' ? (
          <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {visibleProducts.length === 0 ? <p className="px-4 py-10 text-center text-sm text-slate-500">لا توجد مسحوبات أصناف في هذه الفترة.</p> : visibleProducts.map((product) => (
                <div key={product.productId} className="grid grid-cols-12 items-center gap-3 px-4 py-2.5">
                  <div className="col-span-12 flex min-w-0 items-center gap-2 sm:col-span-5">
                    <span dir="ltr" className="rounded bg-blue-600 px-2 py-0.5 font-mono text-xs font-bold text-white">{product.productCode}</span>
                    <span className="truncate text-sm font-bold text-slate-900 dark:text-white">{product.productName}</span>
                  </div>
                  <div className="col-span-12 flex flex-wrap items-center gap-4 text-xs tabular-nums sm:col-span-7 sm:text-sm">
                    <span className="inline-flex w-16 items-center gap-1.5 text-slate-600 dark:text-slate-300"><span className={`h-1.5 w-1.5 rounded-full ${modeDot(product.unitType)}`} />{ITEM_TYPE_LABELS_AR[product.unitType]}</span>
                    <span className="text-slate-600 dark:text-slate-300">{formatCount(product.ordersCount)} طلب</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-100">{formatCount(product.totalCartons)} كرتونة</span>
                    <span className="font-bold text-slate-900 dark:text-white">{formatCount(product.totalPieces)} قطعة</span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-400">{formatCount(product.totalWeightKg)} كجم</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : visibleCustomers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700">لا توجد مسحوبات عملاء في هذه الفترة.</p>
        ) : (
          <div className="space-y-3">
            {visibleCustomers.map((customer) => {
              const open = expanded[customer.customerId] ?? expandAll;
              return (
                <article key={customer.customerId} className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
                  <header onClick={() => setExpanded((prev) => ({ ...prev, [customer.customerId]: !open }))} className={`flex cursor-pointer flex-wrap items-center justify-between gap-3 bg-slate-50/90 px-4 py-2.5 dark:bg-slate-800/60 ${open ? 'border-b border-slate-200/70 dark:border-slate-800' : ''}`}>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-sm text-slate-500" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
                      <span dir="ltr" className="rounded-md bg-blue-600 px-2.5 py-0.5 font-mono text-xs font-bold text-white">{customer.clientCode}</span>
                      <span className="text-sm font-bold text-slate-900 dark:text-white">{customer.customerName}</span>
                      <span className="rounded-md bg-slate-200/80 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{formatCount(customer.ordersCount)} طلب</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                      <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950">{formatCount(customer.totalCartons)} كرتونة</span>
                      <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950">{formatCount(customer.totalPieces)} قطعة</span>
                      <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950">{formatCount(customer.totalWeightKg)} كجم</span>
                    </div>
                  </header>
                  {open && (
                    <div className="max-h-80 overflow-y-auto bg-white p-3 dark:bg-slate-900">
                      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                        {customer.channels.map((channel) => (
                          <div key={`${channel.deliveryType}-${channel.subMerchantId ?? 0}`} className="rounded-lg border border-slate-200/80 bg-slate-50/50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40">
                            <p className="text-sm font-bold text-slate-900 dark:text-white">{channel.deliveryType === 'sub_merchant' ? `تاجر: ${channel.subMerchantName ?? '—'}` : 'مخزن العميل'}</p>
                            <p className="mt-0.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">{formatCount(channel.ordersCount)} طلب · {formatCount(channel.totalCartons)} كرتونة · {formatCount(channel.totalPieces)} قطعة · {formatCount(channel.totalWeightKg)} كجم</p>
                            <ul className="mt-2 space-y-1">
                              {channel.products.map((product) => (
                                <li key={product.productId} className="flex items-center justify-between gap-2 text-xs">
                                  <span className="min-w-0 truncate"><span dir="ltr" className="font-mono">{product.productCode}</span> {product.productName}</span>
                                  <span className="shrink-0 tabular-nums text-slate-600 dark:text-slate-300">{formatCount(product.totalPieces)} قطعة</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
      <section className="analytics-print">
        <link rel="stylesheet" href="/fonts/cairo.css" />
        <header className="analytics-print-head">
          <strong>{settings.companyName}</strong>
          <span>{report.label}</span>
        </header>
        <h1>تقرير المبيعات</h1>
        <p>من {report.from} إلى {report.to} — الأوردرات {report.summary.totalSheets} — الطلبات {report.summary.totalOrders} — الكراتين {report.summary.totalCartons} — القطع {report.summary.totalPieces} — الوزن {report.summary.totalWeightKg} كجم</p>
        <h2>العملاء والتجار</h2>
        <table>
          <thead><tr><th>الكود</th><th>العميل</th><th>جهة التسليم</th><th>الطلبات</th><th>الكراتين</th><th>القطع</th><th>الوزن</th></tr></thead>
          <tbody>
            {report.customers.flatMap((customer) => (customer.channels.length ? customer.channels : [{ deliveryType: 'client_warehouse' as const, subMerchantId: null, subMerchantName: null, ordersCount: customer.ordersCount, totalCartons: customer.totalCartons, totalPieces: customer.totalPieces, totalWeightKg: customer.totalWeightKg, products: [] }]).map((channel) => (
              <tr key={`${customer.customerId}-${channel.deliveryType}-${channel.subMerchantId ?? 0}`}>
                <td>{customer.clientCode}</td>
                <td>{customer.customerName}</td>
                <td>{channel.deliveryType === 'sub_merchant' ? channel.subMerchantName : 'مخزن العميل'}</td>
                <td>{channel.ordersCount}</td>
                <td>{channel.totalCartons}</td>
                <td>{channel.totalPieces}</td>
                <td>{channel.totalWeightKg}</td>
              </tr>
            )))}
          </tbody>
        </table>
        <h2>الأصناف</h2>
        <table>
          <thead><tr><th>الكود</th><th>الصنف</th><th>النمط</th><th>الطلبات</th><th>الكراتين</th><th>القطع</th><th>الوزن</th></tr></thead>
          <tbody>
            {report.products.map((product) => (
              <tr key={product.productId}>
                <td>{product.productCode}</td>
                <td>{product.productName}</td>
                <td>{ITEM_TYPE_LABELS_AR[product.unitType]}</td>
                <td>{product.ordersCount}</td>
                <td>{product.totalCartons}</td>
                <td>{product.totalPieces}</td>
                <td>{product.totalWeightKg}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
