import { useBranding } from '@/client/contexts/BrandingContext';

export function ReportPrint({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}) {
  const { settings } = useBranding();
  const today = new Date().toLocaleDateString('en-CA');

  return (
    <section className="report-print">
      <link rel="stylesheet" href="/fonts/cairo.css" />
      <header className="report-print-head">
        <strong>{settings.companyName}</strong>
        <span>{today}</span>
      </header>
      <h1>{title}</h1>
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
