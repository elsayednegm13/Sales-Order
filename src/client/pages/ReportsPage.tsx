import { Fragment, useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Printer, Search } from 'lucide-react';
import { api, ApiClientError } from '@/client/lib/api';
import { localDateInputValue } from '@/client/lib/localDate';
import { exportCustomerWithdrawals, exportFulfillmentReport, exportProductWithdrawals } from '@/client/lib/reportExport';
import { useExcelExport } from '@/client/lib/useExcelExport';
import { useAuth } from '@/client/contexts/AuthContext';
import { useBranding } from '@/client/contexts/BrandingContext';
import { useToast } from '@/client/components/ui/Toast';
import { ITEM_TYPE_LABELS_AR } from '@/shared/labels';
import type { CustomerDTO, FulfillmentReportDTO, FulfillmentStatus, ProductDTO, ReportPeriod, ReportProductTotalDTO, ReportSheetProductsDTO, SalesReportDTO } from '@/shared/types';

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
  productsBySheet: [],
};

function formatCount(value: number | null | undefined): string {
  const parsed = Number(value ?? 0);
  return (Number.isFinite(parsed) ? parsed : 0).toLocaleString('en-US');
}

function formatWeight(value: number | null | undefined): string {
  return formatCount(value);
}

function hasMovement(cartons: number, pieces: number, weightKg: number): boolean {
  return cartons > 0 || pieces > 0 || weightKg > 0;
}

const PRODUCT_ROW_GRID = 'grid grid-cols-1 items-center gap-2 lg:grid-cols-[minmax(220px,1.4fr)_80px_75px_minmax(170px,1fr)_minmax(160px,1fr)_minmax(160px,1fr)]';
const DEFAULT_CHANNEL_PREVIEW = 4;

function movementLine(cartons: number, pieces: number, weightKg: number): string {
  const parts = [`${formatCount(cartons)} كرتونة`, `${formatCount(pieces)} قطعة`];
  if (weightKg > 0) parts.push(`${formatWeight(weightKg)} كجم`);
  return parts.join(' · ');
}

