export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`skeleton-shimmer rounded-lg ${className}`} />;
}

export function SkeletonTableRows({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} aria-hidden="true">
          {Array.from({ length: columns }, (_, column) => (
            <td key={column} className="px-4 py-3.5">
              <SkeletonBlock className={column === 0 ? 'h-4 w-24' : column === columns - 1 ? 'ml-auto h-8 w-24' : 'h-4 w-full max-w-40'} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function SkeletonCard({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <article key={index} className="rounded-2xl border border-slate-200/90 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBlock className="h-3 w-28" />
              <SkeletonBlock className="h-4 w-48" />
              <SkeletonBlock className="h-3 w-64" />
            </div>
            <SkeletonBlock className="h-8 w-32" />
          </div>
          <div className="mt-4 space-y-2">
            <SkeletonBlock className="h-3 w-full" />
            <SkeletonBlock className="h-3 w-4/5" />
          </div>
        </article>
      ))}
    </div>
  );
}
