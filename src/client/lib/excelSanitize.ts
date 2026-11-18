const FORMULA_START = /^[=+\-@\t\r]/;

/** Stops Excel from treating user text as a formula. Numbers stay numeric. */
export function sanitizeExcelCell(value: string | number): string | number {
  if (typeof value === 'number') return value;
  const text = String(value);
  if (FORMULA_START.test(text.trimStart())) return `'${text}`;
  return text;
}
