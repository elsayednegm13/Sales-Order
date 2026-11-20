import { sanitizeExcelCell } from '@/client/lib/excelSanitize';
import {
  auditActionLabel,
  auditModuleLabel,
  describeAuditDetails,
  formatCairoDateTime,
  type AuditLogEntry,
} from '@/shared/auditLog';

const HEADERS = ['التاريخ والوقت (القاهرة)', 'المنفّذ', 'القسم', 'الإجراء', 'العنصر', 'الملخص', 'التفاصيل', 'عنوان IP'];

function cellText(value: string): string {
  const safe = sanitizeExcelCell(value);
  return typeof safe === 'string' ? safe : String(safe);
}

export function auditExportFilename(period: 'all' | 'daily' | 'monthly' | 'custom', from: string, to: string, month: string): string {
  if (period === 'daily') return `audit-log-${from}.xlsx`;
  if (period === 'monthly') return `audit-log-${month}.xlsx`;
  if (period === 'custom') return `audit-log-${from}_to_${to}.xlsx`;
  return 'audit-log-all.xlsx';
}

export async function exportAuditLog(rows: AuditLogEntry[], filename: string, truncated: boolean): Promise<void> {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('سجل النشاط', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: truncated ? 2 : 1 }],
  });
  const widths = [24, 28, 18, 24, 28, 42, 48, 18];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  let headerRow = 1;
  if (truncated) {
    sheet.mergeCells(1, 1, 1, HEADERS.length);
    const notice = sheet.getCell(1, 1);
    notice.value = cellText('هذا الملف يحتوي أحدث 5000 سجل مطابق للتصفية فقط.');
    notice.font = { bold: true, color: { argb: 'FF9A3412' } };
    notice.alignment = { horizontal: 'right', vertical: 'middle' };
    headerRow = 2;
  }
  HEADERS.forEach((header, index) => {
    const cell = sheet.getCell(headerRow, index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  rows.forEach((row, index) => {
    const line = headerRow + 1 + index;
    const details = describeAuditDetails(row.details).join('\n');
    const values = [
      formatCairoDateTime(row.createdAt),
      `${row.actorFullName} (@${row.actorUsername})`,
      auditModuleLabel(row.module),
      auditActionLabel(row.action),
      row.entityLabel ?? '',
      row.summary,
      details,
      row.ipAddress ?? '',
    ];
    values.forEach((value, column) => {
      const cell = sheet.getCell(line, column + 1);
      cell.value = cellText(value);
      cell.alignment = { horizontal: 'right', vertical: 'top', wrapText: true };
    });
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
