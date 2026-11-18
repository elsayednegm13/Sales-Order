import { sanitizeExcelCell } from '@/client/lib/excelSanitize';

export interface ExcelColumnDefinition<Row> {
  header: string;
  width?: number;
  accessor: (row: Row, index: number) => string | number;
}

/**
 * Exports tabular data to an RTL-configured `.xlsx` workbook using SheetJS.
 */
export async function exportRowsToExcel<Row>(params: {
  filename: string;
  sheetName: string;
  columns: ExcelColumnDefinition<Row>[];
  rows: Row[];
}): Promise<void> {
  const XLSX = await import('xlsx');
  const headerRow = params.columns.map((col) => col.header);
  const dataRows = params.rows.map((row, index) =>
    params.columns.map((col) => sanitizeExcelCell(col.accessor(row, index))),
  );

  const worksheet = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  worksheet['!cols'] = params.columns.map((col) => ({
    wch: col.width ?? 20,
  }));

  const workbook = XLSX.utils.book_new();
  workbook.Workbook = {
    Views: [{ RTL: true }],
  };

  XLSX.utils.book_append_sheet(workbook, worksheet, params.sheetName.slice(0, 31));
  const safeName = params.filename.endsWith('.xlsx')
    ? params.filename
    : `${params.filename}.xlsx`;
  XLSX.writeFile(workbook, safeName, { bookType: 'xlsx' });
}

/**
 * Triggers native browser Print / Save-as-PDF view formatted via `@media print`.
 */
export function triggerPrintPdfView(): void {
  window.print();
}
