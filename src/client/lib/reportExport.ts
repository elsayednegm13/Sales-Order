import type { WorkBook } from 'xlsx';
import { sanitizeExcelCell } from '@/client/lib/excelSanitize';
import { ITEM_TYPE_LABELS_AR } from '@/shared/labels';
import type { SalesReportDTO } from '@/shared/types';

type XlsxModule = typeof import('xlsx');

function appendSheet(XLSX: XlsxModule, workbook: WorkBook, name: string, header: string[], rows: Array<Array<string | number>>, widths: number[]): void {
  const worksheet = XLSX.utils.aoa_to_sheet([
    header.map((cell) => sanitizeExcelCell(cell)),
    ...rows.map((row) => row.map((cell) => sanitizeExcelCell(cell))),
  ]);
  worksheet['!cols'] = widths.map((width) => ({ wch: width }));
  XLSX.utils.book_append_sheet(workbook, worksheet, name.slice(0, 31));
}

/** Two-sheet RTL workbook for the sales report. Existing catalog and order exporters are unchanged. */
export async function exportSalesReport(report: SalesReportDTO): Promise<void> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  workbook.Workbook = { Views: [{ RTL: true }] };

  const customerRows = report.customers.flatMap((customer) =>
    customer.channels.length > 0
      ? customer.channels.flatMap((channel) => {
          const channelName = channel.deliveryType === 'sub_merchant' ? `تاجر: ${channel.subMerchantName ?? '—'}` : 'مخزن العميل';
          const summary: Array<string | number> = [
            customer.clientCode,
            customer.customerName,
            channelName,
            '',
            channel.ordersCount,
            channel.totalCartons,
            channel.totalPieces,
            channel.totalWeightKg,
          ];
          const products = channel.products.map((product) => [
            customer.clientCode,
            customer.customerName,
            channelName,
            `${product.productCode} ${product.productName}`,
            product.ordersCount,
            product.totalCartons,
            product.totalPieces,
            product.totalWeightKg,
          ]);
          return [summary, ...products];
        })
      : [[customer.clientCode, customer.customerName, '—', '', customer.ordersCount, customer.totalCartons, customer.totalPieces, customer.totalWeightKg]]
  );

  appendSheet(
    XLSX,
    workbook,
    'العملاء والتجار',
    ['كود العميل', 'العميل', 'جهة التسليم', 'الصنف', 'الطلبات', 'الكراتين', 'القطع', 'الوزن كجم'],
    customerRows,
    [16, 28, 24, 36, 12, 12, 12, 14]
  );
  appendSheet(
    XLSX,
    workbook,
    'الأصناف',
    ['كود الصنف', 'الصنف', 'النمط', 'الطلبات', 'الكراتين', 'القطع', 'الوزن كجم'],
    report.products.map((product) => [
      product.productCode,
      product.productName,
      ITEM_TYPE_LABELS_AR[product.unitType],
      product.ordersCount,
      product.totalCartons,
      product.totalPieces,
      product.totalWeightKg,
    ]),
    [16, 36, 14, 12, 12, 12, 14]
  );

  const safePeriod = report.label.replace(/[^\dA-Za-z\u0600-\u06FF-]+/g, '-');
  XLSX.writeFile(workbook, `تقرير-المبيعات-${safePeriod}.xlsx`, { bookType: 'xlsx' });
}
