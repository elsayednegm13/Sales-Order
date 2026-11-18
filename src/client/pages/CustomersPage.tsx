import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Edit3,
  FileSpreadsheet,
  Loader2,
  Plus,
  Printer,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api, ApiClientError } from '@/client/lib/api';
import { Pagination } from '@/client/components/ui/Pagination';
import { BulkImportModal } from '@/client/components/import/BulkImportModal';
import { exportRowsToExcel, triggerPrintPdfView } from '@/client/lib/export';
import { useExcelExport } from '@/client/lib/useExcelExport';
import { ReportPrint } from '@/client/components/print/ReportPrint';
import { useAuth } from '@/client/contexts/AuthContext';
import { useToast } from '@/client/components/ui/Toast';
import type { CustomerDTO, SubMerchantDTO } from '@/shared/types';

interface CustomerForm {
  clientCode: string;
  name: string;
  defaultPhone: string;
  defaultLocation: string;
}

interface MerchantForm {
  name: string;
  phone: string;
  location: string;
}

const EMPTY_CUSTOMER: CustomerForm = { clientCode: '', name: '', defaultPhone: '', defaultLocation: '' };
const EMPTY_MERCHANT: MerchantForm = { name: '', phone: '', location: '' };

const fieldClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

export function CustomersPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const canManage = Boolean(user?.role === 'admin' || user?.permissions.customers.manage);
  const canDeleteCustomer = user?.role === 'admin';
  const canExport = Boolean(user?.role === 'admin' || user?.permissions.reports.exportExcel);
  const canPrint = Boolean(user?.role === 'admin' || user?.permissions.reports.exportPdf);
  const { isExporting, runExport } = useExcelExport();

  const [customers, setCustomers] = useState<CustomerDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandAll, setExpandAll] = useState(false);
  const [expandedOverride, setExpandedOverride] = useState<Record<number, boolean>>({});
  const [page, setPage] = useState(1);
  const [customerModal, setCustomerModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerDTO | null>(null);
  const [customerForm, setCustomerForm] = useState<CustomerForm>(EMPTY_CUSTOMER);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const [confirmDeleteCustomerId, setConfirmDeleteCustomerId] = useState<number | null>(null);

  const [drawerCustomer, setDrawerCustomer] = useState<CustomerDTO | null>(null);
  const [merchantForm, setMerchantForm] = useState<MerchantForm>(EMPTY_MERCHANT);
  const [editingMerchant, setEditingMerchant] = useState<SubMerchantDTO | null>(null);
  const [merchantError, setMerchantError] = useState<string | null>(null);
  const [isSavingMerchant, setIsSavingMerchant] = useState(false);
  const [confirmDeleteMerchantId, setConfirmDeleteMerchantId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const loadCustomers = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.customers.list({ includeSubMerchants: true });
      setCustomers(res.customers);
      setDrawerCustomer((current) =>
        current ? (res.customers.find((item) => item.id === current.id) ?? null) : current
      );
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : 'تعذر تحميل العملاء', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter((customer) => {
      const own = [customer.name, customer.defaultPhone, customer.defaultLocation]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
      const nested = (customer.subMerchants ?? []).some((merchant) =>
        [merchant.name, merchant.phone, merchant.location]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query))
      );
      return own || nested;
    });
  }, [customers, search]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const openCustomerModal = (customer?: CustomerDTO) => {
    setEditingCustomer(customer ?? null);
    setCustomerForm(
      customer
        ? {
            clientCode: customer.clientCode,
            name: customer.name,
            defaultPhone: customer.defaultPhone ?? '',
            defaultLocation: customer.defaultLocation ?? '',
          }
        : EMPTY_CUSTOMER
    );
    setCustomerError(null);
    setCustomerModal(true);
  };

  const submitCustomer = async (event: FormEvent) => {
    event.preventDefault();
    if (customerForm.name.trim().length < 2) {
      setCustomerError('يرجى إدخال اسم العميل');
      return;
    }
    setIsSavingCustomer(true);
    setCustomerError(null);
    if (customerForm.clientCode.trim().length < 1) {
      setCustomerError('أدخل كود العميل');
      return;
    }
    const payload = {
      clientCode: customerForm.clientCode.trim(),
      name: customerForm.name.trim(),
      defaultPhone: customerForm.defaultPhone.trim() || null,
      defaultLocation: customerForm.defaultLocation.trim() || null,
    };
    try {
      if (editingCustomer) {
        await api.customers.update(editingCustomer.id, payload);
        notify('تم تحديث بيانات العميل');
      } else {
        await api.customers.create(payload);
        notify('تمت إضافة العميل');
      }
      setCustomerModal(false);
      await loadCustomers();
    } catch (err) {
      setCustomerError(err instanceof ApiClientError ? err.message : 'تعذر حفظ العميل');
    } finally {
      setIsSavingCustomer(false);
    }
  };

  const removeCustomer = async (customer: CustomerDTO) => {
    try {
      await api.customers.remove(customer.id);
      if (drawerCustomer?.id === customer.id) setDrawerCustomer(null);
      setConfirmDeleteCustomerId(null);
      notify(`تم حذف ${customer.name}`);
      await loadCustomers();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : 'تعذر حذف العميل', 'error');
      setConfirmDeleteCustomerId(null);
    }
  };

  const merchantQueryHit = (customer: CustomerDTO) => {
    const term = search.trim().toLowerCase();
    if (!term) return false;
    return (customer.subMerchants ?? []).some((merchant) =>
      [merchant.name, merchant.phone, merchant.location]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term))
    );
  };

  const isCardExpanded = (customer: CustomerDTO) => {
    if (drawerCustomer?.id === customer.id) return true;
    if (merchantQueryHit(customer)) return true;
    if (customer.id in expandedOverride) return expandedOverride[customer.id];
    return expandAll;
  };

  const toggleCard = (customer: CustomerDTO) => {
    setExpandedOverride((prev) => ({ ...prev, [customer.id]: !isCardExpanded(customer) }));
  };

  const openDrawer = (customer: CustomerDTO) => {
    setDrawerCustomer(customer);
    setEditingMerchant(null);
    setMerchantForm(EMPTY_MERCHANT);
    setMerchantError(null);
    setConfirmDeleteMerchantId(null);
    setExpandedOverride((prev) => ({ ...prev, [customer.id]: true }));
  };

  const submitMerchant = async (event: FormEvent) => {
    event.preventDefault();
    if (!drawerCustomer) return;
    if (merchantForm.name.trim().length < 2) {
      setMerchantError('يرجى إدخال اسم التاجر');
      return;
    }
    setIsSavingMerchant(true);
    setMerchantError(null);
    const payload = {
      name: merchantForm.name.trim(),
      phone: merchantForm.phone.trim() || null,
      location: merchantForm.location.trim() || null,
    };
    try {
      if (editingMerchant) {
        await api.subMerchants.update(editingMerchant.id, payload);
        notify('تم تحديث بيانات التاجر');
      } else {
        await api.subMerchants.create({ customerId: drawerCustomer.id, ...payload });
        notify('تمت إضافة التاجر الفرعي');
      }
      setEditingMerchant(null);
      setMerchantForm(EMPTY_MERCHANT);
      await loadCustomers();
    } catch (err) {
      setMerchantError(err instanceof ApiClientError ? err.message : 'تعذر حفظ التاجر');
    } finally {
      setIsSavingMerchant(false);
    }
  };

  const removeMerchant = async (merchant: SubMerchantDTO) => {
    try {
      await api.subMerchants.remove(merchant.id);
      setConfirmDeleteMerchantId(null);
      notify(`تم حذف ${merchant.name}`);
      await loadCustomers();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : 'تعذر حذف التاجر', 'error');
      setConfirmDeleteMerchantId(null);
    }
  };

  const customerRows = customers.flatMap((customer) => {
    const merchants = customer.subMerchants ?? [];
    if (merchants.length === 0) {
      return [[customer.clientCode, customer.name, customer.defaultPhone ?? '', customer.defaultLocation ?? '', '', '', '']];
    }
    return merchants.map((merchant) => [
      customer.clientCode,
      customer.name,
      customer.defaultPhone ?? '',
      customer.defaultLocation ?? '',
      merchant.name,
      merchant.phone ?? '',
      merchant.location ?? '',
    ]);
  });

  const exportExcel = () => {
    void runExport(() => exportRowsToExcel({
      filename: 'العملاء-والتجار.xlsx',
      sheetName: 'العملاء والتجار',
      rows: customerRows,
      columns: [
        { header: 'كود العميل', width: 16, accessor: (row) => row[0] },
        { header: 'اسم العميل', width: 28, accessor: (row) => row[1] },
        { header: 'الهاتف', width: 18, accessor: (row) => row[2] },
        { header: 'العنوان', width: 28, accessor: (row) => row[3] },
        { header: 'اسم التاجر', width: 24, accessor: (row) => row[4] },
        { header: 'هاتف التاجر', width: 18, accessor: (row) => row[5] },
        { header: 'المكان', width: 28, accessor: (row) => row[6] },
      ],
    }));
  };

  return (
    <>
    <div className="no-print space-y-3">
      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-950">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">العملاء والتجار</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">حسابات العملاء ومخازنهم والتجار الفرعيون</p>
        </div>
        <div className="inline-flex flex-wrap items-center overflow-hidden rounded-lg border border-slate-200 bg-white text-xs dark:border-slate-800 dark:bg-slate-900">
          <span className="tabular-nums px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200">إجمالي العملاء: {customers.length.toLocaleString('en-US')}</span>
          <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <span className="tabular-nums px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200">التجار الفرعيين: {customers.reduce((sum, customer) => sum + (customer.subMerchants?.length ?? customer.subMerchantsCount), 0).toLocaleString('en-US')}</span>
          <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <span className="tabular-nums px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200">العملاء النشطين: {customers.filter((customer) => customer.defaultPhone).length.toLocaleString('en-US')}</span>
        </div>
      </section>
      <div className="no-print sticky top-16 z-20 -mx-4 flex flex-col justify-between gap-2 border-y border-slate-200 bg-slate-50/95 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:flex-row lg:items-center lg:px-8 dark:border-slate-800 dark:bg-slate-950/95">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full min-w-[280px] shrink-0 sm:w-80">
          <Search className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="بحث بالاسم أو رقم الهاتف..."
            className="h-9 w-full rounded-lg border border-slate-300 bg-white pr-9 pl-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <button type="button" onClick={() => { setExpandAll((value) => !value); setExpandedOverride({}); }} className="h-9 shrink-0 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          {expandAll ? 'طي الكل' : 'توسيع الكل'}
        </button>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {canExport && (
            <button type="button" onClick={exportExcel} disabled={filtered.length === 0 || isExporting} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              تصدير Excel
            </button>
          )}
          {canPrint && (
            <button type="button" onClick={triggerPrintPdfView} disabled={filtered.length === 0} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <Printer className="h-4 w-4" />
              طباعة
            </button>
          )}
          {canManage && (
            <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <FileSpreadsheet className="h-4 w-4 text-blue-600" />
              استيراد Excel
            </button>
          )}
          {canManage && (
            <button type="button" onClick={() => openCustomerModal()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">
              <Plus className="h-4 w-4" />
              إضافة عميل
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center dark:border-slate-700">
          <Users className="mx-auto h-9 w-9 text-slate-400" />
          <p className="mt-3 text-sm font-bold">لا يوجد عملاء مطابقون للبحث</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pageItems.map((customer) => {
            const merchants = customer.subMerchants ?? [];
            const editingThis = customerModal && editingCustomer?.id === customer.id;
            const merchantOpen = drawerCustomer?.id === customer.id;
            const expanded = isCardExpanded(customer);
            return (
              <article key={customer.id} className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
                {editingThis ? (
                  <form onSubmit={submitCustomer} className="border-r-4 border-r-blue-600 bg-white p-4 dark:bg-slate-900">
                    <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                      <h3 className="text-sm font-bold">تعديل العميل</h3>
                      <button type="button" aria-label="إغلاق" onClick={() => setCustomerModal(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500">✕</button>
                    </div>
                    {customerError && <p className="mb-2 text-xs font-semibold text-red-700 dark:text-red-300">{customerError}</p>}
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-200">كود العميل<input dir="ltr" required value={customerForm.clientCode} onChange={(event) => setCustomerForm((prev) => ({ ...prev, clientCode: event.target.value }))} className={`${fieldClass} mt-1 text-left`} /></label>
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-200">اسم العميل<input required value={customerForm.name} onChange={(event) => setCustomerForm((prev) => ({ ...prev, name: event.target.value }))} className={`${fieldClass} mt-1`} /></label>
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-200">الهاتف<input dir="ltr" value={customerForm.defaultPhone} onChange={(event) => setCustomerForm((prev) => ({ ...prev, defaultPhone: event.target.value }))} className={`${fieldClass} mt-1 text-left`} /></label>
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-200">عنوان المخزن<input value={customerForm.defaultLocation} onChange={(event) => setCustomerForm((prev) => ({ ...prev, defaultLocation: event.target.value }))} className={`${fieldClass} mt-1`} /></label>
                    </div>
                    <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setCustomerModal(false)} className="h-9 rounded-lg border px-3 text-xs font-bold dark:border-slate-700">إلغاء</button><button type="submit" disabled={isSavingCustomer} className="h-9 rounded-lg bg-blue-600 px-4 text-xs font-bold text-white disabled:opacity-60">حفظ</button></div>
                  </form>
                ) : (
                  <>
                    <header onClick={() => toggleCard(customer)} className={`flex cursor-pointer flex-wrap items-center justify-between gap-3 bg-slate-50/90 px-4 py-2.5 dark:bg-slate-800/60 ${expanded ? 'border-b border-slate-200/70 dark:border-slate-800' : ''}`}>
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="text-sm text-slate-500 dark:text-slate-300" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
                        <span dir="ltr" className="rounded-md bg-blue-600 px-2.5 py-0.5 font-mono text-xs font-bold text-white">{customer.clientCode}</span>
                        <span className="text-sm font-bold text-slate-900 dark:text-white">{customer.name}</span>
                        {customer.defaultLocation ? <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">{customer.defaultLocation}</span> : null}
                        {customer.defaultPhone ? <span dir="ltr" className="text-xs tabular-nums text-slate-600 dark:text-slate-300">{customer.defaultPhone}</span> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">التجار الفرعيين: {customer.subMerchantsCount}</span>
                        <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
                        {canManage && <button type="button" onClick={() => openDrawer(customer)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><Plus className="h-3.5 w-3.5" />إضافة تاجر</button>}
                        {canManage && (
                          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-950">
                            <button type="button" onClick={() => openCustomerModal(customer)} title="تعديل" aria-label="تعديل" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-slate-200"><Edit3 className="h-3.5 w-3.5" /></button>
                            {canDeleteCustomer && (confirmDeleteCustomerId === customer.id ? (
                              <button type="button" onClick={() => void removeCustomer(customer)} className="px-2 text-[11px] font-bold text-red-600">تأكيد</button>
                            ) : (
                              <button type="button" onClick={() => setConfirmDeleteCustomerId(customer.id)} title="حذف" aria-label="حذف" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                            ))}
                          </div>
                        )}
                        </div>
                      </div>
                    </header>
                    {expanded && (
                    <div className="max-h-80 overflow-y-auto bg-white p-3 dark:bg-slate-900">
                      {merchants.length === 0 && !(merchantOpen && canManage) ? (
                        <p className="px-1 py-1 text-xs text-slate-500 dark:text-slate-400">لا يوجد تجار فرعيين مسجلين — التسليم لمخزن العميل مباشرة</p>
                      ) : (
                      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                        {merchantOpen && canManage && !editingMerchant && (
                          <form onSubmit={submitMerchant} className="col-span-full rounded-lg border border-slate-200 border-r-4 border-r-blue-600 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                            <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800"><h3 className="text-sm font-bold">إضافة تاجر</h3><button type="button" aria-label="إغلاق" onClick={() => setDrawerCustomer(null)} className="text-slate-500">✕</button></div>
                            {merchantError && <p className="mb-2 text-xs font-semibold text-red-700">{merchantError}</p>}
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                              <label className="text-xs font-bold text-slate-700 dark:text-slate-200">الاسم<input required value={merchantForm.name} onChange={(event) => setMerchantForm((prev) => ({ ...prev, name: event.target.value }))} className={`${fieldClass} mt-1`} /></label>
                              <label className="text-xs font-bold text-slate-700 dark:text-slate-200">الهاتف<input dir="ltr" value={merchantForm.phone} onChange={(event) => setMerchantForm((prev) => ({ ...prev, phone: event.target.value }))} className={`${fieldClass} mt-1 text-left`} /></label>
                              <label className="text-xs font-bold text-slate-700 dark:text-slate-200">العنوان<input value={merchantForm.location} onChange={(event) => setMerchantForm((prev) => ({ ...prev, location: event.target.value }))} className={`${fieldClass} mt-1`} /></label>
                            </div>
                            <div className="mt-3 flex justify-end gap-2"><button type="submit" disabled={isSavingMerchant} className="h-9 rounded-lg bg-blue-600 px-4 text-xs font-bold text-white disabled:opacity-60">إضافة التاجر</button></div>
                          </form>
                        )}
                        {merchants.map((merchant) => (
                          merchantOpen && editingMerchant?.id === merchant.id ? (
                            <form key={merchant.id} onSubmit={submitMerchant} className="col-span-full rounded-lg border border-slate-200 border-r-4 border-r-blue-600 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                              <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800"><h3 className="text-sm font-bold">تعديل التاجر</h3><button type="button" aria-label="إغلاق" onClick={() => { setEditingMerchant(null); setMerchantForm(EMPTY_MERCHANT); }} className="text-slate-500">✕</button></div>
                              {merchantError && <p className="mb-2 text-xs font-semibold text-red-700">{merchantError}</p>}
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                <label className="text-xs font-bold text-slate-700 dark:text-slate-200">الاسم<input required value={merchantForm.name} onChange={(event) => setMerchantForm((prev) => ({ ...prev, name: event.target.value }))} className={`${fieldClass} mt-1`} /></label>
                                <label className="text-xs font-bold text-slate-700 dark:text-slate-200">الهاتف<input dir="ltr" value={merchantForm.phone} onChange={(event) => setMerchantForm((prev) => ({ ...prev, phone: event.target.value }))} className={`${fieldClass} mt-1 text-left`} /></label>
                                <label className="text-xs font-bold text-slate-700 dark:text-slate-200">العنوان<input value={merchantForm.location} onChange={(event) => setMerchantForm((prev) => ({ ...prev, location: event.target.value }))} className={`${fieldClass} mt-1`} /></label>
                              </div>
                              <div className="mt-3 flex justify-end gap-2"><button type="submit" disabled={isSavingMerchant} className="h-9 rounded-lg bg-blue-600 px-4 text-xs font-bold text-white disabled:opacity-60">حفظ التاجر</button></div>
                            </form>
                          ) : (
                            <div key={merchant.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-slate-50/50 px-3 py-2 transition-colors hover:border-blue-300 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-blue-700">
                              <div className="min-w-0">
                                <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white"><span className="text-amber-500" aria-hidden="true">•</span><span className="truncate">{merchant.name}</span></p>
                                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{merchant.location || 'بدون عنوان'}{merchant.phone ? <span dir="ltr" className="tabular-nums">{` · ${merchant.phone}`}</span> : null}</p>
                              </div>
                              {canManage && (
                                <div className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-950">
                                  <button type="button" title="تعديل" aria-label="تعديل" onClick={() => { setDrawerCustomer(customer); setEditingMerchant(merchant); setMerchantForm({ name: merchant.name, phone: merchant.phone ?? '', location: merchant.location ?? '' }); setExpandedOverride((prev) => ({ ...prev, [customer.id]: true })); }} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600"><Edit3 className="h-3.5 w-3.5" /></button>
                                  {confirmDeleteMerchantId === merchant.id ? (
                                    <button type="button" onClick={() => void removeMerchant(merchant)} className="px-2 text-[11px] font-bold text-red-600">تأكيد</button>
                                  ) : (
                                    <button type="button" title="حذف" aria-label="حذف" onClick={() => setConfirmDeleteMerchantId(merchant.id)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        ))}
                      </div>
                      )}
                    </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}

      <Pagination page={currentPage} pageSize={pageSize} total={filtered.length} onPage={setPage} />

      <BulkImportModal open={importOpen} mode="customers" products={[]} customers={customers} onClose={() => setImportOpen(false)} onImported={loadCustomers} />
      {customerModal && !editingCustomer && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs" role="dialog" aria-modal="true" onClick={() => !isSavingCustomer && setCustomerModal(false)}>
          <form onSubmit={submitCustomer} onClick={(event) => event.stopPropagation()} className="relative z-10 w-full max-w-md rounded-lg border border-slate-200 border-r-4 border-r-blue-600 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold">{editingCustomer ? 'تعديل العميل' : 'إضافة عميل'}</h2>
              <button type="button" onClick={() => setCustomerModal(false)} aria-label="إغلاق" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
            </div>
            {customerError && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">{customerError}</p>}
            <div className="space-y-3">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">كود العميل
                <input dir="ltr" required value={customerForm.clientCode} onChange={(event) => setCustomerForm((prev) => ({ ...prev, clientCode: event.target.value }))} className={`${fieldClass} mt-1.5 text-left`} />
              </label>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">اسم العميل
                <input required value={customerForm.name} onChange={(event) => setCustomerForm((prev) => ({ ...prev, name: event.target.value }))} className={`${fieldClass} mt-1.5`} />
              </label>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">رقم التليفون الأساسي
                <input dir="ltr" value={customerForm.defaultPhone} onChange={(event) => setCustomerForm((prev) => ({ ...prev, defaultPhone: event.target.value }))} className={`${fieldClass} mt-1.5 text-left`} />
              </label>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">عنوان المخزن
                <input value={customerForm.defaultLocation} onChange={(event) => setCustomerForm((prev) => ({ ...prev, defaultLocation: event.target.value }))} className={`${fieldClass} mt-1.5`} />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setCustomerModal(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold dark:border-slate-700">إلغاء</button>
              <button type="submit" disabled={isSavingCustomer} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-60">
                {isSavingCustomer && <Loader2 className="h-4 w-4 animate-spin" />}
                حفظ
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
    <ReportPrint
      title="العملاء والتجار"
      columns={['كود العميل', 'اسم العميل', 'الهاتف', 'العنوان', 'اسم التاجر', 'هاتف التاجر', 'المكان']}
      rows={customerRows}
    />
    </>
  );
}
