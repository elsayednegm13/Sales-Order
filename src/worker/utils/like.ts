import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

/** Bound LIKE pattern with escaped `%`, `_`, and `\`. */
export function containsLike(column: AnyColumn, search: string): SQL {
  const pattern = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}
