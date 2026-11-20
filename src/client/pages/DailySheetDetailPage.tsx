import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Copy, FileSpreadsheet, Pencil, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { api, ApiClientError } from '@/client/lib/api';
import { exportOrderSheetExcel } from '@/client/lib/sheetExport';
import { useExcelExport } from '@/client/lib/useExcelExport';
import { useAuth } from '@/client/contexts/AuthContext';
import { useToast } from '@/client/components/ui/Toast';
import { PrintSelectionModal } from '@/client/components/print/PrintSelectionModal';
import { SkeletonBlock, SkeletonCard } from '@/client/components/ui/Skeleton';
import { OrderEditorForm } from '@/client/components/orders/OrderEditorForm';
import { ConfirmDialog } from '@/client/components/ui/ConfirmDialog';
import { calculateOrderItemTotals, requiresPacking } from '@/shared/domain';
import { CATEGORY_LABELS_AR, GRADE_LABELS_AR, ITEM_TYPE_LABELS_AR, ITEM_TYPES, ORDER_MODE_LABELS_AR, PRODUCT_CATEGORIES, PRODUCT_GRADES } from '@/shared/labels';
import type {
  ClientOrderDetailDTO,
  CustomerDTO,
  DailySheetDetailDTO,
  DeliveryType,
  FulfillmentStatus,
  ItemType,
  OrderMode,
  ProductCategory,
  ProductDTO,
  ProductGrade,
} from '@/shared/types';

interface DraftLine {
  key: string;
  productId: string;
  orderMode: OrderMode;
  cartonsQty: string;
  loosePiecesQty: string;
  weightKg: string;
  notes: string;
}

const fieldClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

const compactFieldClass =
  'h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

const iconActionClass =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white';

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function orderSubtotalLabel(order: ClientOrderDetailDTO): string {
  if (order.totalCartons > 0) {
    const parts = [`${order.totalCartons} كرتونة`, `${order.totalPieces} قطعة`];
    if (order.totalWeightKg > 0) parts.push(`${order.totalWeightKg} كجم`);
    return `الإجمالي: ${parts.join(' • ')}`;
  }
  if (order.totalWeightKg > 0) return `الإجمالي: ${order.totalWeightKg} كجم`;
  return `الإجمالي: ${order.totalPieces} قطعة`;
}

function deliveryLabel(order: ClientOrderDetailDTO): string {
  return order.deliveryType === 'sub_merchant' ? `تاجر: ${order.subMerchantName ?? '—'}` : 'مخزن العميل';
}

function modeDotClass(mode: OrderMode): string {
  if (mode === 'bag') return 'bg-indigo-500';
  if (mode === 'piece') return 'bg-amber-500';
  if (mode === 'kg') return 'bg-emerald-500';
  return 'bg-blue-500';
}

function matchesOrderQuery(sheetNumber: string, index: number, order: ClientOrderDetailDTO, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  if (term.includes('/')) {
    const [sheetPart, indexPart = ''] = term.split('/');
    return sheetPart === sheetNumber.toLowerCase() && indexPart === String(index);
  }
  if (/^\d+$/.test(term) && String(index) === term) return true;
  return order.customerName.toLowerCase().includes(term) || order.customerCode.toLowerCase().includes(term);
}

function blankLine(): DraftLine {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    productId: '',
    orderMode: 'carton',
    cartonsQty: '1',
    loosePiecesQty: '1',
    weightKg: '',
    notes: '',
  };
}

