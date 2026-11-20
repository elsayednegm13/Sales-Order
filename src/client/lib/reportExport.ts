import type { Alignment, Borders, Fill, Worksheet, Workbook } from 'exceljs';
import { sanitizeExcelCell } from '@/client/lib/excelSanitize';
import type { FulfillmentReportDTO, FulfillmentStatus, SalesReportDTO } from '@/shared/types';

const THIN = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } };
const BORDER: Partial<Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const NAVY = 'FF1E3A5F';
const HEADER_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
const TOTAL_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
const ZEBRA_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
const ORDER_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
const KPI_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

export interface ReportExportMeta {
  companyName: string;
  filters: string;
}

function weight(value: number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function paint(
  ws: Worksheet,
  row: number,
  col: number,
  value: string | number,
  options?: { bold?: boolean; fill?: Fill; color?: string; size?: number; align?: Alignment['horizontal']; text?: boolean },
) {
  const cell = ws.getCell(row, col);
  cell.value = typeof value === 'number' ? weight(value) : sanitizeExcelCell(value ?? '');
  if (options?.text) cell.numFmt = '@';
  cell.font = {
    name: 'Calibri',
    size: options?.size ?? 10,
    bold: options?.bold ?? false,
    color: options?.color ? { argb: options.color } : undefined,
  };
  cell.alignment = { horizontal: options?.align ?? 'center', vertical: 'middle', wrapText: true };
  cell.border = BORDER;
  if (options?.fill) cell.fill = options.fill;
  return cell;
}

function prepareSheet(workbook: Workbook, name: string, widths: number[]): Worksheet {
  const ws = workbook.addWorksheet(name.slice(0, 31), {
    views: [{ rightToLeft: true, state: 'normal' }],
    pageSetup: {
      paperSize: 9,
      orientation: widths.length > 10 ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
    },
  });
  widths.forEach((width, index) => {
    ws.getColumn(index + 1).width = width;
  });
  return ws;
}

function writeBanner(ws: Worksheet, columns: number, meta: ReportExportMeta, title: string, kpi: string): number {
  for (let col = 1; col <= columns; col += 1) {
    paint(ws, 1, col, col === 1 ? meta.companyName : '', { bold: true, size: 16, align: 'right' });
    paint(ws, 2, col, col === 1 ? title : '', { bold: true, size: 14, align: 'right', fill: KPI_FILL });
    paint(ws, 3, col, col === 1 ? meta.filters : '', { size: 10, align: 'right' });
    paint(ws, 4, col, col === 1 ? kpi : '', { bold: true, size: 10, align: 'right', fill: KPI_FILL });
  }
  ws.mergeCells(1, 1, 1, columns);
  ws.mergeCells(2, 1, 2, columns);
  ws.mergeCells(3, 1, 3, columns);
  ws.mergeCells(4, 1, 4, columns);
  ws.getRow(1).height = 24;
  ws.getRow(2).height = 22;
  return 6;
}

function writeHeader(ws: Worksheet, row: number, headers: string[]): void {
  headers.forEach((header, index) => paint(ws, row, index + 1, header, { bold: true, fill: HEADER_FILL, color: 'FFFFFFFF', size: 9 }));
  ws.getRow(row).height = 30;
}

function statusLabel(status: FulfillmentStatus): string {
  if (status === 'dispatched') return 'تم الخروج';
  if (status === 'cancelled') return 'ملغي';
  return 'متبقي';
}

async function download(workbook: Workbook, filename: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportSalesReport(report: SalesReportDTO, meta: ReportExportMeta): Promise<void> {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  const customerHeaders = ['الكود', 'العميل', 'جهة التسليم', 'الصنف', 'خرج طلبات', 'متبقي طلبات', 'خرج كراتين', 'متبقي كراتين', 'خرج قطع', 'متبقي قطع', 'خرج وزن', 'متبقي وزن'];
  const customers = prepareSheet(workbook, 'العملاء والتجار', [14, 24, 18, 28, 12, 12, 12, 12, 12, 12, 12, 12]);
  let row = writeBanner(
    customers,
    customerHeaders.length,
    meta,
    'تقرير مسحوبات العملاء والتجار',
    `العملاء ${report.summary.uniqueCustomers} · الطلبات ${report.summary.totalOrders} · الكراتين ${report.summary.totalCartons} · القطع ${report.summary.totalPieces} · الوزن ${weight(report.summary.totalWeightKg)}`,
  );
  writeHeader(customers, row, customerHeaders);
  row += 1;
  const customerTotals = { dOrders: 0, pOrders: 0, dCartons: 0, pCartons: 0, dPieces: 0, pPieces: 0, dWeight: 0, pWeight: 0 };
  report.customers.forEach((customer) => {
    customerTotals.dOrders += customer.dispatchedOrdersCount;
    customerTotals.pOrders += customer.pendingOrdersCount;
    const channels = customer.channels.length ? customer.channels : [];
    channels.forEach((channel) => {
      const channelName = channel.deliveryType === 'sub_merchant' ? `تاجر: ${channel.subMerchantName ?? '—'}` : 'مخزن العميل';
      const lines = channel.products.length ? channel.products : [null];
      lines.forEach((product) => {
        const values: Array<string | number> = [
          customer.clientCode,
          customer.customerName,
          channelName,
          product ? `${product.productCode} ${product.productName}` : '—',
          product ? product.dispatchedOrdersCount : channel.dispatchedOrdersCount,
          product ? product.pendingOrdersCount : channel.pendingOrdersCount,
          product ? product.dispatchedCartons : channel.dispatchedCartons,
          product ? product.pendingCartons : channel.pendingCartons,
          product ? product.dispatchedPieces : channel.dispatchedPieces,
          product ? product.pendingPieces : channel.pendingPieces,
          weight(product ? product.dispatchedWeightKg : channel.dispatchedWeightKg),
          weight(product ? product.pendingWeightKg : channel.pendingWeightKg),
        ];
        values.forEach((value, col) => paint(customers, row, col + 1, value, { size: 9 }));
        if (product) {
          customerTotals.dCartons += product.dispatchedCartons;
          customerTotals.pCartons += product.pendingCartons;
          customerTotals.dPieces += product.dispatchedPieces;
          customerTotals.pPieces += product.pendingPieces;
          customerTotals.dWeight += weight(product.dispatchedWeightKg);
          customerTotals.pWeight += weight(product.pendingWeightKg);
        }
        row += 1;
      });
    });
  });
  ['الإجمالي', '', '', '', customerTotals.dOrders, customerTotals.pOrders, customerTotals.dCartons, customerTotals.pCartons, customerTotals.dPieces, customerTotals.pPieces, weight(customerTotals.dWeight), weight(customerTotals.pWeight)]
    .forEach((value, col) => paint(customers, row, col + 1, value, { bold: true, fill: TOTAL_FILL }));

  const safePeriod = report.label.replace(/[^\dA-Za-z\u0600-\u06FF-]+/g, '-');
  await download(workbook, `مسحوبات_العملاء_${safePeriod}.xlsx`);
}

const SHEET_PRODUCT_HEADERS = ['الصنف', 'الكراتين', 'القطع', 'الوزن', 'خرج كراتين', 'متبقي كراتين', 'خرج قطع', 'متبقي قطع', 'خرج وزن', 'متبقي وزن'];

function productValues(product: SalesReportDTO['products'][number]): Array<string | number> {
  return [
    `${product.productCode} ${product.productName}`,
    product.totalCartons,
    product.totalPieces,
    weight(product.totalWeightKg),
    product.dispatchedCartons,
    product.pendingCartons,
    product.dispatchedPieces,
    product.pendingPieces,
    weight(product.dispatchedWeightKg),
    weight(product.pendingWeightKg),
  ];
}

function paintProductBlock(ws: Worksheet, startRow: number, title: string, footLabel: string, products: SalesReportDTO['products']): number {
  let row = startRow;
  for (let col = 1; col <= SHEET_PRODUCT_HEADERS.length; col += 1) {
    paint(ws, row, col, col === 1 ? title : '', { bold: true, size: 12, align: 'right', fill: KPI_FILL });
  }
  ws.mergeCells(row, 1, row, SHEET_PRODUCT_HEADERS.length);
  row += 1;
  writeHeader(ws, row, SHEET_PRODUCT_HEADERS);
  row += 1;
  const totals = { cartons: 0, pieces: 0, weightKg: 0, dCartons: 0, pCartons: 0, dPieces: 0, pPieces: 0, dWeight: 0, pWeight: 0 };
  products.forEach((product, index) => {
    productValues(product).forEach((value, col) => paint(ws, row, col + 1, value, { size: 9, fill: index % 2 ? ZEBRA_FILL : undefined }));
    totals.cartons += product.totalCartons;
    totals.pieces += product.totalPieces;
    totals.weightKg += weight(product.totalWeightKg);
    totals.dCartons += product.dispatchedCartons;
    totals.pCartons += product.pendingCartons;
    totals.dPieces += product.dispatchedPieces;
    totals.pPieces += product.pendingPieces;
    totals.dWeight += weight(product.dispatchedWeightKg);
    totals.pWeight += weight(product.pendingWeightKg);
    row += 1;
  });
  [footLabel, totals.cartons, totals.pieces, weight(totals.weightKg), totals.dCartons, totals.pCartons, totals.dPieces, totals.pPieces, weight(totals.dWeight), weight(totals.pWeight)]
    .forEach((value, col) => paint(ws, row, col + 1, value, { bold: true, fill: TOTAL_FILL }));
  return row + 2;
}

export async function exportCustomerWithdrawals(report: SalesReportDTO, meta: ReportExportMeta): Promise<void> {
  await exportSalesReport(report, meta);
}

export async function exportProductWithdrawals(
  sheets: SalesReportDTO['productsBySheet'],
  products: SalesReportDTO['products'],
  report: SalesReportDTO,
  meta: ReportExportMeta,
): Promise<void> {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  const ws = prepareSheet(workbook, 'مسحوبات الأصناف', [28, 12, 12, 12, 12, 12, 12, 12, 12, 12]);
  let row = writeBanner(
    ws,
    SHEET_PRODUCT_HEADERS.length,
    meta,
    'تقرير مسحوبات الأصناف',
    `الطلبات ${report.summary.totalOrders} · الكراتين ${report.summary.totalCartons} · القطع ${report.summary.totalPieces} · الوزن ${weight(report.summary.totalWeightKg)}`,
  );
  if (sheets.length <= 1) {
    const sheet = sheets[0];
    const title = sheet ? `أوردر #${sheet.sheetNumber} (${sheet.sheetDate})` : 'مسجوبات الأصناف';
    const foot = sheet ? `إجمالي أوردر #${sheet.sheetNumber}` : 'الإجمالي';
    paintProductBlock(ws, row, title, foot, sheet?.products ?? products);
  } else {
    sheets.forEach((sheet) => {
      row = paintProductBlock(ws, row, `أوردر #${sheet.sheetNumber} (${sheet.sheetDate})`, `إجمالي أوردر #${sheet.sheetNumber}`, sheet.products);
    });
    paintProductBlock(ws, row, 'الإجمالي المجمّع للأصناف (كل الأوردرات)', 'الإجمالي العام', products);
  }
  const safePeriod = report.label.replace(/[^\dA-Za-z\u0600-\u06FF-]+/g, '-');
  await download(workbook, `مسحوبات_الأصناف_${safePeriod}.xlsx`);
}

export async function exportFulfillmentReport(report: FulfillmentReportDTO, meta: ReportExportMeta): Promise<void> {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  const orderHeaders = ['الأوردر', 'التاريخ', 'العميل', 'جهة التسليم', 'الحالة', 'الصنف', 'الكراتين', 'القطع', 'الوزن'];
  const orders = prepareSheet(workbook, 'الطلبات وأصنافها', [14, 14, 24, 20, 14, 28, 12, 12, 12]);
  const summary = report.summary;
  let row = writeBanner(
    orders,
    orderHeaders.length,
    meta,
    'تقرير حصر الخروج والمتبقي',
    `خرج ${summary.dispatched.orders} طلب / ${summary.dispatched.cartons} كرتونة / ${summary.dispatched.pieces} قطعة / ${weight(summary.dispatched.weightKg)} كجم · متبقي ${summary.pending.orders} طلب / ${summary.pending.cartons} كرتونة / ${weight(summary.pending.weightKg)} كجم`,
  );
  writeHeader(orders, row, orderHeaders);
  row += 1;
  const totals = { cartons: 0, pieces: 0, weightKg: 0 };
  report.orders.forEach((order) => {
    const active = order.fulfillmentStatus !== 'cancelled';
    if (active) {
      totals.cartons += order.totalCartons;
      totals.pieces += order.totalPieces;
      totals.weightKg += weight(order.totalWeightKg);
    }
    const header = [`${order.sheetNumber}/${order.orderSequence}`, order.sheetDate, order.customerName, order.receiverName, statusLabel(order.fulfillmentStatus), '', order.totalCartons, order.totalPieces, weight(order.totalWeightKg)];
    header.forEach((value, col) => paint(orders, row, col + 1, value, { bold: true, fill: ORDER_FILL, size: 9, text: col === 0 }));
    row += 1;
    (order.items ?? []).forEach((item) => {
      ['', '', '', '', '', `${item.productCode} ${item.productName}`, item.cartonsQty, item.totalPieces, weight(item.weightKg)]
        .forEach((value, col) => paint(orders, row, col + 1, value, { size: 9, fill: ZEBRA_FILL }));
      row += 1;
    });
  });
  ['الإجمالي النشط', '', '', '', '', '', totals.cartons, totals.pieces, weight(totals.weightKg)]
    .forEach((value, col) => paint(orders, row, col + 1, value, { bold: true, fill: TOTAL_FILL }));

  const customerHeaders = ['الكود', 'العميل', 'خرج طلبات', 'متبقي طلبات', 'الصنف', 'خرج كراتين', 'متبقي كراتين', 'خرج قطع', 'متبقي قطع', 'خرج وزن', 'متبقي وزن'];
  const customerSheet = prepareSheet(workbook, 'ملخص العملاء', customerHeaders.map(() => 14));
  customerSheet.getColumn(2).width = 24;
  customerSheet.getColumn(5).width = 28;
  row = writeBanner(customerSheet, customerHeaders.length, meta, 'ملخص العملاء وأصنافهم', `عملاء خرج لهم طلبات ${summary.dispatchedCustomers} · عملاء متبقي لهم طلبات ${summary.pendingCustomers}`);
  writeHeader(customerSheet, row, customerHeaders);
  row += 1;
  const customerTotals = { dOrders: 0, pOrders: 0, dCartons: 0, pCartons: 0, dPieces: 0, pPieces: 0, dWeight: 0, pWeight: 0 };
  report.customerSummary.forEach((customer) => {
    customerTotals.dOrders += customer.dispatchedOrdersCount;
    customerTotals.pOrders += customer.pendingOrdersCount;
    const lines = customer.products.length ? customer.products : [null];
    lines.forEach((product, index) => {
      const values: Array<string | number> = [
        customer.clientCode,
        customer.customerName,
        index === 0 ? customer.dispatchedOrdersCount : 0,
        index === 0 ? customer.pendingOrdersCount : 0,
        product ? `${product.productCode} ${product.productName}` : '—',
        product ? product.dispatchedCartons : customer.dispatchedCartons,
        product ? product.pendingCartons : customer.pendingCartons,
        product ? product.dispatchedPieces : customer.dispatchedPieces,
        product ? product.pendingPieces : customer.pendingPieces,
        weight(product ? product.dispatchedWeightKg : customer.dispatchedWeightKg),
        weight(product ? product.pendingWeightKg : customer.pendingWeightKg),
      ];
      values.forEach((value, col) => paint(customerSheet, row, col + 1, value, { size: 9, fill: index === 0 ? ORDER_FILL : ZEBRA_FILL }));
      if (product) {
        customerTotals.dCartons += product.dispatchedCartons;
        customerTotals.pCartons += product.pendingCartons;
        customerTotals.dPieces += product.dispatchedPieces;
        customerTotals.pPieces += product.pendingPieces;
        customerTotals.dWeight += weight(product.dispatchedWeightKg);
        customerTotals.pWeight += weight(product.pendingWeightKg);
      }
      row += 1;
    });
  });
  ['الإجمالي', '', customerTotals.dOrders, customerTotals.pOrders, '', customerTotals.dCartons, customerTotals.pCartons, customerTotals.dPieces, customerTotals.pPieces, weight(customerTotals.dWeight), weight(customerTotals.pWeight)]
    .forEach((value, col) => paint(customerSheet, row, col + 1, value, { bold: true, fill: TOTAL_FILL }));

  await download(workbook, `حصر-الخروج-${report.from}.xlsx`);
}
