import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { users } from '@/db/schema';
import type { AppContextEnv } from '@/worker/types';
import { verifyPassword, hashPassword } from '@/worker/utils/crypto';
import { clearAuthCookie, extractAuthToken, setAuthCookie, signUserToken, verifyUserToken } from '@/worker/utils/jwt';
import { mapUserRowToDTO, requireAuth, safeUserColumns } from '@/worker/middleware/auth';
import { loginSchema, readJson } from '@/worker/schemas';
import { nextSheetNumber } from '@/worker/services/dailySheets';

export const authRoutes = new Hono<AppContextEnv>();

const UNIFIED_LOGIN_ERROR = 'اسم المستخدم أو كلمة المرور غير صحيحة';
const dummyPasswordHash = hashPassword('timing-equalization-placeholder');

type AttemptBucket = {
  failures: number;
  windowStart: number;
  blockedUntil: number;
};

const loginAttempts = new Map<string, AttemptBucket>();
const WINDOW_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const FAILURE_LIMIT = 8;

function clientAddress(header: (name: string) => string | undefined): string {
  return header('CF-Connecting-IP') || header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
}

function attemptKey(address: string, username: string): string {
  return `${address}|${username}`;
}

function currentBucket(key: string): AttemptBucket {
  const now = Date.now();
  const existing = loginAttempts.get(key);
  if (!existing || now - existing.windowStart > WINDOW_MS) {
    const fresh = { failures: 0, windowStart: now, blockedUntil: 0 };
    loginAttempts.set(key, fresh);
    return fresh;
  }
  return existing;
}

authRoutes.post('/login', async (c) => {
  const parsed = await readJson(c, loginSchema);
  if (!parsed.ok) return c.json({ error: UNIFIED_LOGIN_ERROR }, 401);

  const username = parsed.data.username.trim().toLowerCase();
  const password = parsed.data.password;
  const key = attemptKey(clientAddress((name) => c.req.header(name)), username);
  const bucket = currentBucket(key);
  if (bucket.blockedUntil > Date.now()) {
    return c.json({ error: 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة', code: 'RATE_LIMITED' }, 429);
  }

  const db = c.get('db');
  const userRow = await db
    .select({
      ...safeUserColumns,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.username, username))
    .get();

  const passwordOk = userRow
    ? await verifyPassword(password, userRow.passwordHash)
    : await verifyPassword(password, await dummyPasswordHash);

  if (!userRow || !passwordOk || !userRow.isActive) {
    bucket.failures += 1;
    if (bucket.failures >= FAILURE_LIMIT) bucket.blockedUntil = Date.now() + COOLDOWN_MS;
    return c.json({ error: UNIFIED_LOGIN_ERROR }, 401);
  }

  loginAttempts.delete(key);
  const userDto = mapUserRowToDTO(userRow);
  const token = await signUserToken(c, { ...userDto, tokenVersion: userRow.tokenVersion });
  setAuthCookie(c, token);
  return c.json({
    user: userDto,
    nextSheetNumber: await nextSheetNumber(db),
  });
});

authRoutes.post('/logout', async (c) => {
  const token = extractAuthToken(c);
  if (token) {
    const payload = await verifyUserToken(c, token);
    const userId = Number.parseInt(payload?.sub ?? '', 10);
    if (payload && Number.isFinite(userId)) {
      await c.get('db')
        .update(users)
        .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
        .where(eq(users.id, userId));
    }
  }
  clearAuthCookie(c);
  return c.json({ ok: true });
});

authRoutes.get('/me', requireAuth, async (c) => {
  return c.json({
    user: c.get('user'),
    nextSheetNumber: await nextSheetNumber(c.get('db')),
  });
});
