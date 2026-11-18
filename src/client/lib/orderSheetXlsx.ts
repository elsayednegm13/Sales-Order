import type { Alignment, Borders, Worksheet } from 'exceljs';
import { sanitizeExcelCell } from '@/client/lib/excelSanitize';
import { cartonsPrintValue, packingPrintValue, weightNotesValue, type SheetPrintModel } from '@/client/lib/orderSheetLayout';
import type { ClientOrderDetailDTO } from '@/shared/types';

const COLUMNS = 13;
const WIDTHS = [5, 16, 14, 12, 12, 12, 20, 8, 10, 10, 16, 8, 16];

const THIN = { style: 'thin' as const, color: { argb: 'FF000000' } };
const BORDER: Partial<Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };

const CENTER: Partial<Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };

function sheetTitle(sheetNumber: string): string {
  const safe = sheetNumber.replace(/[\\:*?[\]]/g, '-').replaceAll('/', '-').trim() || 'Sheet';
  return `SALES ORDER ${safe}`.slice(0, 31);
}

function paint(
  ws: Worksheet,
  row: number,
  col: number,
  value: string | number,
  options?: { bold?: boolean; size?: number; wrap?: boolean; horizontal?: Alignment['horizontal']; text?: boolean }
) {
  const cell = ws.getCell(row, col);
  const raw = options?.text ? String(value) : value;
  cell.value = typeof raw === 'string' ? sanitizeExcelCell(raw) : raw;
  cell.font = { name: 'Tahoma', size: options?.size ?? 10, bold: options?.bold ?? false };
  cell.alignment = {
    ...CENTER,
    horizontal: options?.horizontal ?? 'center',
    wrapText: options?.wrap ?? true,
  };
  cell.border = BORDER;
  if (options?.text) cell.numFmt = '@';
  return cell;
}

function merge(ws: Worksheet, row: number, col: number, rowEnd: number, colEnd: number) {
  if (rowEnd > row || colEnd > col) ws.mergeCells(row, col, rowEnd, colEnd);
}

function partyLines(order: ClientOrderDetailDTO): string {
  if (order.deliveryType === 'sub_merchant') {
    return [order.subMerchantName, order.subMerchantPhone].filter(Boolean).join('\n');
  }
  return order.deliveryPhone ?? '';
}

export async function buildOrderSheetXlsx(model: SheetPrintModel): Promise<ArrayBuffer> {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  const ws = workbook.addWorksheet(sheetTitle(String(model.sheet.sheetNumber ?? '')), {
    views: [{ rightToLeft: true, showGridLines: false, state: 'normal' }],
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.3, right: 0.3, top: 0.35, bottom: 0.35, header: 0.1, footer: 0.1 },
    },
  });

  WIDTHS.forEach((width, index) => {
    ws.getColumn(index + 1).width = width;
  });

  paint(ws, 1, 1, model.sheet.sheetDate, { bold: true, size: 14, wrap: false, horizontal: 'right' });
  paint(ws, 1, 7, `ORDERS NO ${model.sheet.sheetNumber}`, { bold: true, size: 14, wrap: false, horizontal: 'left' });
  for (let col = 1; col <= COLUMNS; col += 1) {
    if (col !== 1 && col !== 7) paint(ws, 1, col, '', { bold: true, size: 14, wrap: false });
  }
  merge(ws, 1, 1, 1, 6);
  merge(ws, 1, 7, 1, COLUMNS);
  ws.getRow(1).height = 28;
  ws.getRow(2).height = 8;

  const headers = [
    'م',
    'العميل',
    'المكان',
    'عدد السيارات',
    'المندوب',
    'كود الصنف',
    'الصنف',
    'التعبئة',
    'عدد الكراتين',
    'عدد القطع',
    'الوزن (كجم) / ملاحظات',
    '',
    '',
  ];
  headers.forEach((header, index) => paint(ws, 3, index + 1, header, { bold: true, size: 9 }));
  ws.getRow(3).height = 32;

  let row = 4;
  const orders = model.orders ?? [];
  orders.forEach((order, orderIndex) => {
    const items = order.items?.length ? order.items : [];
    const span = Math.max(items.length, 1);
    const start = row;
    for (let index = 0; index < span; index += 1) {
      const item = items[index];
      ws.getRow(row).height = span === 1 ? 36 : 20;
      if (index === 0) {
        paint(ws, row, 1, orderIndex + 1, { wrap: false });
        paint(ws, row, 2, `${order.customerName}\n${order.customerCode}`);
        paint(ws, row, 3, order.deliveryLocation);
        paint(ws, row, 4, order.trucksCount || 1, { wrap: false });
        paint(ws, row, 5, order.representativeName ?? '');
        paint(ws, row, 12, order.warehouseRef ?? '');
        paint(ws, row, 13, partyLines(order), { text: true, wrap: order.deliveryType === 'sub_merchant' });
      } else {
        for (const col of [1, 2, 3, 4, 5, 12, 13]) paint(ws, row, col, '');
      }
      paint(ws, row, 6, item ? item.productCode : '');
      paint(ws, row, 7, item ? item.productName : '');
      paint(ws, row, 8, item ? packingPrintValue(item) : '', { wrap: false });
      paint(ws, row, 9, item ? cartonsPrintValue(item) : '', { wrap: false });
      paint(ws, row, 10, item ? item.totalPieces : '', { wrap: false });
      paint(ws, row, 11, item ? weightNotesValue(item) : '');
      row += 1;
    }
    for (const col of [1, 2, 3, 4, 5, 12, 13]) merge(ws, start, col, start + span - 1, col);
    if (orderIndex < orders.length - 1) {
      ws.getRow(row).height = 12;
      row += 1;
    }
  });

  const signStart = row;
  paint(ws, signStart, 1, 'مدير المبيعات', { bold: true, size: 12 });
  paint(ws, signStart, 5, 'الاداره المالية', { bold: true, size: 12 });
  paint(ws, signStart, 10, 'ادارة الانتاج', { bold: true, size: 12 });
  for (let col = 1; col <= COLUMNS; col += 1) {
    if (col !== 1 && col !== 5 && col !== 10) paint(ws, signStart, col, '', { bold: true, size: 12 });
  }
  merge(ws, signStart, 1, signStart, 4);
  merge(ws, signStart, 5, signStart, 9);
  merge(ws, signStart, 10, signStart, COLUMNS);
  ws.getRow(signStart).height = 42;

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
