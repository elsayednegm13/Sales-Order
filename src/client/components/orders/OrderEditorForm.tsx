import type { FormEvent, ReactNode } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { SearchCombobox } from '@/client/components/ui/SearchCombobox';
import { calculateOrderItemTotals } from '@/shared/domain';
import { formatPackingLabel, formatWeightLabel, ORDER_MODE_LABELS_AR, orderModesForProduct } from '@/shared/labels';
import type { CustomerDTO, DeliveryType, OrderMode, ProductDTO, SubMerchantDTO } from '@/shared/types';

export interface DraftLine {
  key: string;
  productId: string;
  orderMode: OrderMode;
  cartonsQty: string;
  loosePiecesQty: string;
  weightKg: string;
  notes: string;
}

const inputClass =
  'h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

export function OrderEditorForm({
  title,
  customers,
  products,
  customerId,
  deliveryType,
  subMerchantId,
  recipientName,
  deliveryPhone,
  deliveryLocation,
  trucksCount,
  representativeName,
  warehouseRef,
  orderNotes,
  lines,
  formError,
  isSaving,
  liveLabel,
  onCustomer,
  onDeliveryType,
  onMerchant,
  onRecipient,
  onPhone,
  onLocation,
  onTrucks,
  onRepresentative,
  onWarehouse,
  onOrderNotes,
  onLine,
  onRemoveLine,
  onAddLine,
  onQuickCustomer,
  onQuickMerchant,
  onQuickProduct,
  onCancel,
  onSubmit,
}: {
  title: string;
  customers: CustomerDTO[];
  products: ProductDTO[];
  customerId: string;
  deliveryType: DeliveryType;
  subMerchantId: string;
  recipientName: string;
  deliveryPhone: string;
  deliveryLocation: string;
  trucksCount: string;
  representativeName: string;
  warehouseRef: string;
  orderNotes: string;
  lines: DraftLine[];
  formError: string | null;
  isSaving: boolean;
  liveLabel: string;
  onCustomer: (customer: CustomerDTO) => void;
  onDeliveryType: (value: DeliveryType) => void;
  onMerchant: (merchant: SubMerchantDTO) => void;
  onRecipient: (value: string) => void;
  onPhone: (value: string) => void;
  onLocation: (value: string) => void;
  onTrucks: (value: string) => void;
  onRepresentative: (value: string) => void;
  onWarehouse: (value: string) => void;
  onOrderNotes: (value: string) => void;
  onLine: (key: string, patch: Partial<DraftLine>) => void;
  onRemoveLine: (key: string) => void;
  onAddLine: () => void;
  onQuickCustomer: (query: string) => void;
  onQuickMerchant: (query: string) => void;
  onQuickProduct?: (lineKey: string, query: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const selected = customers.find((item) => item.id === Number(customerId));
  const merchants = selected?.subMerchants ?? [];

  const merchant = deliveryType === 'sub_merchant';

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-slate-200 border-r-4 border-r-blue-600 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h2>
        <button type="button" onClick={onCancel} aria-label="إغلاق" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-base text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">✕</button>
      </div>
      {formError && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {formError}
        </p>
      )}
      <div className="mt-3 grid grid-cols-1 items-end gap-2.5 lg:grid-cols-12">
        <div className="lg:col-span-3">
          <SearchCombobox
            dense
            label="العميل"
            placeholder="ابحث بكود العميل أو اسمه"
            items={customers}
            selectedKey={customerId}
            selectedLabel={selected ? `${selected.clientCode} — ${selected.name}` : ''}
            filter={(customer, term) =>
              customer.clientCode.toLowerCase().includes(term) || customer.name.toLowerCase().includes(term)
            }
            getKey={(customer) => String(customer.id)}
            renderOption={(customer) => (
              <span>
                <span className="font-bold">{customer.clientCode}</span> {customer.name}
              </span>
            )}
            onSelect={onCustomer}
            quickAddLabel={(query) => `+ إضافة عميل جديد: "${query}"`}
            onQuickAdd={onQuickCustomer}
          />
        </div>
        <Field label="نوع التسليم" className="lg:col-span-2">
          <select value={deliveryType} onChange={(event) => onDeliveryType(event.target.value as DeliveryType)} className={inputClass}>
            <option value="client_warehouse">مخزن العميل</option>
            <option value="sub_merchant">تاجر فرعي</option>
          </select>
        </Field>
        {merchant && (
          <div className="lg:col-span-3">
            <SearchCombobox
              dense
              label="التاجر الفرعي"
              placeholder="ابحث باسم التاجر أو هاتفه"
              items={merchants}
              selectedKey={subMerchantId}
              selectedLabel={merchants.find((item) => item.id === Number(subMerchantId))?.name ?? ''}
              filter={(merchantItem, term) =>
                merchantItem.name.toLowerCase().includes(term) || (merchantItem.phone ?? '').includes(term)
              }
              getKey={(merchantItem) => String(merchantItem.id)}
              renderOption={(merchantItem) => (
                <span>{merchantItem.name}{merchantItem.phone ? ` — ${merchantItem.phone}` : ''}</span>
              )}
              onSelect={onMerchant}
              quickAddLabel={(query) => `+ إضافة تاجر جديد: "${query}"`}
              onQuickAdd={onQuickMerchant}
            />
          </div>
        )}
        <Field label="اسم المستلم" className="lg:col-span-2">
          <input value={recipientName} onChange={(event) => onRecipient(event.target.value)} className={inputClass} />
        </Field>
        <Field label="هاتف التسليم" className="lg:col-span-2">
          <input dir="ltr" required value={deliveryPhone} onChange={(event) => onPhone(event.target.value)} className={`${inputClass} text-left`} />
        </Field>
        <Field label="عنوان التسليم" className="lg:col-span-3">
          <input required value={deliveryLocation} onChange={(event) => onLocation(event.target.value)} className={inputClass} />
        </Field>
        <Field label="عدد السيارات" className="lg:col-span-2">
          <input dir="ltr" type="number" min={1} value={trucksCount} onChange={(event) => onTrucks(event.target.value)} className={`${inputClass} text-left`} />
        </Field>
        <Field label="المندوب" className={merchant ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <input value={representativeName} onChange={(event) => onRepresentative(event.target.value)} className={inputClass} />
        </Field>
        <Field label="رقم مخزني اختياري" className={merchant ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <input value={warehouseRef} onChange={(event) => onWarehouse(event.target.value)} className={inputClass} />
        </Field>
        <Field label="ملاحظات الطلب" className={merchant ? 'lg:col-span-3' : 'lg:col-span-4'}>
          <input value={orderNotes} onChange={(event) => onOrderNotes(event.target.value)} className={inputClass} />
        </Field>
      </div>

      <div className="mt-3 rounded-lg border border-slate-200/80 bg-slate-50 p-3 dark:border-slate-700/80 dark:bg-slate-800/60">
      <div className="hidden grid-cols-12 gap-2 text-xs font-bold text-slate-700 lg:grid dark:text-slate-200">
        <span className="col-span-4">الصنف</span>
        <span className="col-span-2">النمط</span>
        <span className="col-span-3">الكمية</span>
        <span className="col-span-2">ملاحظة</span>
        <span className="col-span-1" />
      </div>
      <div className="mt-1 space-y-2">
        {lines.map((line) => {
          const product = products.find((item) => item.id === Number(line.productId));
          const pieces = product
            ? calculateOrderItemTotals({
                orderMode: line.orderMode,
                cartonsQty: Number(line.cartonsQty) || 0,
                packingCapacitySnapshot: product.packingCapacity,
                directPiecesQty: Number(line.loosePiecesQty) || 0,
                weightKg: Number(line.weightKg) || 0,
              }).totalPieces
            : 0;
          const quantityLabel = line.orderMode === 'bag' ? 'عدد الأكياس' : line.orderMode === 'kg' ? 'العدد' : line.orderMode === 'piece' ? 'عدد القطع' : 'عدد الكراتين';
          return (
            <div key={line.key} className="grid grid-cols-1 items-end gap-2 lg:grid-cols-12">
              <div className="lg:col-span-4">
                <span className="mb-1 block text-xs font-bold text-slate-700 lg:hidden dark:text-slate-200">الصنف</span>
                <SearchCombobox
                  dense
                  label=""
                  placeholder="ابحث بكود الصنف أو اسمه"
                  items={products}
                  selectedKey={line.productId}
                  selectedLabel={product ? `${product.code} — ${product.name}` : ''}
                  filter={(item, term) => item.code.toLowerCase().includes(term) || item.name.toLowerCase().includes(term)}
                  getKey={(item) => String(item.id)}
                  renderOption={(item) => (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{item.code}</span>
                      <span>{item.name}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] dark:bg-slate-800">{formatPackingLabel(item.packingCapacity, item.itemType)}</span>
                      <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[11px] dark:bg-sky-950">{formatWeightLabel(item.weight)}</span>
                    </span>
                  )}
                  onSelect={(item) => onLine(line.key, { productId: String(item.id), orderMode: item.itemType })}
                  quickAddWhen="always"
                  quickAddLabel={onQuickProduct ? (query) => `+ إضافة منتج جديد: "${query}"` : undefined}
                  onQuickAdd={onQuickProduct ? (query) => onQuickProduct(line.key, query) : undefined}
                />
              </div>
              <Field label="النمط" hideLabel className="lg:col-span-2">
                <select aria-label="نمط البيع" value={line.orderMode} onChange={(event) => onLine(line.key, { orderMode: event.target.value as OrderMode })} className={inputClass}>
                  {(product ? orderModesForProduct(product.itemType) : (['carton', 'bag', 'piece', 'kg'] as OrderMode[])).map((mode) => (
                    <option key={mode} value={mode}>{ORDER_MODE_LABELS_AR[mode]}</option>
                  ))}
                </select>
              </Field>
              <div className="lg:col-span-3">
                <span className="mb-1 block text-xs font-bold text-slate-700 lg:hidden dark:text-slate-200">الكمية</span>
                {line.orderMode === 'kg' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <input aria-label="العدد" dir="ltr" type="number" min={1} value={line.loosePiecesQty} onChange={(event) => onLine(line.key, { loosePiecesQty: event.target.value })} placeholder="العدد" className={`${inputClass} text-left`} />
                    <input aria-label="الوزن الصافي بالكجم" dir="ltr" type="number" min={0} step="0.01" value={line.weightKg} onChange={(event) => onLine(line.key, { weightKg: event.target.value })} placeholder="الوزن كجم" className={`${inputClass} text-left`} />
                  </div>
                ) : line.orderMode === 'piece' ? (
                  <input aria-label="عدد القطع" dir="ltr" type="number" min={1} value={line.loosePiecesQty} onChange={(event) => onLine(line.key, { loosePiecesQty: event.target.value })} placeholder="عدد القطع" className={`${inputClass} text-left`} />
                ) : (
                  <div className="flex items-center gap-2">
                    <input aria-label={quantityLabel} dir="ltr" type="number" min={1} value={line.cartonsQty} onChange={(event) => onLine(line.key, { cartonsQty: event.target.value })} placeholder={quantityLabel} className={`${inputClass} text-left`} />
                    <span className="tabular-nums shrink-0 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">{pieces} قطعة</span>
                  </div>
                )}
              </div>
              <Field label="ملاحظة" hideLabel className="lg:col-span-2">
                <input aria-label="ملاحظة السطر" value={line.notes} onChange={(event) => onLine(line.key, { notes: event.target.value })} placeholder="ملاحظة" className={inputClass} />
              </Field>
              <div className="lg:col-span-1 lg:flex lg:justify-center">
                <button type="button" aria-label="حذف" title="حذف" onClick={() => onRemoveLine(line.key)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-red-950/40">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
        <button type="button" onClick={onAddLine} className="text-xs font-bold text-blue-600">+ إضافة سطر صنف</button>
        <p className="tabular-nums text-xs font-medium text-slate-600 dark:text-slate-300">{liveLabel}</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} className="h-9 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200">إلغاء</button>
          <button type="submit" disabled={isSaving} className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-bold text-white disabled:opacity-60">
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            حفظ الطلب
          </button>
        </div>
      </div>
    </form>
  );
}

function Field({
  label,
  className = '',
  hideLabel = false,
  children,
}: {
  label: string;
  className?: string;
  hideLabel?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={className}>
      <span className={`mb-1 block text-xs font-bold text-slate-700 dark:text-slate-200 ${hideLabel ? 'lg:sr-only' : ''}`}>{label}</span>
      {children}
    </label>
  );
}
