async function downloadWorkbook(workbook: import('exceljs').Workbook, filename: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function styleHeader(sheet: import('exceljs').Worksheet, columnCount: number): void {
  const header = sheet.getRow(1);
  header.height = 24;
  header.font = { name: 'Tahoma', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  header.alignment = { horizontal: 'center', vertical: 'middle' };
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = header.getCell(column);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF1E3A8A' } },
      left: { style: 'thin', color: { argb: 'FF1E3A8A' } },
      bottom: { style: 'thin', color: { argb: 'FF1E3A8A' } },
      right: { style: 'thin', color: { argb: 'FF1E3A8A' } },
    };
  }
}

function listValidation(formulae: string) {
  return {
    type: 'list' as const,
    allowBlank: true,
    formulae: [formulae],
    showErrorMessage: true,
    errorStyle: 'warning' as const,
    error: 'اختر قيمة من القائمة',
  };
}

export async function downloadProductTemplate(): Promise<void> {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('تكويد المنتجات', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = [
    { header: 'كود الصنف *', width: 18 },
    { header: 'اسم الصنف *', width: 34 },
    { header: 'الفئة', width: 16 },
    { header: 'الدرجة', width: 16 },
    { header: 'نوع التحميل', width: 16 },
    { header: 'التعبئة', width: 14 },
    { header: 'الوزن المرجعي', width: 16 },
    { header: 'الحالة', width: 12 },
  ];
  styleHeader(sheet, 8);
  const samples = [
    ['HT-080', 'دفاية مخمل مزدوجة', 'دفايات', 'درجة أولى', 'كرتونة', 8, 2.5, 'نشط'],
    ['BL-060', 'بطانية صوف مزدوجة فاخرة', 'بطاطين', 'درجة أولى', 'كرتونة', 6, 3.2, 'نشط'],
  ];
  samples.forEach((sample, index) => {
    const row = sheet.getRow(index + 2);
    sample.forEach((value, column) => {
      const cell = row.getCell(column + 1);
      cell.value = value;
      cell.font = { name: 'Tahoma', italic: true, color: { argb: 'FF475569' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  });
  const validations = sheet as unknown as { dataValidations: { add: (range: string, rule: ReturnType<typeof listValidation>) => void } };
  validations.dataValidations.add('C2:C500', listValidation('"بطاطين,دفايات,أخرى"'));
  validations.dataValidations.add('D2:D500', listValidation('"درجة أولى,درجة ثانية"'));
  validations.dataValidations.add('E2:E500', listValidation('"كرتونة,كيس,قطعة,كجم"'));
  validations.dataValidations.add('H2:H500', listValidation('"نشط,موقوف"'));
  await downloadWorkbook(workbook, 'قالب_تكويد_المنتجات.xlsx');
}

export async function downloadCustomerTemplate(): Promise<void> {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  const customers = workbook.addWorksheet('العملاء الرئيسيين', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });
  customers.columns = [
    { header: 'كود العميل *', width: 20 },
    { header: 'اسم العميل *', width: 28 },
    { header: 'المخزن / المنطقة', width: 28 },
    { header: 'رقم الهاتف', width: 20 },
    { header: 'المندوب', width: 22 },
  ];
  styleHeader(customers, 5);
  const customerRow = customers.getRow(2);
  ['UP-11', 'علاء الدين', 'مخزن الإسكندرية', '01225556677', 'أحمد'].forEach((value, column) => {
    const cell = customerRow.getCell(column + 1);
    cell.value = value;
    cell.font = { name: 'Tahoma', italic: true, color: { argb: 'FF475569' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  customerRow.getCell(4).numFmt = '@';
  customers.getColumn(4).numFmt = '@';

  const merchants = workbook.addWorksheet('التجار الفرعيين', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });
  merchants.columns = [
    { header: 'كود العميل الرئيسي *', width: 24 },
    { header: 'اسم التاجر الفرعي *', width: 28 },
    { header: 'المنطقة / العنوان', width: 32 },
    { header: 'رقم الهاتف', width: 20 },
  ];
  styleHeader(merchants, 4);
  const merchantRow = merchants.getRow(2);
  ['UP-11', 'تاجر سموحة', 'سموحة، الإسكندرية', '01001234567'].forEach((value, column) => {
    const cell = merchantRow.getCell(column + 1);
    cell.value = value;
    cell.font = { name: 'Tahoma', italic: true, color: { argb: 'FF475569' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  merchantRow.getCell(4).numFmt = '@';
  merchants.getColumn(4).numFmt = '@';
  await downloadWorkbook(workbook, 'قالب_العملاء_والتجار.xlsx');
}
