import { eq, inArray, sql } from 'drizzle-orm';
import { cacheVersions } from '@/db/schema';
import type { AppDatabase } from '@/db';

type CacheEntry = {
  expires: number;
  value: string;
};

const memory = new Map<string, CacheEntry>();
const versionMemory = new Map<string, { version: number; expires: number }>();
const DEFAULT_TTL_MS = 60_000;
const VERSION_TTL_MS = 2_000;
const EDGE_ORIGIN = 'https://sales-order-cache.internal/';

export const CACHE_NAMESPACES = {
  products: 'products',
  customers: 'customers',
  settings: 'settings',
  dashboard: 'dashboard',
  nextSheet: 'next_sheet',
  reports: 'reports',
} as const;

export type CacheNamespace = (typeof CACHE_NAMESPACES)[keyof typeof CACHE_NAMESPACES];

function edgeRequest(key: string): Request {
  return new Request(`${EDGE_ORIGIN}${encodeURIComponent(key)}`);
}

async function readEdge<T>(key: string): Promise<T | undefined> {
  try {
    const cached = await caches.default.match(edgeRequest(key));
    if (!cached) return undefined;
    return (await cached.json()) as T;
  } catch {
    return undefined;
  }
}

async function writeEdge(key: string, value: unknown, ttlMs: number): Promise<void> {
  try {
    await caches.default.put(
      edgeRequest(key),
      new Response(JSON.stringify(value), {
        headers: {
          'content-type': 'application/json',
          'cache-control': `private, max-age=${Math.ceil(ttlMs / 1000)}`,
        },
      })
    );
  } catch {
    // The edge cache is an optimization. The database remains the source of truth.
  }
}

function rememberVersion(namespace: string, version: number): void {
  versionMemory.set(namespace, { version, expires: Date.now() + VERSION_TTL_MS });
}

export function dashboardCacheEtag(version: number): string {
  return `W/"dash-v${version}"`;
}

export function ifNoneMatchSatisfied(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((part) => part.trim() === etag);
}

export async function readCacheVersion(db: AppDatabase, namespace: CacheNamespace): Promise<number> {
  const cached = versionMemory.get(namespace);
  if (cached && cached.expires > Date.now()) return cached.version;

  const row = await db
    .select({ version: cacheVersions.version })
    .from(cacheVersions)
    .where(eq(cacheVersions.name, namespace))
    .get();
  if (!row) {
    await db.insert(cacheVersions).values({ name: namespace, version: 1 }).onConflictDoNothing();
    rememberVersion(namespace, 1);
    return 1;
  }
  rememberVersion(namespace, row.version);
  return row.version;
}

export async function bumpCacheVersions(db: AppDatabase, namespaces: CacheNamespace[]): Promise<void> {
  const unique = [...new Set(namespaces)];
  if (unique.length === 0) return;
  for (const name of unique) versionMemory.delete(name);
  await db
    .update(cacheVersions)
    .set({ version: sql`${cacheVersions.version} + 1` })
    .where(inArray(cacheVersions.name, unique));
  for (const name of unique) versionMemory.delete(name);
}

export async function readVersionedCache<T>(
  db: AppDatabase,
  namespace: CacheNamespace,
  suffix: string,
  loader: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS
): Promise<T> {
  const version = await readCacheVersion(db, namespace);
  const key = `${namespace}:v${version}:${suffix}`;
  const now = Date.now();
  const hit = memory.get(key);
  if (hit && hit.expires > now) {
    return JSON.parse(hit.value) as T;
  }

  const edgeHit = await readEdge<T>(key);
  if (edgeHit !== undefined) {
    memory.set(key, { expires: now + ttlMs, value: JSON.stringify(edgeHit) });
    return edgeHit;
  }

  const value = await loader();
  memory.set(key, { expires: now + ttlMs, value: JSON.stringify(value) });
  await writeEdge(key, value, ttlMs);
  return value;
}