export function DailySheetDetailPage() {
  const { sheetId } = useParams();
  const id = Number(sheetId);
  const { user } = useAuth();
  const { notify } = useToast();
  const canEditSheet = user?.role === 'admin' || Boolean(user?.permissions.dailySheets.edit);
  const canCloseSheet = user?.role === 'admin' || Boolean(user?.permissions.dailySheets.close);
  const canArchive = user?.role === 'admin' || Boolean(user?.permissions.dailySheets.archive);
  const canCreateOrder = user?.role === 'admin' || Boolean(user?.permissions.orders.create);
  const canEditOrder = user?.role === 'admin' || Boolean(user?.permissions.orders.edit);
  const canFulfillOrder = user?.role === 'admin' || Boolean(user?.permissions.orders.fulfillment);
  const canCancelOrder = user?.role === 'admin' || Boolean(user?.permissions.orders.cancel);
  const canDeleteOrder = user?.role === 'admin' || Boolean(user?.permissions.orders.delete);
  const canExport = user?.role === 'admin' || Boolean(user?.permissions.reports.exportExcel);
  const { isExporting, runExport } = useExcelExport();
  const canPrint = user?.role === 'admin' || Boolean(user?.permissions.reports.exportPdf);
  const canManageCatalog = user?.role === 'admin' || Boolean(user?.permissions.catalog.manage);
  const canManageCustomers = user?.role === 'admin' || Boolean(user?.permissions.customers.manage);

  const [sheet, setSheet] = useState<DailySheetDetailDTO | null>(null);
  const [products, setProducts] = useState<ProductDTO[]>([]);
  const [customers, setCustomers] = useState<CustomerDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sheetNumber, setSheetNumber] = useState('');
  const [sheetDate, setSheetDate] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'open' | 'closed' | 'archived'>('open');
  const [editor, setEditor] = useState<null | { orderId?: number }>(null);
  const [customerId, setCustomerId] = useState('');
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('client_warehouse');
  const [subMerchantId, setSubMerchantId] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [trucksCount, setTrucksCount] = useState('1');
  const [representativeName, setRepresentativeName] = useState('');
  const [warehouseRef, setWarehouseRef] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const savingOrderRef = useRef(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [sheetMetaOpen, setSheetMetaOpen] = useState(false);
  const anchorOrderId = useRef<number | null>(null);
  const [orderQuery, setOrderQuery] = useState('');
  const [fulfillmentFilter, setFulfillmentFilter] = useState<'all' | FulfillmentStatus>('all');
  const fulfillmentLock = useRef(false);
  const [pendingConfirm, setPendingConfirm] = useState<null | { kind: 'cancel' | 'restore'; orderId: number; label: string }>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const loadedOnce = useRef(false);
  const [quickCustomerOpen, setQuickCustomerOpen] = useState(false);
  const [quickMerchantOpen, setQuickMerchantOpen] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickCode, setQuickCode] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [quickLocation, setQuickLocation] = useState('');
  const [quickProductOpen, setQuickProductOpen] = useState(false);
  const [quickProductLineKey, setQuickProductLineKey] = useState<string | null>(null);
  const [productCode, setProductCode] = useState('');
  const [productName, setProductName] = useState('');
  const [productCategory, setProductCategory] = useState<ProductCategory>('blanket');
  const [productGrade, setProductGrade] = useState<ProductGrade>('first_grade');
  const [productItemType, setProductItemType] = useState<ItemType>('carton');
  const [productPacking, setProductPacking] = useState('6');
  const [productWeight, setProductWeight] = useState('');
  const [quickProductError, setQuickProductError] = useState<string | null>(null);
  const [quickProductSaving, setQuickProductSaving] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(id)) return;
    if (!loadedOnce.current) setIsLoading(true);
    try {
      const [sheetRes, productRes, customerRes] = await Promise.all([
        api.dailySheets.get(id),
        api.products.list({ isActive: true, sort: 'code' }),
        api.customers.list({ includeSubMerchants: true }),
      ]);
      setSheet({
        ...sheetRes.sheet,
        orders: [...sheetRes.sheet.orders]
          .sort((a, b) => a.id - b.id)
          .map((order) => ({
            ...order,
            items: [...order.items].sort((a, b) => a.id - b.id),
          })),
      });
      setSheetNumber(sheetRes.sheet.sheetNumber);
      setSheetDate(sheetRes.sheet.sheetDate);
      setNotes(sheetRes.sheet.notes ?? '');
      setStatus(sheetRes.sheet.status);
      setProducts(productRes.products);
      setCustomers(customerRes.customers);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : 'تعذر تحميل الأوردر', 'error');
    } finally {
      loadedOnce.current = true;
      setIsLoading(false);
    }
  }, [id, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  useLayoutEffect(() => {
    if (editor?.orderId) {
      document.querySelector(`[data-order-editor="${editor.orderId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
    const orderId = anchorOrderId.current;
    if (orderId == null) return;
    anchorOrderId.current = null;
    document.querySelector(`[data-order-anchor="${orderId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [editor]);

  const indexedOrders = useMemo(
    () => (sheet?.orders ?? []).map((order, index) => ({ order, index: index + 1 })),
    [sheet]
  );
  const visibleOrders = useMemo(
    () =>
      indexedOrders.filter(({ order, index }) => {
        const status = order.fulfillmentStatus ?? 'pending';
        const matchesFilter = fulfillmentFilter === 'all' || status === fulfillmentFilter || editor?.orderId === order.id;
        return matchesFilter && (editor?.orderId === order.id || matchesOrderQuery(sheet?.sheetNumber ?? '', index, order, orderQuery));
      }),
    [editor?.orderId, fulfillmentFilter, indexedOrders, orderQuery, sheet?.sheetNumber]
  );

  const selectedCustomer = customers.find((item) => item.id === Number(customerId));
  const locked = sheet?.status === 'archived' || sheet?.status === 'closed';

  const liveTotals = useMemo(() => {
    return lines.reduce(
      (sum, line) => {
        const product = products.find((item) => item.id === Number(line.productId));
        if (!product) return sum;
        const totals = calculateOrderItemTotals({
          orderMode: line.orderMode,
          cartonsQty: Number(line.cartonsQty) || 0,
          packingCapacitySnapshot: product.packingCapacity,
          directPiecesQty: Number(line.loosePiecesQty) || 0,
          weightKg: Number(line.weightKg) || 0,
        });
        return {
          cartons: sum.cartons + totals.cartonsQty,
          pieces: sum.pieces + totals.totalPieces,
          kg: sum.kg + totals.weightKg,
        };
      },
      { cartons: 0, pieces: 0, kg: 0 }
    );
  }, [lines, products]);

  const fillFromCustomer = (nextCustomerId: string, type: DeliveryType) => {
    const customer = customers.find((item) => item.id === Number(nextCustomerId));
    if (!customer || type !== 'client_warehouse') return;
    setRecipientName(customer.name);
    setDeliveryPhone(customer.defaultPhone ?? '');
    setDeliveryLocation(customer.defaultLocation ?? '');
  };

  const openCreate = () => {
    setEditor({});
    setCustomerId('');
    setDeliveryType('client_warehouse');
    setSubMerchantId('');
    setRecipientName('');
    setDeliveryPhone('');
    setDeliveryLocation('');
    setTrucksCount('1');
    setRepresentativeName('');
    setWarehouseRef('');
    setOrderNotes('');
    setLines([blankLine()]);
    setFormError(null);
  };

  const fillFromOrder = (order: ClientOrderDetailDTO, freshKeys = false) => {
    setCustomerId(String(order.customerId));
    setDeliveryType(order.deliveryType);
    setSubMerchantId(order.subMerchantId ? String(order.subMerchantId) : '');
    setRecipientName(order.recipientName ?? '');
    setDeliveryPhone(order.deliveryPhone);
    setDeliveryLocation(order.deliveryLocation);
    setTrucksCount(String(order.trucksCount || 1));
    setRepresentativeName(order.representativeName ?? '');
    setWarehouseRef(order.warehouseRef ?? '');
    setOrderNotes(order.notes ?? '');
    setLines(
      order.items.map((item, index) => ({
        key: freshKeys ? `copy-${order.id}-${index}-${item.productId}` : String(item.id),
        productId: String(item.productId),
        orderMode: item.orderMode,
        cartonsQty: String(item.cartonsQty),
        loosePiecesQty: String(item.totalPieces),
        weightKg: item.weightKg ? String(item.weightKg) : '',
        notes: item.notes ?? '',
      }))
    );
    setFormError(null);
  };

  const openEdit = (order: ClientOrderDetailDTO) => {
    setEditor({ orderId: order.id });
    fillFromOrder(order);
  };

  const duplicateOrder = (order: ClientOrderDetailDTO) => {
    setEditor({});
    fillFromOrder(order, true);
  };

  const toggleClosed = async () => {
    if (savingOrderRef.current || isSaving) return;
    if (!sheet || sheet.status === 'archived') return;
    savingOrderRef.current = true;
    const next = sheet.status === 'closed' ? 'open' : 'closed';
    setIsSaving(true);
    try {
      await api.dailySheets.update(sheet.id, { status: next });
      setStatus(next);
      notify(next === 'closed' ? 'تم إغلاق الأوردر' : 'تمت إعادة فتح الأوردر');
      await load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : 'تعذر تغيير حالة الأوردر', 'error');
    } finally {
      savingOrderRef.current = false;
      setIsSaving(false);
    }
  };

  const saveSheet = async () => {
    if (savingOrderRef.current || isSaving) return;
    if (!sheet) return;
    savingOrderRef.current = true;
    setIsSaving(true);
    try {
      await api.dailySheets.update(sheet.id, {
        sheetNumber: sheetNumber.trim(),
        sheetDate,
        notes: notes.trim() || null,
        status,
      });
      notify('تم حفظ بيانات الأوردر');
      setSheetMetaOpen(false);
      await load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : 'تعذر حفظ الأوردر', 'error');
    } finally {
      savingOrderRef.current = false;
      setIsSaving(false);
    }
  };

  const saveOrder = async (event: FormEvent) => {
    event.preventDefault();
    if (savingOrderRef.current || isSaving) return;
    savingOrderRef.current = true;
    if (!sheet) {
      savingOrderRef.current = false;
      return;
    }
    if (!customerId || !deliveryLocation.trim()) {
      setFormError('العميل والعنوان مطلوبان');
      savingOrderRef.current = false;
      return;
    }
    if (deliveryType === 'sub_merchant' && !subMerchantId) {
      setFormError('اختر التاجر الفرعي');
      savingOrderRef.current = false;
      return;
    }
    const items = lines
      .filter((line) => line.productId)
      .map((line) => ({
        productId: Number(line.productId),
        orderMode: line.orderMode,
        cartonsQty: Number(line.cartonsQty) || 0,
        loosePiecesQty: Number(line.loosePiecesQty) || 0,
        weightKg: Number(line.weightKg) || 0,
        notes: line.notes.trim() || null,
      }));
    if (items.length === 0) {
      setFormError('أضف صنفاً واحداً على الأقل');
      savingOrderRef.current = false;
      return;
    }
    setIsSaving(true);
    setFormError(null);
    const payload = {
      customerId: Number(customerId),
      deliveryType,
      subMerchantId: deliveryType === 'sub_merchant' ? Number(subMerchantId) : null,
      recipientName: recipientName.trim() || null,
      deliveryPhone: deliveryPhone.trim(),
      deliveryLocation: deliveryLocation.trim(),
      trucksCount: Number(trucksCount) || 1,
      representativeName: representativeName.trim() || null,
      warehouseRef: warehouseRef.trim() || null,
      notes: orderNotes.trim() || null,
      items,
    };
    try {
      if (editor?.orderId) {
        anchorOrderId.current = editor.orderId;
        await api.dailyOrders.update(editor.orderId, payload);
        notify('تم تحديث الطلب واستبدال الأصناف');
      } else {
        await api.dailyOrders.create({ ...payload, dailySheetId: sheet.id });
        notify('تمت إضافة طلب العميل');
      }
      setEditor(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiClientError ? err.message : 'تعذر حفظ الطلب');
    } finally {
      savingOrderRef.current = false;
      setIsSaving(false);
    }
  };

  const removeOrder = async (orderId: number) => {
    try {
      await api.dailyOrders.remove(orderId);
      notify('تم حذف الطلب');
      await load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : 'تعذر حذف الطلب', 'error');
    }
  };

  const applyFulfillment = async (orderId: number, next: FulfillmentStatus, reason?: string): Promise<boolean> => {
    if (fulfillmentLock.current) return false;
    fulfillmentLock.current = true;
    try {
      await api.dailyOrders.setFulfillment(orderId, { status: next, cancelReason: reason });
      await load();
      return true;
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : 'تعذر تحديث حالة الطلب', 'error');
      return false;
    } finally {
      fulfillmentLock.current = false;
    }
  };

  const submitConfirm = async () => {
    if (!pendingConfirm || confirmBusy) return;
    setConfirmBusy(true);
    const ok = pendingConfirm.kind === 'cancel'
      ? await applyFulfillment(pendingConfirm.orderId, 'cancelled', cancelReason.trim())
      : await applyFulfillment(pendingConfirm.orderId, 'pending');
    setConfirmBusy(false);
    if (ok) setPendingConfirm(null);
  };

  const exportSheet = () => {
    if (!sheet) return;
    void runExport(() => exportOrderSheetExcel(sheet, sheet.orders)).catch(() => notify('تعذر تصدير ملف Excel', 'error'));
  };

  const saveQuickCustomer = async () => {
    if (quickCode.trim().length < 1 || quickName.trim().length < 2) {
      setFormError('أدخل كود العميل واسمه');
      return;
    }
    try {
      const res = await api.customers.create({
        clientCode: quickCode.trim(),
        name: quickName.trim(),
        defaultPhone: quickPhone.trim() || null,
        defaultLocation: quickLocation.trim() || null,
      });
      setCustomers((prev) => [...prev, { ...res.customer, subMerchants: [] }]);
      setCustomerId(String(res.customer.id));
      setRecipientName(res.customer.name);
      setDeliveryPhone(res.customer.defaultPhone ?? '');
      setDeliveryLocation(res.customer.defaultLocation ?? '');
      setQuickCustomerOpen(false);
      notify('تمت إضافة العميل واختياره في الطلب');
    } catch (err) {
      setFormError(err instanceof ApiClientError ? err.message : 'تعذر إضافة العميل');
    }
  };

  const openQuickProduct = (lineKey: string, query: string) => {
    const value = query.trim();
    const hasArabic = /[\u0600-\u06FF]/.test(value);
    const looksLikeCode = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(value) && !hasArabic;
    setQuickProductLineKey(lineKey);
    setProductCode(looksLikeCode ? value : '');
    setProductName(looksLikeCode ? '' : value);
    setProductCategory('blanket');
    setProductGrade('first_grade');
    setProductItemType('carton');
    setProductPacking('6');
    setProductWeight('');
    setQuickProductError(null);
    setQuickProductOpen(true);
  };

  const saveQuickProduct = async () => {
    const code = productCode.trim();
    const name = productName.trim();
    const packed = requiresPacking(productItemType);
    const packing = packed ? Number(productPacking) : 0;
    if (code.length < 1 || name.length < 2 || (packed && (!Number.isInteger(packing) || packing < 1))) {
      setQuickProductError(packed ? 'أدخل كود الصنف واسمه وتعبئة أكبر من صفر' : 'أدخل كود الصنف واسمه');
      return;
    }
    setQuickProductSaving(true);
    try {
      const res = await api.products.create({
        code,
        name,
        category: productCategory,
        grade: productGrade,
        itemType: productItemType,
        packingCapacity: packing,
        weight: productWeight.trim() || null,
        isActive: true,
      });
      setProducts((current) => [...current.filter((item) => item.id !== res.product.id), res.product].sort((a, b) => a.code.localeCompare(b.code)));
      if (quickProductLineKey) {
        setLines((current) =>
          current.map((line) => (line.key === quickProductLineKey ? { ...line, productId: String(res.product.id) } : line))
        );
      }
      setQuickProductOpen(false);
      notify('تمت إضافة المنتج واختياره في السطر');
    } catch (err) {
      setQuickProductError(err instanceof ApiClientError ? err.message : 'تعذر إضافة المنتج');
    } finally {
      setQuickProductSaving(false);
    }
  };

  const saveQuickMerchant = async () => {
    if (!selectedCustomer || quickName.trim().length < 2) return;
    try {
      const res = await api.subMerchants.create({
        customerId: selectedCustomer.id,
        name: quickName.trim(),
        phone: quickPhone.trim() || null,
        location: quickLocation.trim() || null,
      });
      setCustomers((prev) =>
        prev.map((customer) =>
          customer.id === selectedCustomer.id
            ? {
              ...customer,
              subMerchantsCount: customer.subMerchantsCount + 1,
              subMerchants: [...(customer.subMerchants ?? []), res.subMerchant],
            }
            : customer
        )
      );
      setSubMerchantId(String(res.subMerchant.id));
      setRecipientName(res.subMerchant.name);
      setDeliveryPhone(res.subMerchant.phone ?? '');
      setDeliveryLocation(res.subMerchant.location ?? '');
      setQuickMerchantOpen(false);
      notify('تمت إضافة التاجر وتعبئة بيانات التسليم');
    } catch (err) {
      setFormError(err instanceof ApiClientError ? err.message : 'تعذر إضافة التاجر');
    }
  };

  const renderEditor = (title: string) => (
    <OrderEditorForm
      title={title}
      customers={customers}
      products={products}
      customerId={customerId}
      deliveryType={deliveryType}
      subMerchantId={subMerchantId}
      recipientName={recipientName}
      deliveryPhone={deliveryPhone}
      deliveryLocation={deliveryLocation}
      trucksCount={trucksCount}
      representativeName={representativeName}
      warehouseRef={warehouseRef}
      orderNotes={orderNotes}
      lines={lines}
      formError={formError}
      isSaving={isSaving}
      liveLabel={`المعاينة: ${liveTotals.cartons} كرتونة · ${liveTotals.pieces} قطعة${liveTotals.kg > 0 ? ` · ${liveTotals.kg} كجم` : ''}`}
      onCustomer={(customer) => {
        setCustomerId(String(customer.id));
        setSubMerchantId('');
        fillFromCustomer(String(customer.id), deliveryType);
      }}
      onDeliveryType={(value) => {
        setDeliveryType(value);
        setSubMerchantId('');
        fillFromCustomer(customerId, value);
      }}
      onMerchant={(merchant) => {
        setSubMerchantId(String(merchant.id));
        setRecipientName(merchant.name);
        setDeliveryPhone(merchant.phone ?? '');
        setDeliveryLocation(merchant.location ?? '');
      }}
      onRecipient={setRecipientName}
      onPhone={setDeliveryPhone}
      onLocation={setDeliveryLocation}
      onTrucks={setTrucksCount}
      onRepresentative={setRepresentativeName}
      onWarehouse={setWarehouseRef}
      onOrderNotes={setOrderNotes}
      onLine={(key, patch) => setLines((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)))}
      onRemoveLine={(key) => setLines((prev) => (prev.length === 1 ? prev : prev.filter((item) => item.key !== key)))}
      onAddLine={() => setLines((prev) => [...prev, blankLine()])}
      onQuickCustomer={(query) => {
        setQuickName(query);
        setQuickCode('');
        setQuickPhone('');
        setQuickLocation('');
        setQuickCustomerOpen(true);
      }}
      onQuickMerchant={canManageCustomers ? (query) => {
        setQuickName(query);
        setQuickPhone('');
        setQuickLocation('');
        setQuickMerchantOpen(true);
      } : undefined}
      onQuickProduct={canManageCatalog ? openQuickProduct : undefined}
      onCancel={() => {
        if (editor?.orderId) anchorOrderId.current = editor.orderId;
        setEditor(null);
      }}
      onSubmit={saveOrder}
    />
  );

  if (isLoading) {
    return (
      <div className="space-y-5">
        <SkeletonBlock className="h-10 w-full rounded-xl" />
        <article className="rounded-2xl border border-slate-200/90 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <SkeletonBlock key={index} className="h-16 w-full" />
            ))}
          </div>
          <SkeletonBlock className="mt-3 h-16 w-full" />
        </article>
        <SkeletonCard count={4} />
      </div>
    );
  }
  if (!sheet) {
    return <p className="py-16 text-center text-sm">تعذر العثور على الأوردر. <Link to="/daily-sheets" className="font-bold text-blue-600">العودة للقائمة</Link></p>;
  }

  const fulfillmentCounts = {
    dispatched: sheet.orders.filter((order) => order.fulfillmentStatus === 'dispatched').length,
    cancelled: sheet.orders.filter((order) => order.fulfillmentStatus === 'cancelled').length,
    pending: sheet.orders.filter((order) => order.fulfillmentStatus !== 'dispatched' && order.fulfillmentStatus !== 'cancelled').length,
  };

  const fulfillmentControls = (order: ClientOrderDetailDTO, index: number) => {
    if (!canFulfillOrder && !canCancelOrder) return null;
    const archived = sheet.status === 'archived';
    const openSheet = sheet.status === 'open';
    const cancelled = order.fulfillmentStatus === 'cancelled';
    const toggleLabel = order.fulfillmentStatus === 'dispatched' ? 'متبقي' : 'تم الخروج';
    return (
      <div className="no-print flex flex-wrap items-center gap-1">
        {canFulfillOrder && (
        <button
          type="button"
          disabled={archived || cancelled}
          onClick={() => void applyFulfillment(order.id, order.fulfillmentStatus === 'dispatched' ? 'pending' : 'dispatched')}
          className="h-7 rounded-lg border border-emerald-300 bg-emerald-50 px-2 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100 dark:hover:bg-emerald-900 dark:hover:text-white"
        >
          {toggleLabel}
        </button>
        )}
        {canCancelOrder && openSheet && !cancelled && (
          <button
            type="button"
            onClick={() => {
              setCancelReason('');
              setPendingConfirm({ kind: 'cancel', orderId: order.id, label: `${sheet.sheetNumber}/${index} — ${order.customerName}` });
            }}
            className="h-7 rounded-lg border border-red-300 bg-white px-2 text-[11px] font-bold text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100 dark:hover:bg-red-950/70 dark:hover:text-white"
          >
            إلغاء الطلب
          </button>
        )}
        {canCancelOrder && openSheet && cancelled && (
          <button
            type="button"
            onClick={() => setPendingConfirm({ kind: 'restore', orderId: order.id, label: `${sheet.sheetNumber}/${index} — ${order.customerName}` })}
            className="h-7 rounded-lg border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 dark:hover:text-white"
          >
            استرجاع الطلب
          </button>
        )}
      </div>
    );
  };

  const orderActions = (order: ClientOrderDetailDTO, variant: 'labels' | 'icons' = 'labels') => (
    !locked && (
      <div className={variant === 'icons' ? 'no-print inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800' : 'no-print flex flex-wrap items-center gap-1'}>
        {canEditOrder && (
          <button type="button" title="Edit" aria-label="تعديل" onClick={() => openEdit(order)} className={variant === 'icons' ? iconActionClass : 'inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-700 dark:hover:text-white'}>
            <Pencil className="h-3.5 w-3.5" />{variant === 'labels' && 'تعديل'}
          </button>
        )}
        {canCreateOrder && (
          <button type="button" title="Duplicate" aria-label="تكرار" onClick={() => duplicateOrder(order)} className={variant === 'icons' ? iconActionClass : 'inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-700 dark:hover:text-white'}>
            <Copy className="h-3.5 w-3.5" />{variant === 'labels' && 'تكرار'}
          </button>
        )}
        {canDeleteOrder && !locked && (
          <button type="button" title="Delete" aria-label="حذف" onClick={() => void removeOrder(order.id)} className={variant === 'icons' ? `${iconActionClass} hover:bg-red-50 hover:text-red-700 dark:hover:!bg-red-950/70 dark:hover:!text-red-200` : 'inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-red-950/70 dark:hover:text-red-200'}>
            <Trash2 className="h-3.5 w-3.5" />{variant === 'labels' && 'حذف'}
          </button>
        )}
      </div>
    )
  );

  return (
    <div className="space-y-3">
      <section className="no-print rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link to="/daily-sheets" className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">← أوردرات اليوم</Link>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">أوردر اليوم #{sheet.sheetNumber}</h2>
              <span dir="ltr" className="rounded-md border border-slate-200 px-2 py-0.5 font-mono text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">{sheet.sheetDate}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${sheet.status === 'open' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>
                {sheet.status === 'open' ? 'مفتوح' : sheet.status === 'closed' ? 'مغلق' : 'مؤرشف'}
              </span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200">خرج {fulfillmentCounts.dispatched}</span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900 dark:bg-amber-950/70 dark:text-amber-100">متبقي {fulfillmentCounts.pending}</span>
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800 dark:bg-red-950/70 dark:text-red-200">ملغي {fulfillmentCounts.cancelled}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {([
                ['all', 'الكل'],
                ['pending', 'متبقي'],
                ['dispatched', 'تم الخروج'],
                ['cancelled', 'ملغي'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFulfillmentFilter(value)}
                  className={`h-7 rounded-lg px-2 text-[11px] font-bold ${fulfillmentFilter === value ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 dark:hover:text-white'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {sheet.notes ? <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{sheet.notes}</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {(canEditSheet || canCloseSheet || canArchive) && (
                <button type="button" onClick={() => setSheetMetaOpen((open) => !open)} className="h-8 rounded-lg border border-slate-300 px-2.5 text-xs font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                  تعديل بيانات الشيت
                </button>
              )}
              {canCloseSheet && sheet.status !== 'archived' && (
                <button type="button" disabled={isSaving} onClick={() => void toggleClosed()} className="h-8 rounded-lg border border-slate-300 px-2.5 text-xs font-bold text-slate-800 disabled:opacity-60 dark:border-slate-700 dark:text-slate-100">
                  {sheet.status === 'closed' ? 'إعادة فتح الأوردر' : 'إغلاق الأوردر'}
                </button>
              )}
            </div>
          </div>
          <div className="inline-flex flex-wrap items-center self-start overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-600 lg:shrink-0 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <span className="tabular-nums px-3 py-1.5">الطلبات: {formatCount(sheet.orders.length - fulfillmentCounts.cancelled)}</span>
            <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
            <span className="tabular-nums px-3 py-1.5">الكراتين: {formatCount(sheet.totalCartons)}</span>
            <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
            <span className="tabular-nums px-3 py-1.5">القطع: {formatCount(sheet.totalPieces)}</span>
            <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
            <span className="tabular-nums px-3 py-1.5">الوزن: {formatCount(sheet.totalWeightKg)} كجم</span>
          </div>
        </div>
        {sheetMetaOpen && (canEditSheet || canCloseSheet || canArchive) && (
          <div className="mt-3 grid grid-cols-1 items-end gap-2 border-t border-slate-200 pt-3 md:grid-cols-12 dark:border-slate-800">
            <label className="text-[11px] font-medium text-slate-500 md:col-span-2 dark:text-slate-400">رقم الأوردر
              <input dir="ltr" value={sheetNumber} disabled={locked || !canEditSheet} onChange={(event) => setSheetNumber(event.target.value)} className={`${compactFieldClass} mt-1 text-left`} />
            </label>
            <label className="text-[11px] font-medium text-slate-500 md:col-span-2 dark:text-slate-400">التاريخ
              <input dir="ltr" type="date" value={sheetDate} disabled={locked || !canEditSheet} onChange={(event) => setSheetDate(event.target.value)} className={`${compactFieldClass} mt-1 text-left`} />
            </label>
            <label className="text-[11px] font-medium text-slate-500 md:col-span-2 dark:text-slate-400">الحالة
              <select value={status} disabled={!canCloseSheet && !canArchive} onChange={(event) => setStatus(event.target.value as 'open' | 'closed' | 'archived')} className={`${compactFieldClass} mt-1`}>
                <option value="open" disabled={status === 'archived' ? !canArchive : status === 'closed' && !canCloseSheet}>مفتوح</option>
                <option value="closed" disabled={status === 'archived' ? !canArchive : !canCloseSheet && status !== 'closed'}>مغلق</option>
                <option value="archived" disabled={!canArchive && status !== 'archived'}>مؤرشف</option>
              </select>
            </label>
            <label className="text-[11px] font-medium text-slate-500 md:col-span-4 dark:text-slate-400">ملاحظات
              <input value={notes} disabled={locked || !canEditSheet} onChange={(event) => setNotes(event.target.value)} className={`${compactFieldClass} mt-1`} />
            </label>
            <button type="button" disabled={isSaving} onClick={() => void saveSheet()} className="h-9 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white disabled:opacity-60 md:col-span-2">حفظ</button>
          </div>
        )}
      </section>

      <div className="no-print sticky top-16 z-20 -mx-4 border-y border-slate-200 bg-slate-50 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:h-[60px] lg:px-8 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex h-full flex-col justify-center gap-2 py-2.5 lg:flex-row lg:items-center lg:justify-between lg:gap-4 lg:py-0">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full min-w-[280px] shrink-0 sm:w-[28rem]">
              <Search className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-300" />
              <input
                value={orderQuery}
                onChange={(event) => setOrderQuery(event.target.value)}
                placeholder={`بحث برقم الطلب ${sheet.sheetNumber}/X أو اسم العميل...`}
                className="h-9 w-full rounded-lg border border-slate-300 bg-white pr-9 pl-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canCreateOrder && !locked && (
              <button type="button" onClick={openCreate} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white">
                <Plus className="h-3.5 w-3.5" />إضافة طلب
              </button>
            )}
            {canPrint && (
              <button type="button" onClick={() => setPrintOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-700 dark:hover:text-white">
                <Printer className="h-3.5 w-3.5" />طباعة
              </button>
            )}
            {canExport && (
              <button type="button" disabled={isExporting} onClick={exportSheet} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-800 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800/90 dark:text-emerald-300 dark:hover:border-emerald-600 dark:hover:bg-emerald-950 dark:hover:text-emerald-100">
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" />Excel
              </button>
            )}
          </div>
        </div>
      </div>

      {sheet.orders.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">لا توجد طلبات داخل هذا الأوردر.</p>
      ) : visibleOrders.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">لا توجد طلبات مطابقة للبحث.</p>
      ) : (
        <div className="space-y-3">
          {visibleOrders.map(({ order, index }) => {
            const editing = editor?.orderId === order.id && !locked;
            return (
              <article
                key={order.id}
                data-order-anchor={order.id}
                data-order-editor={editing ? order.id : undefined}
                className={editing ? undefined : `overflow-hidden rounded-xl border shadow-2xs transition-shadow hover:shadow-md ${order.fulfillmentStatus === 'cancelled' ? 'border-red-200 bg-red-50/70 dark:border-red-900/70 dark:bg-red-950/30' : 'border-slate-200/90 bg-white dark:border-slate-800 dark:bg-slate-900'}`}
              >
                {editing ? (
                  renderEditor('تعديل الطلب واستبدال الأصناف')
                ) : (
                  <>
                    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 bg-slate-50/90 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/60">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span dir="ltr" className="rounded-md bg-blue-600 px-2.5 py-0.5 font-mono text-xs font-bold text-white">{sheet.sheetNumber}/{index}</span>
                        <span className="text-sm font-bold text-slate-900 dark:text-white">{order.customerName}</span>
                        <span dir="ltr" className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">{order.customerCode}</span>
                        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${order.fulfillmentStatus === 'dispatched' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200' : order.fulfillmentStatus === 'cancelled' ? 'bg-red-600 text-white dark:bg-red-700 dark:text-red-50' : 'bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-100'}`}>
                          {order.fulfillmentStatus === 'dispatched' ? 'تم الخروج' : order.fulfillmentStatus === 'cancelled' ? 'ملغي' : 'متبقي'}
                        </span>
                        <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">•</span>
                        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${order.deliveryType === 'sub_merchant' ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'}`}>{deliveryLabel(order)}</span>
                        <span className="text-xs text-slate-600 dark:text-slate-300">
                          {order.deliveryLocation}
                          {order.deliveryPhone ? <span dir="ltr">{` · ${order.deliveryPhone}`}</span> : null}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {fulfillmentControls(order, index)}
                        <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">{orderSubtotalLabel(order)}</span>
                        {orderActions(order, 'icons')}
                      </div>
                    </header>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {order.items.map((item) => (
                        <div key={item.id} className="grid grid-cols-12 items-center gap-3 px-4 py-2 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                          <div className="col-span-12 flex min-w-0 items-center gap-2 sm:col-span-5">
                            <span dir="ltr" className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{item.productCode}</span>
                            <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{item.productName}</span>
                          </div>
                          <div className="col-span-12 flex flex-wrap items-center gap-4 text-xs tabular-nums sm:col-span-5 sm:text-sm">
                            <span className="inline-flex w-16 items-center gap-1.5 text-slate-600 dark:text-slate-300">
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${modeDotClass(item.orderMode)}`} />
                              {ORDER_MODE_LABELS_AR[item.orderMode]}
                            </span>
                            {item.orderMode === 'kg' ? (
                              <>
                                <span className="font-semibold text-slate-800 dark:text-slate-100">{item.totalPieces.toLocaleString('en-US')} قطعة</span>
                                <span className="font-bold text-emerald-700 dark:text-emerald-400">{item.weightKg.toLocaleString('en-US')} كجم</span>
                              </>
                            ) : item.orderMode === 'piece' ? (
                              <span className="font-bold text-slate-900 dark:text-white">{item.totalPieces.toLocaleString('en-US')} قطعة</span>
                            ) : (
                              <>
                                <span className="font-semibold text-slate-800 dark:text-slate-100">{item.cartonsQty.toLocaleString('en-US')} {ORDER_MODE_LABELS_AR[item.orderMode]}</span>
                                <span className="text-slate-500 dark:text-slate-400">تعبئة {item.packingCapacitySnapshot}</span>
                                <span className="font-bold text-slate-900 dark:text-white">{item.totalPieces.toLocaleString('en-US')} قطعة</span>
                              </>
                            )}
                          </div>
                          <div className="col-span-12 text-left sm:col-span-2">
                            {item.notes ? <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{item.notes}</span> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}

      {editor && !editor.orderId && !locked && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          onClick={() => setEditor(null)}
        >
          <div className="relative z-10 w-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
            {renderEditor('إضافة طلب جديد')}
          </div>
        </div>
      )}
      <PrintSelectionModal open={printOpen} initialSheetId={sheet.id} onClose={() => setPrintOpen(false)} />
      <ConfirmDialog
        open={pendingConfirm?.kind === 'cancel'}
        title={`تأكيد إلغاء الطلب ${pendingConfirm?.label ?? ''}`}
        description='سيبقى الطلب ظاهراً بشارة "ملغي" في الشاشة وكشف الطباعة، وسيُستبعد تلقائياً من الإجماليات.'
        confirmLabel="تأكيد الإلغاء"
        variant="danger"
        loading={confirmBusy}
        optionalInput={{
          label: 'سبب الإلغاء (اختياري)',
          placeholder: 'سبب الإلغاء',
          value: cancelReason,
          onChange: setCancelReason,
        }}
        onConfirm={() => void submitConfirm()}
        onCancel={() => {
          if (!confirmBusy) setPendingConfirm(null);
        }}
      />
      <ConfirmDialog
        open={pendingConfirm?.kind === 'restore'}
        title={`تأكيد استرجاع الطلب ${pendingConfirm?.label ?? ''}`}
        description="سيعود الطلب إلى متبقي ويُحتسب من جديد ضمن إجماليات الأوردر."
        confirmLabel="استرجاع الطلب"
        variant="warning"
        loading={confirmBusy}
        onConfirm={() => void submitConfirm()}
        onCancel={() => {
          if (!confirmBusy) setPendingConfirm(null);
        }}
      />
      {quickCustomerOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-950/50" onClick={() => setQuickCustomerOpen(false)} />
          <form onSubmit={(event) => { event.preventDefault(); void saveQuickCustomer(); }} className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
            <h3 className="font-bold">إضافة عميل جديد</h3>
            <label className="mt-3 block text-xs font-bold">كود العميل<input dir="ltr" required value={quickCode} onChange={(event) => setQuickCode(event.target.value)} className={`${fieldClass} mt-1.5 text-left`} /></label>
            <label className="mt-3 block text-xs font-bold">اسم العميل<input required value={quickName} onChange={(event) => setQuickName(event.target.value)} className={`${fieldClass} mt-1.5`} /></label>
            <label className="mt-3 block text-xs font-bold">الهاتف<input dir="ltr" value={quickPhone} onChange={(event) => setQuickPhone(event.target.value)} className={`${fieldClass} mt-1.5 text-left`} /></label>
            <label className="mt-3 block text-xs font-bold">العنوان<input value={quickLocation} onChange={(event) => setQuickLocation(event.target.value)} className={`${fieldClass} mt-1.5`} /></label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setQuickCustomerOpen(false)} className="rounded-xl border px-4 py-2 text-sm font-bold dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white">إلغاء</button>
              <button type="submit" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">حفظ واختيار</button>
            </div>
          </form>
        </div>
      )}
      {quickProductOpen && (
        <div className="no-print fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-950/50" onClick={() => setQuickProductOpen(false)} />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveQuickProduct();
            }}
            className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]"
          >
            <h3 className="font-bold">إضافة منتج جديد سريعة</h3>
            {quickProductError && (
              <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">{quickProductError}</p>
            )}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs font-bold">كود الصنف
                <input dir="ltr" required value={productCode} onChange={(event) => setProductCode(event.target.value)} className={`${fieldClass} mt-1.5 text-left`} />
              </label>
              <label className="block text-xs font-bold">اسم المنتج
                <input required value={productName} onChange={(event) => setProductName(event.target.value)} className={`${fieldClass} mt-1.5`} />
              </label>
              <label className="block text-xs font-bold">الفئة
                <select value={productCategory} onChange={(event) => setProductCategory(event.target.value as ProductCategory)} className={`${fieldClass} mt-1.5`}>
                  {PRODUCT_CATEGORIES.map((category) => (
                    <option key={category} value={category}>{CATEGORY_LABELS_AR[category]}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-bold">الدرجة
                <select value={productGrade} onChange={(event) => setProductGrade(event.target.value as ProductGrade)} className={`${fieldClass} mt-1.5`}>
                  {PRODUCT_GRADES.map((grade) => (
                    <option key={grade} value={grade}>{GRADE_LABELS_AR[grade]}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-bold sm:col-span-2">نوع التحميل
                <select value={productItemType} onChange={(event) => setProductItemType(event.target.value as ItemType)} className={`${fieldClass} mt-1.5`}>
                  {ITEM_TYPES.map((itemType) => (
                    <option key={itemType} value={itemType}>{ITEM_TYPE_LABELS_AR[itemType]}</option>
                  ))}
                </select>
              </label>
              {requiresPacking(productItemType) && (
                <label className="block text-xs font-bold">التعبئة
                  <input dir="ltr" required type="number" min={1} step={1} value={productPacking} onChange={(event) => setProductPacking(event.target.value)} className={`${fieldClass} mt-1.5 text-left`} />
                </label>
              )}
              <label className="block text-xs font-bold">الوزن المرجعي
                <input value={productWeight} onChange={(event) => setProductWeight(event.target.value)} placeholder="اختياري" className={`${fieldClass} mt-1.5`} />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setQuickProductOpen(false)} className="rounded-xl border px-4 py-2 text-sm font-bold dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white">إلغاء</button>
              <button type="submit" disabled={quickProductSaving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">حفظ واختيار</button>
            </div>
          </form>
        </div>
      )}
      {quickMerchantOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-950/50" onClick={() => setQuickMerchantOpen(false)} />
          <form onSubmit={(event) => { event.preventDefault(); void saveQuickMerchant(); }} className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
            <h3 className="font-bold">إضافة تاجر جديد</h3>
            <label className="mt-3 block text-xs font-bold">اسم التاجر<input required value={quickName} onChange={(event) => setQuickName(event.target.value)} className={`${fieldClass} mt-1.5`} /></label>
            <label className="mt-3 block text-xs font-bold">الهاتف<input dir="ltr" value={quickPhone} onChange={(event) => setQuickPhone(event.target.value)} className={`${fieldClass} mt-1.5 text-left`} /></label>
            <label className="mt-3 block text-xs font-bold">المكان<input value={quickLocation} onChange={(event) => setQuickLocation(event.target.value)} className={`${fieldClass} mt-1.5`} /></label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setQuickMerchantOpen(false)} className="rounded-xl border px-4 py-2 text-sm font-bold dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white">إلغاء</button>
              <button type="submit" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">حفظ وتعبئة التسليم</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
