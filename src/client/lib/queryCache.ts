const STALE_MS = 30_000;

type Entry = {
  at: number;
  value: unknown;
};

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export async function cachedQuery<T>(key: string, load: () => Promise<T>, force = false): Promise<T> {
  const hit = entries.get(key);
  if (!force && hit && Date.now() - hit.at < STALE_MS) {
    return hit.value as T;
  }
  const pending = !force ? inflight.get(key) : undefined;
  if (pending) return pending as Promise<T>;

  const promise = load()
    .then((value) => {
      entries.set(key, { at: Date.now(), value });
      inflight.delete(key);
      return value;
    })
    .catch((error: unknown) => {
      inflight.delete(key);
      throw error;
    });
  inflight.set(key, promise);
  return promise;
}

export function invalidateQueries(prefixes: string[]): void {
  for (const key of entries.keys()) {
    if (prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}:`))) {
      entries.delete(key);
    }
  }
}
