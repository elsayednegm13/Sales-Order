import { buildOrderSheetXlsx } from '@/client/lib/orderSheetXlsx';
import type { ClientOrderDetailDTO, DailySheetDetailDTO } from '@/shared/types';

export async function exportOrderSheetExcel(sheet: DailySheetDetailDTO, orders: ClientOrderDetailDTO[]) {
  const buffer = await buildOrderSheetXlsx({ sheet, orders: orders ?? [] });
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeNumber = String(sheet.sheetNumber ?? '')
    .replace(/[\\:*?"<>|]/g, '-')
    .replaceAll('/', '-')
    .trim() || 'sheet';
  link.href = url;
  link.download = `SALES ORDER ${safeNumber}.xlsx`;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
