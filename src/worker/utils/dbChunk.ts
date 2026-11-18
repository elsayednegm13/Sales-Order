/** Runs an `inArray` query in batches so D1 never receives 100 or more bound parameters. */
export async function chunkedInArrayQuery<TId, TRow>(
  ids: readonly TId[],
  chunkSize = 75,
  queryFn: (chunk: TId[]) => Promise<TRow[]>,
): Promise<TRow[]> {
  if (ids.length === 0) return [];
  const size = Math.max(1, Math.min(chunkSize, 75));
  const rows: TRow[] = [];
  for (let index = 0; index < ids.length; index += size) {
    rows.push(...(await queryFn(ids.slice(index, index + size))));
  }
  return rows;
}
