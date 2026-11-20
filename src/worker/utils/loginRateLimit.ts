import { inArray } from 'drizzle-orm';
import { loginRateLimits } from '@/db/schema';
import type { AppDatabase } from '@/db';

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const PRUNE_AGE_MS = 24 * 60 * 60 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const THIRTY_MINUTES = 30 * 60 * 1000;

export interface LoginLock {
  retryAfterSeconds: number;
  minutes: number;
}

interface LimitRule {
  key: string;
  highAttempts: number;
  highMs: number;
  midAttempts: number;
  midMs: number;
  lowAttempts: number;
  lowMs: number;
}

function d1Client(db: AppDatabase): D1Database {
  return (db as AppDatabase & { $client: D1Database }).$client;
}

export function clientIp(header: (name: string) => string | undefined): string {
  const connecting = header('cf-connecting-ip')?.trim();
  if (connecting) return connecting.slice(0, 80);
  const forwarded = header('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded.slice(0, 80);
  return 'local';
}

export function loginRateKeys(ip: string, username: string): { ipUser: string; ip: string; user: string } {
  const safeUser = username.slice(0, 80);
  return {
    ipUser: `ip_user:${ip}:${safeUser}`,
    ip: `ip:${ip}`,
    user: `user:${safeUser}`,
  };
}

function lockFromRows(rows: Array<{ lockedUntil: number | null }>, now: number): LoginLock | null {
  let until = 0;
  for (const row of rows) {
    if (row.lockedUntil && row.lockedUntil > now) until = Math.max(until, row.lockedUntil);
  }
  if (!until) return null;
  const retryAfterSeconds = Math.max(1, Math.ceil((until - now) / 1000));
  return {
    retryAfterSeconds,
    minutes: Math.max(1, Math.ceil(retryAfterSeconds / 60)),
  };
}

export async function activeLoginLock(db: AppDatabase, keys: string[], now = Date.now()): Promise<LoginLock | null> {
  const rows = await db
    .select({ lockedUntil: loginRateLimits.lockedUntil })
    .from(loginRateLimits)
    .where(inArray(loginRateLimits.key, keys));
  return lockFromRows(rows, now);
}

const UPSERT_SQL = `
INSERT INTO login_rate_limits (key, attempts, first_attempt_at, locked_until, updated_at)
VALUES (?1, 1, ?2, NULL, ?2)
ON CONFLICT(key) DO UPDATE SET
  attempts = CASE
    WHEN (login_rate_limits.locked_until IS NULL OR login_rate_limits.locked_until <= ?2)
     AND (?2 - login_rate_limits.first_attempt_at) >= ?3
    THEN 1
    ELSE login_rate_limits.attempts + 1
  END,
  first_attempt_at = CASE
    WHEN (login_rate_limits.locked_until IS NULL OR login_rate_limits.locked_until <= ?2)
     AND (?2 - login_rate_limits.first_attempt_at) >= ?3
    THEN ?2
    ELSE login_rate_limits.first_attempt_at
  END,
  updated_at = ?2,
  locked_until = CASE
    WHEN login_rate_limits.locked_until IS NOT NULL AND login_rate_limits.locked_until > ?2
      THEN login_rate_limits.locked_until
    WHEN (
      CASE
        WHEN (login_rate_limits.locked_until IS NULL OR login_rate_limits.locked_until <= ?2)
         AND (?2 - login_rate_limits.first_attempt_at) >= ?3
        THEN 1
        ELSE login_rate_limits.attempts + 1
      END
    ) >= ?4 THEN ?2 + ?5
    WHEN (
      CASE
        WHEN (login_rate_limits.locked_until IS NULL OR login_rate_limits.locked_until <= ?2)
         AND (?2 - login_rate_limits.first_attempt_at) >= ?3
        THEN 1
        ELSE login_rate_limits.attempts + 1
      END
    ) >= ?6 THEN ?2 + ?7
    WHEN (
      CASE
        WHEN (login_rate_limits.locked_until IS NULL OR login_rate_limits.locked_until <= ?2)
         AND (?2 - login_rate_limits.first_attempt_at) >= ?3
        THEN 1
        ELSE login_rate_limits.attempts + 1
      END
    ) >= ?8 THEN ?2 + ?9
    ELSE NULL
  END
`;

function rule(key: string, highAttempts: number, highMs: number, midAttempts: number, midMs: number, lowAttempts: number, lowMs: number): LimitRule {
  return { key, highAttempts, highMs, midAttempts, midMs, lowAttempts, lowMs };
}

export function failureRules(keys: { ipUser: string; ip: string; user: string }): LimitRule[] {
  return [
    rule(keys.ipUser, 15, THIRTY_MINUTES, 10, FIFTEEN_MINUTES, 5, FIVE_MINUTES),
    rule(keys.ip, 1_000_000, 0, 1_000_000, 0, 20, FIFTEEN_MINUTES),
    rule(keys.user, 1_000_000, 0, 1_000_000, 0, 15, FIVE_MINUTES),
  ];
}

export function resetRequestRules(ip: string, username: string): LimitRule[] {
  const safeUser = username.slice(0, 80);
  return [
    rule(`reset_req:ip:${ip}`, 1_000_000, 0, 1_000_000, 0, 10, FIFTEEN_MINUTES),
    rule(`reset_req_user:${ip}:${safeUser}`, 1_000_000, 0, 1_000_000, 0, 3, FIFTEEN_MINUTES),
  ];
}

export function resetVerifyRules(ip: string, username: string): LimitRule[] {
  const safeUser = username.slice(0, 80);
  return [
    rule(`reset_verify:ip_user:${ip}:${safeUser}`, 1_000_000, 0, 10, THIRTY_MINUTES, 5, FIFTEEN_MINUTES),
    rule(`reset_verify:ip:${ip}`, 1_000_000, 0, 1_000_000, 0, 15, FIFTEEN_MINUTES),
  ];
}

export function recoverySuccessKeys(ip: string, username: string): string[] {
  const login = loginRateKeys(ip, username);
  return [
    ...resetVerifyRules(ip, username).map((item) => item.key),
    login.ipUser,
    login.user,
  ];
}

export async function registerLoginFailure(db: AppDatabase, rules: LimitRule[], now = Date.now()): Promise<LoginLock | null> {
  const client = d1Client(db);
  const statements = rules.map((item) => client.prepare(UPSERT_SQL).bind(
    item.key,
    now,
    LOGIN_WINDOW_MS,
    item.highAttempts,
    item.highMs,
    item.midAttempts,
    item.midMs,
    item.lowAttempts,
    item.lowMs,
  ));
  statements.push(client.prepare('DELETE FROM login_rate_limits WHERE updated_at < ?1').bind(now - PRUNE_AGE_MS));
  await client.batch(statements);
  return activeLoginLock(db, rules.map((item) => item.key), now);
}

export async function clearLoginFailures(db: AppDatabase, keys: string[]): Promise<void> {
  const now = Date.now();
  const client = d1Client(db);
  const statements = [
    client.prepare('DELETE FROM login_rate_limits WHERE updated_at < ?1').bind(now - PRUNE_AGE_MS),
  ];
  if (keys.length > 0) {
    const placeholders = keys.map(() => '?').join(', ');
    statements.unshift(client.prepare(`DELETE FROM login_rate_limits WHERE key IN (${placeholders})`).bind(...keys));
  }
  await client.batch(statements);
}