function ProductPrintTable({ title, footLabel, products }: { title: string; footLabel: string; products: ReportProductTotalDTO[] }) {
  const totals = sumSheetProducts(products);
  return (
    <div className="sheet-block">
      <h2>{title}</h2>
      <table>
        <thead><tr><th>الصنف</th><th>الكراتين</th><th>القطع</th><th>الوزن</th><th>خرج كراتين</th><th>متبقي كراتين</th><th>خرج قطع</th><th>متبقي قطع</th><th>خرج وزن</th><th>متبقي وزن</th></tr></thead>
        <tbody>
          {products.map((product) => (
            <tr key={`${product.productId}-${product.unitType}`}>
              <td>{product.productCode} {product.productName}</td>
              <td>{formatCount(product.totalCartons)}</td>
              <td>{formatCount(product.totalPieces)}</td>
              <td>{formatWeight(product.totalWeightKg)}</td>
              <td>{formatCount(product.dispatchedCartons)}</td>
              <td>{formatCount(product.pendingCartons)}</td>
              <td>{formatCount(product.dispatchedPieces)}</td>
              <td>{formatCount(product.pendingPieces)}</td>
              <td>{formatWeight(product.dispatchedWeightKg)}</td>
              <td>{formatWeight(product.pendingWeightKg)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>{footLabel}</td>
            <td>{formatCount(totals.totalCartons)}</td>
            <td>{formatCount(totals.totalPieces)}</td>
            <td>{formatWeight(totals.totalWeightKg)}</td>
            <td>{formatCount(totals.dispatchedCartons)}</td>
            <td>{formatCount(totals.pendingCartons)}</td>
            <td>{formatCount(totals.dispatchedPieces)}</td>
            <td>{formatCount(totals.pendingPieces)}</td>
            <td>{formatWeight(totals.dispatchedWeightKg)}</td>
            <td>{formatWeight(totals.pendingWeightKg)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
function sumSheetProducts(products: ReportProductTotalDTO[]): ReportSheetProductsDTO['totals'] {
  return products.reduce((sum, product) => ({
    ordersCount: sum.ordersCount + product.ordersCount,
    totalCartons: sum.totalCartons + product.totalCartons,
    totalPieces: sum.totalPieces + product.totalPieces,
    totalWeightKg: sum.totalWeightKg + product.totalWeightKg,
    dispatchedCartons: sum.dispatchedCartons + product.dispatchedCartons,
    dispatchedPieces: sum.dispatchedPieces + product.dispatchedPieces,
    dispatchedWeightKg: sum.dispatchedWeightKg + product.dispatchedWeightKg,
    pendingCartons: sum.pendingCartons + product.pendingCartons,
    pendingPieces: sum.pendingPieces + product.pendingPieces,
    pendingWeightKg: sum.pendingWeightKg + product.pendingWeightKg,
  }), {
    ordersCount: 0,
    totalCartons: 0,
    totalPieces: 0,
    totalWeightKg: 0,
    dispatchedCartons: 0,
    dispatchedPieces: 0,
    dispatchedWeightKg: 0,
    pendingCartons: 0,
    pendingPieces: 0,
    pendingWeightKg: 0,
  });
}

function compactQty(cartons: number, pieces: number, weightKg: number): string | null {
  if (!hasMovement(cartons, pieces, weightKg)) return null;
  const parts = [`${formatCount(cartons)} كرتونة`, `${formatCount(pieces)} قطعة`];
  if (weightKg > 0) parts.push(`${formatWeight(weightKg)} كجم`);
  return parts.join(' · ');
}

const emptyFulfillment: FulfillmentReportDTO = {
  from: '',
  to: '',
  summary: {
    dispatchedCustomers: 0,
    pendingCustomers: 0,
    dispatched: { orders: 0, customers: 0, cartons: 0, pieces: 0, weightKg: 0 },
    pending: { orders: 0, customers: 0, cartons: 0, pieces: 0, weightKg: 0 },
    cancelled: { orders: 0, customers: 0, cartons: 0, pieces: 0, weightKg: 0 },
  },
  customerSummary: [],
  orders: [],
  page: 1,
  pageSize: 20,
  total: 0,
};

function fulfillmentLabel(status: FulfillmentStatus): string {
  if (status === 'dispatched') return 'تم الخروج';
  if (status === 'cancelled') return 'ملغي';
  return 'متبقي';
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
  const [activeFulfillment, setActiveFulfillment] = useState<'all' | 'dispatched' | 'pending'>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'customers' | 'products' | 'fulfillment'>('customers');
  const [fulfillmentStatus, setFulfillmentStatus] = useState<'all' | FulfillmentStatus>('all');
  const [fulfillmentPage, setFulfillmentPage] = useState(1);
  const [fulfillment, setFulfillment] = useState<FulfillmentReportDTO>(emptyFulfillment);
  const [fulfillmentLoading, setFulfillmentLoading] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [expandedProducts, setExpandedProducts] = useState<Record<string, boolean>>({});
  const [openOrders, setOpenOrders] = useState<Record<number, boolean>>({});
  const [showCustomerSummary, setShowCustomerSummary] = useState(true);
  const [printFulfillment, setPrintFulfillment] = useState<FulfillmentReportDTO | null>(null);
  const [fulfillmentNotice, setFulfillmentNotice] = useState<string | null>(null);
  const [fulfillmentBusy, setFulfillmentBusy] = useState<null | 'print' | 'excel'>(null);
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
      fulfillment: activeFulfillment,
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
  }, [period, date, month, year, from, to, customerId, productId, deliveryType, status, activeFulfillment, notify]);

  const fulfillmentRange = useMemo(() => {
    if (period === 'daily') return { from: date, to: date };
    if (period === 'monthly') {
      const [yearValue, monthValue] = month.split('-').map(Number);
      const lastDay = new Date(yearValue, monthValue, 0).getDate();
      return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
    }
    if (period === 'yearly') return { from: `${year}-01-01`, to: `${year}-12-31` };
    return { from, to };
  }, [period, date, month, year, from, to]);

  useEffect(() => {
    setFulfillmentPage(1);
  }, [fulfillmentRange.from, fulfillmentRange.to, fulfillmentStatus, customerId]);

  useEffect(() => {
    if (view !== 'fulfillment') return;
    let cancelled = false;
    setFulfillmentLoading(true);
    void api.reports.fulfillment({
      dateFrom: fulfillmentRange.from,
      dateTo: fulfillmentRange.to,
      status: fulfillmentStatus,
      customerId: customerId || undefined,
      page: fulfillmentPage,
      pageSize: 20,
    }).then((res) => {
      if (!cancelled) setFulfillment(res.report);
    }).catch((err) => {
      if (!cancelled) notify(err instanceof ApiClientError ? err.message : 'تعذر تحميل حصر الخروج', 'error');
    }).finally(() => {
      if (!cancelled) setFulfillmentLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [view, fulfillmentRange.from, fulfillmentRange.to, fulfillmentStatus, customerId, fulfillmentPage, notify]);

  const loadFullFulfillment = async (): Promise<{ report: FulfillmentReportDTO; truncated: boolean }> => {
    const orders: FulfillmentReportDTO['orders'] = [];
    let page = 1;
    let first = emptyFulfillment;
    let total = 0;
    do {
      const res = await api.reports.fulfillment({
        dateFrom: fulfillmentRange.from,
        dateTo: fulfillmentRange.to,
        status: fulfillmentStatus,
        customerId: customerId || undefined,
        page,
        pageSize: 100,
      });
      if (page === 1) first = res.report;
      orders.push(...res.report.orders);
      total = res.report.total;
      page += 1;
    } while (orders.length < total && orders.length < 2000 && page <= 20);
    return { report: { ...first, orders, total }, truncated: total > orders.length };
  };

  const reportFilters = `${report.from} → ${report.to} · ${activeFulfillment === 'dispatched' ? 'تم الخروج' : activeFulfillment === 'pending' ? 'متبقي' : 'الكل النشط'}`;

  const exportCurrent = async () => {
    if (view === 'fulfillment') {
      setFulfillmentBusy('excel');
      try {
        const packed = await loadFullFulfillment();
        setFulfillmentNotice(packed.truncated ? 'تم تصدير أول 2000 طلب فقط؛ النتائج المطابقة أكثر من هذا الحد.' : null);
        await exportFulfillmentReport(packed.report, { companyName: settings.companyName, filters: `${packed.report.from} → ${packed.report.to}` });
      } finally {
        setFulfillmentBusy(null);
      }
      return;
    }
    if (view === 'products') {
      await exportProductWithdrawals(filteredProductsBySheet, visibleProducts, report, { companyName: settings.companyName, filters: reportFilters });
      return;
    }
    await exportCustomerWithdrawals(report, { companyName: settings.companyName, filters: reportFilters });
  };

  const printCurrent = async () => {
    if (view !== 'fulfillment') {
      window.print();
      return;
    }
    setFulfillmentBusy('print');
    try {
      const packed = await loadFullFulfillment();
      setPrintFulfillment(packed.report);
      setFulfillmentNotice(packed.truncated ? 'تمت طباعة أول 2000 طلب فقط؛ النتائج المطابقة أكثر من هذا الحد.' : null);
      window.setTimeout(() => window.print(), 60);
    } finally {
      setFulfillmentBusy(null);
    }
  };

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
  const filteredProductsBySheet = useMemo(() => {
    return (report.productsBySheet ?? []).map((sheet) => {
      const products = term
        ? sheet.products.filter((product) => product.productName.toLowerCase().includes(term) || product.productCode.toLowerCase().includes(term))
        : sheet.products;
      return { ...sheet, products, totals: sumSheetProducts(products) };
    }).filter((sheet) => sheet.products.length > 0);
  }, [report.productsBySheet, term]);

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
              <select value={activeFulfillment} onChange={(event) => setActiveFulfillment(event.target.value as 'all' | 'dispatched' | 'pending')} aria-label="حالة الخروج النشط" className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                <option value="all">الكل النشط</option>
                <option value="dispatched">تم الخروج</option>
                <option value="pending">متبقي</option>
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
                <button type="button" onClick={() => setView('customers')} className={`rounded-md px-2.5 py-1 text-xs font-bold ${view === 'customers' ? 'bg-blue-600 text-white' : 'text-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white'}`}>مسحوبات العملاء والتجار</button>
                <button type="button" onClick={() => setView('products')} className={`rounded-md px-2.5 py-1 text-xs font-bold ${view === 'products' ? 'bg-blue-600 text-white' : 'text-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white'}`}>مسحوبات الأصناف</button>
                <button type="button" onClick={() => setView('fulfillment')} className={`rounded-md px-2.5 py-1 text-xs font-bold ${view === 'fulfillment' ? 'bg-blue-600 text-white' : 'text-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white'}`}>حصر الخروج والمتبقي</button>
              </div>
              {view === 'customers' && (
                <button type="button" onClick={() => { setExpandAll((value) => !value); setExpanded({}); }} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white">{expandAll ? 'طي الكل' : 'توسيع الكل'}</button>
              )}
              {canExport && <button type="button" disabled={isExporting || fulfillmentBusy !== null} onClick={() => void runExport(exportCurrent)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800/90 dark:text-emerald-300 dark:hover:border-emerald-600 dark:hover:bg-emerald-950 dark:hover:text-emerald-100"><FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />{fulfillmentBusy === 'excel' ? 'جارٍ التصدير...' : 'تصدير Excel'}</button>}
              {canPrint && <button type="button" disabled={fulfillmentBusy !== null} onClick={() => void printCurrent()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-700 dark:hover:text-white"><Printer className="h-3.5 w-3.5" />{fulfillmentBusy === 'print' ? 'جارٍ التجهيز...' : 'طباعة'}</button>}
            </div>
          </div>
        </div>

        {view === 'fulfillment' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
              <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
                <p className="text-[11px] font-bold text-emerald-800 dark:text-emerald-200">عملاء خرج لهم طلبات</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-950 dark:text-emerald-50">{formatCount(fulfillment.summary.dispatchedCustomers)}</p>
              </article>
              <article className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
                <p className="text-[11px] font-bold text-amber-900 dark:text-amber-100">عملاء متبقي لهم طلبات</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-amber-950 dark:text-amber-50">{formatCount(fulfillment.summary.pendingCustomers)}</p>
              </article>
              <article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">خرج</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{formatCount(fulfillment.summary.dispatched.orders)} طلب · {formatCount(fulfillment.summary.dispatched.cartons)} كرتونة · {formatCount(fulfillment.summary.dispatched.pieces)} قطعة · {formatWeight(fulfillment.summary.dispatched.weightKg)} كجم</p>
              </article>
              <article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <p className="text-[11px] font-bold text-amber-800 dark:text-amber-200">متبقي</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{formatCount(fulfillment.summary.pending.orders)} طلب · {formatCount(fulfillment.summary.pending.cartons)} كرتونة · {formatCount(fulfillment.summary.pending.pieces)} قطعة · {formatWeight(fulfillment.summary.pending.weightKg)} كجم</p>
              </article>
              <article className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
                <p className="text-[11px] font-bold text-red-800 dark:text-red-200">ملغي</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-red-950 dark:text-red-50">{formatCount(fulfillment.summary.cancelled.orders)} طلب · {formatCount(fulfillment.summary.cancelled.cartons)} كرتونة · {formatCount(fulfillment.summary.cancelled.pieces)} قطعة · {formatWeight(fulfillment.summary.cancelled.weightKg)} كجم</p>
              </article>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={fulfillmentStatus} onChange={(event) => setFulfillmentStatus(event.target.value as 'all' | FulfillmentStatus)} aria-label="حالة الخروج" className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                <option value="all">كل حالات الخروج</option>
                <option value="pending">متبقي</option>
                <option value="dispatched">تم الخروج</option>
                <option value="cancelled">ملغي</option>
              </select>
              <span className="text-xs text-slate-500 dark:text-slate-400">{fulfillment.from} → {fulfillment.to}</span>
              <button type="button" onClick={() => setShowCustomerSummary((open) => !open)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-700">{showCustomerSummary ? 'إخفاء ملخص العملاء' : 'ملخص العملاء وأصنافهم'}</button>
              {fulfillmentNotice ? <span className="text-xs font-bold text-amber-800 dark:text-amber-200">{fulfillmentNotice}</span> : null}
            </div>
            {showCustomerSummary && (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">ملخص العملاء وأصنافهم</h3>
                {fulfillment.customerSummary.length === 0 ? <p className="text-xs text-slate-500">لا يوجد عملاء بطلبات نشطة في هذه الفترة.</p> : fulfillment.customerSummary.map((customer) => {
                  const dispatchedProducts = customer.products.filter((product) => hasMovement(product.dispatchedCartons, product.dispatchedPieces, product.dispatchedWeightKg));
                  const pendingProducts = customer.products.filter((product) => hasMovement(product.pendingCartons, product.pendingPieces, product.pendingWeightKg));
                  const fullyDelivered = customer.pendingOrdersCount === 0 && pendingProducts.length === 0;
                  return (
                    <article key={customer.customerId} className="rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700">
                      <header className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span dir="ltr" className="rounded-md bg-blue-600 px-2 py-0.5 font-mono text-xs font-bold text-white">{customer.clientCode}</span>
                          <span className="truncate text-sm font-bold text-slate-900 dark:text-white">{customer.customerName}</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-100">خرج {formatCount(customer.dispatchedOrdersCount)} طلب · {formatCount(customer.dispatchedCartons)} كرتونة · {formatCount(customer.dispatchedPieces)} قطعة · {formatWeight(customer.dispatchedWeightKg)} كجم</span>
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-900 dark:bg-amber-950/70 dark:text-amber-100">متبقي {formatCount(customer.pendingOrdersCount)} طلب · {formatCount(customer.pendingCartons)} كرتونة · {formatCount(customer.pendingPieces)} قطعة · {formatWeight(customer.pendingWeightKg)} كجم</span>
                        </div>
                      </header>
                      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                        <section className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2 dark:border-emerald-900 dark:bg-emerald-950/30">
                          <h4 className="mb-2 text-xs font-bold text-emerald-800 dark:text-emerald-100">الأصناف التي خرجت فعلياً</h4>
                          {dispatchedProducts.length === 0 ? <p className="py-4 text-center text-xs text-slate-500 dark:text-slate-400">لم يخرج أي صنف بعد</p> : (
                            <div className="max-h-60 overflow-y-auto">
                              <table className="w-full table-fixed text-xs">
                                <thead className="sticky top-0 z-10 bg-emerald-50 dark:bg-emerald-950">
                                  <tr className="text-emerald-900 dark:text-emerald-100">
                                    <th className="w-[46%] px-1 py-1.5 text-right font-bold">الصنف</th>
                                    <th className="px-1 py-1.5 font-bold">كرتونة</th>
                                    <th className="px-1 py-1.5 font-bold">قطعة</th>
                                    <th className="px-1 py-1.5 font-bold">وزن (كجم)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {dispatchedProducts.map((product) => (
                                    <tr key={product.productId} className="border-t border-emerald-200/80 dark:border-emerald-900">
                                      <td className="px-1 text-slate-800 dark:text-slate-100">
                                        <div className="flex min-w-0 items-center gap-1.5 py-1.5">
                                          <span dir="ltr" className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{product.productCode}</span>
                                          <span className="truncate text-xs font-medium" title={product.productName}>{product.productName}</span>
                                        </div>
                                      </td>
                                      <td className="px-1 py-1.5 text-center tabular-nums">{formatCount(product.dispatchedCartons)}</td>
                                      <td className="px-1 py-1.5 text-center tabular-nums">{formatCount(product.dispatchedPieces)}</td>
                                      <td className="px-1 py-1.5 text-center tabular-nums">{formatWeight(product.dispatchedWeightKg)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </section>
                        <section className="rounded-lg border border-amber-200 bg-amber-50/70 p-2 dark:border-amber-900 dark:bg-amber-950/30">
                          <h4 className="mb-2 text-xs font-bold text-amber-900 dark:text-amber-100">الأصناف المتبقية</h4>
                          {fullyDelivered ? <p className="py-4 text-center text-xs font-bold text-emerald-700 dark:text-emerald-200">تم تسليم جميع الطلبات بالكامل ✓</p> : pendingProducts.length === 0 ? <p className="py-4 text-center text-xs text-slate-500 dark:text-slate-400">لا توجد كميات متبقية</p> : (
                            <div className="max-h-60 overflow-y-auto">
                              <table className="w-full table-fixed text-xs">
                                <thead className="sticky top-0 z-10 bg-amber-50 dark:bg-amber-950">
                                  <tr className="text-amber-950 dark:text-amber-100">
                                    <th className="w-[46%] px-1 py-1.5 text-right font-bold">الصنف</th>
                                    <th className="px-1 py-1.5 font-bold">كرتونة</th>
                                    <th className="px-1 py-1.5 font-bold">قطعة</th>
                                    <th className="px-1 py-1.5 font-bold">وزن (كجم)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {pendingProducts.map((product) => (
                                    <tr key={product.productId} className="border-t border-amber-200/80 dark:border-amber-900">
                                      <td className="px-1 text-slate-800 dark:text-slate-100">
                                        <div className="flex min-w-0 items-center gap-1.5 py-1.5">
                                          <span dir="ltr" className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{product.productCode}</span>
                                          <span className="truncate text-xs font-medium" title={product.productName}>{product.productName}</span>
                                        </div>
                                      </td>
                                      <td className="px-1 py-1.5 text-center tabular-nums">{formatCount(product.pendingCartons)}</td>
                                      <td className="px-1 py-1.5 text-center tabular-nums">{formatCount(product.pendingPieces)}</td>
                                      <td className="px-1 py-1.5 text-center tabular-nums">{formatWeight(product.pendingWeightKg)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </section>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {fulfillmentLoading ? (
              <div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <table className="min-w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                    <tr>
                      <th className="px-3 py-2">الأوردر</th>
                      <th className="px-3 py-2">التاريخ</th>
                      <th className="px-3 py-2">العميل</th>
                      <th className="px-3 py-2">جهة التسليم</th>
                      <th className="px-3 py-2">الكراتين</th>
                      <th className="px-3 py-2">القطع</th>
                      <th className="px-3 py-2">الوزن (كجم)</th>
                      <th className="px-3 py-2">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fulfillment.orders.length === 0 ? (
                      <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">لا توجد طلبات في هذه الفترة.</td></tr>
                    ) : fulfillment.orders.map((order) => {
                      const open = Boolean(openOrders[order.id]);
                      return (
                        <Fragment key={order.id}>
                          <tr className="cursor-pointer border-t border-slate-100 dark:border-slate-800" onClick={() => setOpenOrders((prev) => ({ ...prev, [order.id]: !open }))}>
                            <td className="px-3 py-2 font-mono">{open ? '⌃' : '⌄'} <span dir="ltr" className="inline-block tabular-nums">{order.sheetNumber}/{order.orderSequence}</span></td>
                            <td className="px-3 py-2">{order.sheetDate}</td>
                            <td className="px-3 py-2 font-semibold text-slate-900 dark:text-white">{order.customerName}</td>
                            <td className="px-3 py-2">{order.receiverName || '—'}</td>
                            <td className="px-3 py-2 tabular-nums">{formatCount(order.totalCartons)}</td>
                            <td className="px-3 py-2 tabular-nums">{formatCount(order.totalPieces)}</td>
                            <td className="px-3 py-2 tabular-nums">{formatWeight(order.totalWeightKg)}</td>
                            <td className="px-3 py-2">
                              <span className={`rounded-md px-1.5 py-0.5 font-bold ${order.fulfillmentStatus === 'dispatched' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200' : order.fulfillmentStatus === 'cancelled' ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-100'}`}>{fulfillmentLabel(order.fulfillmentStatus)}</span>
                            </td>
                          </tr>
                          {open && (
                            <tr className="bg-slate-50 dark:bg-slate-950/40">
                              <td colSpan={8} className="px-4 py-2">
                                {(order.items ?? []).length === 0 ? <p className="text-xs text-slate-500">لا توجد أصناف.</p> : (
                                  <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-200">
                                    {order.items.map((item, index) => (
                                      <li key={`${item.productCode}-${index}`}><span dir="ltr" className="font-mono">{item.productCode}</span> {item.productName} — {formatCount(item.cartonsQty)} كرتونة · {formatCount(item.totalPieces)} قطعة · {formatWeight(item.weightKg)} كجم</li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                {fulfillment.total > fulfillment.pageSize && (
                  <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 dark:border-slate-800">
                    <button type="button" disabled={fulfillment.page <= 1} onClick={() => setFulfillmentPage((page) => Math.max(1, page - 1))} className="h-8 rounded-lg border border-slate-300 px-2 text-xs font-bold disabled:opacity-40 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-700">السابق</button>
                    <span className="text-xs tabular-nums text-slate-500">{fulfillment.page} / {Math.ceil(fulfillment.total / fulfillment.pageSize)}</span>
                    <button type="button" disabled={fulfillment.page * fulfillment.pageSize >= fulfillment.total} onClick={() => setFulfillmentPage((page) => page + 1)} className="h-8 rounded-lg border border-slate-300 px-2 text-xs font-bold disabled:opacity-40 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-700">التالي</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}</div>
        ) : view === 'products' ? (
          <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            {visibleProducts.length === 0 ? <p className="px-4 py-10 text-center text-sm text-slate-500">لا توجد مسحوبات أصناف في هذه الفترة.</p> : (
              <>
                <div className={`${PRODUCT_ROW_GRID} hidden bg-slate-50/70 px-4 py-2 text-[11px] font-medium text-slate-500 lg:grid dark:bg-slate-800/40 dark:text-slate-400`}>
                  <span>الصنف</span>
                  <span>النمط</span>
                  <span>الطلبات</span>
                  <span>الإجمالي</span>
                  <span>تم الخروج</span>
                  <span>المتبقي</span>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {visibleProducts.map((product) => {
                    const dispatchedQuiet = product.dispatchedCartons === 0 && product.dispatchedPieces === 0;
                    const pendingQuiet = product.pendingCartons === 0 && product.pendingPieces === 0;
                    return (
                      <div key={product.productId} className={`${PRODUCT_ROW_GRID} px-4 py-2.5`}>
                        <div className="flex min-w-0 items-center gap-2">
                          <span dir="ltr" className="rounded bg-blue-600 px-2 py-0.5 font-mono text-xs font-bold text-white">{product.productCode}</span>
                          <span className="truncate text-sm font-bold text-slate-900 dark:text-white" title={product.productName}>{product.productName}</span>
                        </div>
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300"><span className={`h-1.5 w-1.5 rounded-full ${modeDot(product.unitType)}`} />{ITEM_TYPE_LABELS_AR[product.unitType]}</span>
                        <span className="text-xs tabular-nums text-slate-600 dark:text-slate-300">{formatCount(product.ordersCount)}</span>
                        <span className="text-xs font-semibold tabular-nums text-slate-800 dark:text-slate-100">{movementLine(product.totalCartons, product.totalPieces, product.totalWeightKg)}</span>
                        {dispatchedQuiet ? <span className="text-xs text-slate-400 dark:text-slate-500">—</span> : <span className="w-fit rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-100">{movementLine(product.dispatchedCartons, product.dispatchedPieces, product.dispatchedWeightKg)}</span>}
                        {pendingQuiet ? <span className="text-xs text-slate-400 dark:text-slate-500">{product.dispatchedCartons > 0 || product.dispatchedPieces > 0 ? <span className="text-emerald-700 dark:text-emerald-300">مكتمل ✓</span> : '—'}</span> : <span className="w-fit rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-amber-900 dark:bg-amber-950/70 dark:text-amber-100">{movementLine(product.pendingCartons, product.pendingPieces, product.pendingWeightKg)}</span>}
                      </div>
                    );
                  })}
                </div>
                <div className={`${PRODUCT_ROW_GRID} border-t border-slate-200 bg-slate-50/70 px-4 py-2 text-xs font-semibold dark:border-slate-800 dark:bg-slate-800/40`}>
                  <span className="text-slate-700 dark:text-slate-200">الإجمالي</span>
                  <span />
                  <span className="tabular-nums text-slate-600 dark:text-slate-300">{formatCount(visibleProducts.reduce((sum, product) => sum + product.ordersCount, 0))}</span>
                  <span className="tabular-nums text-slate-900 dark:text-white">{movementLine(visibleProducts.reduce((sum, product) => sum + product.totalCartons, 0), visibleProducts.reduce((sum, product) => sum + product.totalPieces, 0), visibleProducts.reduce((sum, product) => sum + product.totalWeightKg, 0))}</span>
                  <span className="tabular-nums text-emerald-800 dark:text-emerald-200">{movementLine(visibleProducts.reduce((sum, product) => sum + product.dispatchedCartons, 0), visibleProducts.reduce((sum, product) => sum + product.dispatchedPieces, 0), visibleProducts.reduce((sum, product) => sum + product.dispatchedWeightKg, 0))}</span>
                  <span className="tabular-nums text-amber-900 dark:text-amber-200">{movementLine(visibleProducts.reduce((sum, product) => sum + product.pendingCartons, 0), visibleProducts.reduce((sum, product) => sum + product.pendingPieces, 0), visibleProducts.reduce((sum, product) => sum + product.pendingWeightKg, 0))}</span>
                </div>
              </>
            )}
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
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-100">خرج {formatCount(customer.dispatchedOrdersCount)}</span>
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-900 dark:bg-amber-950/70 dark:text-amber-100">متبقي {formatCount(customer.pendingOrdersCount)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                      <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950">{formatCount(customer.totalCartons)} كرتونة</span>
                      <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950">{formatCount(customer.totalPieces)} قطعة</span>
                      <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950">{formatCount(customer.totalWeightKg)} كجم</span>
                    </div>
                  </header>
                  {open && (
                    <div className="bg-white p-2.5 dark:bg-slate-900">
                      <div className={customer.channels.length === 1 ? 'grid grid-cols-1 gap-2.5' : 'grid grid-cols-1 gap-2.5 xl:grid-cols-2'}>
                        {customer.channels.map((channel) => {
                          const channelKey = `${customer.customerId}:${channel.deliveryType}:${channel.subMerchantId ?? 0}`;
                          const showAll = Boolean(expandedProducts[channelKey]);
                          const visible = showAll ? channel.products : channel.products.slice(0, DEFAULT_CHANNEL_PREVIEW);
                          const scrollable = showAll && channel.products.length > DEFAULT_CHANNEL_PREVIEW;
                          return (
                            <div key={channelKey} className="min-w-0 rounded-lg border border-slate-200/80 bg-slate-50/50 p-2.5 dark:border-slate-800 dark:bg-slate-800/40">
                              <div className="mb-1 flex items-center justify-between gap-2 border-b border-slate-200/80 pb-1.5 dark:border-slate-700">
                                <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{channel.deliveryType === 'sub_merchant' ? `تاجر: ${channel.subMerchantName ?? '—'}` : 'مخزن العميل'}</p>
                                <p className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-slate-500 dark:text-slate-400">خرج {formatCount(channel.dispatchedOrdersCount)} طلب · متبقي {formatCount(channel.pendingOrdersCount)} طلب · {formatWeight(channel.totalWeightKg)} كجم</p>
                              </div>
                              <div className={scrollable ? 'max-h-60 overflow-y-auto' : undefined}>
                                <table className="w-full table-fixed text-xs">
                                  <thead className={scrollable ? 'sticky top-0 z-10 bg-slate-50 dark:bg-slate-800' : undefined}>
                                    <tr>
                                      <th className="w-[48%] px-2 py-1.5 text-right font-bold text-slate-700 dark:text-slate-200">الصنف</th>
                                      <th className="w-[26%] px-2 py-1.5 font-bold text-emerald-800 dark:text-emerald-200">تم الخروج</th>
                                      <th className="w-[26%] px-2 py-1.5 font-bold text-amber-900 dark:text-amber-200">متبقي</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {visible.map((product) => {
                                      const dispatched = compactQty(product.dispatchedCartons, product.dispatchedPieces, product.dispatchedWeightKg);
                                      const pending = compactQty(product.pendingCartons, product.pendingPieces, product.pendingWeightKg);
                                      return (
                                        <tr key={product.productId} className="border-t border-slate-200/80 dark:border-slate-700">
                                          <td className="px-2 py-1.5 text-slate-800 dark:text-slate-100">
                                            <div className="flex min-w-0 items-center gap-1.5">
                                              <span dir="ltr" className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{product.productCode}</span>
                                              <span className="truncate text-xs font-medium" title={product.productName}>{product.productName}</span>
                                            </div>
                                          </td>
                                          <td className="overflow-hidden px-2 py-1.5 text-center" title={dispatched ?? undefined}>
                                            <span className="block truncate whitespace-nowrap text-[11px] tabular-nums text-emerald-800 dark:text-emerald-200">{dispatched ?? <span className="text-slate-400 dark:text-slate-500">—</span>}</span>
                                          </td>
                                          <td className="overflow-hidden px-2 py-1.5 text-center" title={pending ?? undefined}>
                                            <span className="block truncate whitespace-nowrap text-[11px] tabular-nums text-amber-900 dark:text-amber-200">{pending ?? <span className="text-slate-400 dark:text-slate-500">—</span>}</span>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                              {channel.products.length > DEFAULT_CHANNEL_PREVIEW && (
                                <button type="button" onClick={() => setExpandedProducts((prev) => ({ ...prev, [channelKey]: !prev[channelKey] }))} className="mt-2 text-[11px] font-bold text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100">{showAll ? 'إخفاء الأصناف الإضافية' : `عرض باقي الأصناف (+${channel.products.length - DEFAULT_CHANNEL_PREVIEW})`}</button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
      {view === 'fulfillment' ? (
        <section className="analytics-print">
          <link rel="stylesheet" href="/fonts/cairo.css" />
          <header className="analytics-print-head">
            <strong>{settings.companyName}</strong>
            <span>{(printFulfillment ?? fulfillment).from} → {(printFulfillment ?? fulfillment).to}</span>
          </header>
          <h1>حصر الخروج والمتبقي</h1>
          <p>عملاء خرج لهم طلبات: {(printFulfillment ?? fulfillment).summary.dispatchedCustomers} — عملاء متبقي لهم طلبات: {(printFulfillment ?? fulfillment).summary.pendingCustomers} — خرج {(printFulfillment ?? fulfillment).summary.dispatched.orders} طلب / {formatCount((printFulfillment ?? fulfillment).summary.dispatched.cartons)} كرتونة / {formatWeight((printFulfillment ?? fulfillment).summary.dispatched.weightKg)} كجم — متبقي {(printFulfillment ?? fulfillment).summary.pending.orders} طلب / {formatCount((printFulfillment ?? fulfillment).summary.pending.cartons)} كرتونة / {formatWeight((printFulfillment ?? fulfillment).summary.pending.weightKg)} كجم</p>
          <table>
            <thead><tr><th>الأوردر</th><th>التاريخ</th><th>العميل</th><th>الحالة</th><th>الصنف</th><th>الكراتين</th><th>القطع</th><th>الوزن (كجم)</th></tr></thead>
            <tbody>
              {(printFulfillment ?? fulfillment).orders.flatMap((order) => [
                <tr key={order.id} className="order-head">
                  <td><span dir="ltr" className="inline-block tabular-nums">{order.sheetNumber}/{order.orderSequence}</span></td>
                  <td>{order.sheetDate}</td>
                  <td>{order.customerName}</td>
                  <td>{fulfillmentLabel(order.fulfillmentStatus)}</td>
                  <td>{order.receiverName}</td>
                  <td>{formatCount(order.totalCartons)}</td>
                  <td>{formatCount(order.totalPieces)}</td>
                  <td>{formatWeight(order.totalWeightKg)}</td>
                </tr>,
                ...(order.items ?? []).map((item, index) => (
                  <tr key={`${order.id}-${index}`} className="product-line">
                    <td /><td /><td /><td />
                    <td>{item.productCode} {item.productName}</td>
                    <td>{formatCount(item.cartonsQty)}</td>
                    <td>{formatCount(item.totalPieces)}</td>
                    <td>{formatWeight(item.weightKg)}</td>
                  </tr>
                )),
              ])}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>الإجمالي النشط</td>
                <td>{formatCount((printFulfillment ?? fulfillment).orders.filter((order) => order.fulfillmentStatus !== 'cancelled').reduce((sum, order) => sum + order.totalCartons, 0))}</td>
                <td>{formatCount((printFulfillment ?? fulfillment).orders.filter((order) => order.fulfillmentStatus !== 'cancelled').reduce((sum, order) => sum + order.totalPieces, 0))}</td>
                <td>{formatWeight((printFulfillment ?? fulfillment).orders.filter((order) => order.fulfillmentStatus !== 'cancelled').reduce((sum, order) => sum + Number(order.totalWeightKg || 0), 0))}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      ) : (
      <section className="analytics-print">
        <link rel="stylesheet" href="/fonts/cairo.css" />
        <header className="analytics-print-head">
          <strong>{settings.companyName}</strong>
          <span>{report.label}</span>
        </header>
        <h1>{view === 'customers' ? 'تقرير مسحوبات العملاء والتجار' : 'تقرير مسحوبات الأصناف'}</h1>
        <p>من {report.from} إلى {report.to} — الطلبات {report.summary.totalOrders} — الكراتين {formatCount(report.summary.totalCartons)} — القطع {formatCount(report.summary.totalPieces)} — الوزن {formatWeight(report.summary.totalWeightKg)} كجم</p>
        {view === 'customers' ? (
          <>
            <h2>مسحوبات العملاء</h2>
            <table>
              <thead><tr><th>العميل</th><th>الصنف</th><th>خرج كراتين</th><th>متبقي كراتين</th><th>خرج قطع</th><th>متبقي قطع</th><th>خرج وزن</th><th>متبقي وزن</th></tr></thead>
              <tbody>
                {report.customers.flatMap((customer) => customer.channels.flatMap((channel) => (channel.products.length ? channel.products : [{ productId: 0, productCode: '', productName: channel.deliveryType === 'sub_merchant' ? channel.subMerchantName ?? '—' : 'مخزن العميل', unitType: 'carton' as const, ordersCount: 0, totalCartons: 0, totalPieces: 0, totalWeightKg: 0, dispatchedOrdersCount: channel.dispatchedOrdersCount, pendingOrdersCount: channel.pendingOrdersCount, dispatchedCartons: channel.dispatchedCartons, pendingCartons: channel.pendingCartons, dispatchedPieces: channel.dispatchedPieces, pendingPieces: channel.pendingPieces, dispatchedWeightKg: channel.dispatchedWeightKg, pendingWeightKg: channel.pendingWeightKg }]).map((product) => (
                  <tr key={`${customer.customerId}-${channel.subMerchantId ?? 0}-${product.productId}-${product.productCode}`}>
                    <td>{customer.customerName}</td>
                    <td>{product.productCode} {product.productName}</td>
                    <td>{formatCount(product.dispatchedCartons)}</td>
                    <td>{formatCount(product.pendingCartons)}</td>
                    <td>{formatCount(product.dispatchedPieces)}</td>
                    <td>{formatCount(product.pendingPieces)}</td>
                    <td>{formatWeight(product.dispatchedWeightKg)}</td>
                    <td>{formatWeight(product.pendingWeightKg)}</td>
                  </tr>
                ))))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>الإجمالي</td>
                  <td>{formatCount(report.products.reduce((sum, product) => sum + product.dispatchedCartons, 0))}</td>
                  <td>{formatCount(report.products.reduce((sum, product) => sum + product.pendingCartons, 0))}</td>
                  <td>{formatCount(report.products.reduce((sum, product) => sum + product.dispatchedPieces, 0))}</td>
                  <td>{formatCount(report.products.reduce((sum, product) => sum + product.pendingPieces, 0))}</td>
                  <td>{formatWeight(report.products.reduce((sum, product) => sum + Number(product.dispatchedWeightKg || 0), 0))}</td>
                  <td>{formatWeight(report.products.reduce((sum, product) => sum + Number(product.pendingWeightKg || 0), 0))}</td>
                </tr>
              </tfoot>
            </table>
          </>
        ) : filteredProductsBySheet.length === 1 ? (
          <ProductPrintTable title={`أوردر #${filteredProductsBySheet[0].sheetNumber} — (${filteredProductsBySheet[0].sheetDate})`} footLabel={`إجمالي أوردر #${filteredProductsBySheet[0].sheetNumber}`} products={filteredProductsBySheet[0].products} />
        ) : (
          <>
            {filteredProductsBySheet.map((sheet) => (
              <ProductPrintTable key={sheet.sheetId} title={`أوردر #${sheet.sheetNumber} (${sheet.sheetDate})`} footLabel={`إجمالي أوردر #${sheet.sheetNumber}`} products={sheet.products} />
            ))}
            <ProductPrintTable title="الإجمالي المجمّع للأصناف (كل الأوردرات)" footLabel="الإجمالي العام" products={visibleProducts} />
          </>
        )}
      </section>
      )}
    </>
  );
}
