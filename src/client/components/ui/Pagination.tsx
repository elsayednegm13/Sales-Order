const PAGE_WINDOW = 5;

function pageNumbers(page: number, pageCount: number): number[] {
  const start = Math.max(1, Math.min(page - 2, pageCount - PAGE_WINDOW + 1));
  const end = Math.min(pageCount, start + PAGE_WINDOW - 1);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (total <= 0) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const numbers = pageNumbers(page, pageCount);

  return (
    <nav className="no-print flex flex-wrap items-center justify-between gap-3" aria-label="ترقيم الصفحات">
      <p className="text-xs font-semibold text-slate-500">
        <span className="tabular-nums">{from}–{to}</span> من <span className="tabular-nums">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white"
        >
          السابق
        </button>
        {numbers[0] > 1 && <span className="px-1 text-xs text-slate-400">…</span>}
        {numbers.map((number) => (
          <button
            key={number}
            type="button"
            onClick={() => onPage(number)}
            aria-current={number === page ? 'page' : undefined}
            className={`tabular-nums h-8 min-w-8 rounded-lg border px-2 text-xs font-bold dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white ${
              number === page ? 'border-blue-600 bg-blue-600 text-white dark:hover:!bg-blue-600 dark:hover:!text-white' : ''
            }`}
          >
            {number}
          </button>
        ))}
        {numbers[numbers.length - 1] < pageCount && <span className="px-1 text-xs text-slate-400">…</span>}
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
          className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white"
        >
          التالي
        </button>
      </div>
    </nav>
  );
}
