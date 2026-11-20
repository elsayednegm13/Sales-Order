import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { users } from '@/db/schema';
import type { AppContextEnv } from '@/worker/types';
import { verifyPassword, hashPassword } from '@/worker/utils/crypto';
import { clearAuthCookie, extractAuthToken, setAuthCookie, signUserToken, verifyUserToken, resolveJwtSecret } from '@/worker/utils/jwt';
import { normalizeRecoveryCode } from '@/worker/utils/crypto';
import { mapUserRowToDTO, requireAuth, safeUserColumns } from '@/worker/middleware/auth';
import { loginSchema, passwordResetConfirmSchema, passwordResetRequestSchema, readJson } from '@/worker/schemas';
import { nextSheetNumber } from '@/worker/services/dailySheets';
import {
  RESET_CONFIRM_ERROR,
  RESET_REQUEST_MESSAGE,
  RECOVERY_CONFIRM_ERROR,
  confirmAdminRecovery,
  confirmEmployeeReset,
  recordPasswordResetRequest,
} from '@/worker/services/passwordRecovery';
import {
  activeLoginLock,
  clearLoginFailures,
  clientIp,
  failureRules,
  loginRateKeys,
  recoverySuccessKeys,
  registerLoginFailure,
  resetRequestRules,
  resetVerifyRules,
  type LoginLock,
} from '@/worker/utils/loginRateLimit';

export const authRoutes = new Hono<AppContextEnv>();

const UNIFIED_LOGIN_ERROR = 'اسم المستخدم أو كلمة المرور غير صحيحة';
let dummyPasswordHash: Promise<string> | null = null;

function dummyHash(): Promise<string> {
  dummyPasswordHash ??= hashPassword('timing-equalization-placeholder');
  return dummyPasswordHash;
}

function tooMany(lock: LoginLock) {
  return {
    body: {
      error: `تم تجاوز عدد محاولات الدخول المسموحة. يرجى المحاولة مرة أخرى بعد ${lock.minutes} دقيقة.`,
      code: 'RATE_LIMITED',
    },
    retryAfter: String(lock.retryAfterSeconds),
  };
}

authRoutes.post('/login', async (c) => {
  const parsed = await readJson(c, loginSchema);
  if (!parsed.ok) return c.json({ error: UNIFIED_LOGIN_ERROR }, 401);

  const username = parsed.data.username.trim().toLowerCase();
  const password = parsed.data.password;
  const keys = loginRateKeys(clientIp((name) => c.req.header(name)), username);
  const watched = [keys.ipUser, keys.ip, keys.user];
  const db = c.get('db');
  const blocked = await activeLoginLock(db, watched);
  if (blocked) {
    const limited = tooMany(blocked);
    return c.json(limited.body, 429, { 'Retry-After': limited.retryAfter });
  }

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
    : await verifyPassword(password, await dummyHash());

  if (!userRow || !passwordOk || !userRow.isActive) {
    const lock = await registerLoginFailure(db, failureRules(keys));
    if (lock) {
      const limited = tooMany(lock);
      return c.json(limited.body, 429, { 'Retry-After': limited.retryAfter });
    }
    return c.json({ error: UNIFIED_LOGIN_ERROR }, 401);
  }

  await clearLoginFailures(db, [keys.ipUser, keys.user]);
  const userDto = mapUserRowToDTO(userRow);
  const token = await signUserToken(c, { ...userDto, tokenVersion: userRow.tokenVersion });
  setAuthCookie(c, token);
  return c.json({
    user: userDto,
    nextSheetNumber: await nextSheetNumber(db),
  });
});

authRoutes.post('/password-reset/request', async (c) => {
  const parsed = await readJson(c, passwordResetRequestSchema);
  if (!parsed.ok) return c.json({ message: RESET_REQUEST_MESSAGE });
  const username = parsed.data.username.trim().toLowerCase();
  const ip = clientIp((name) => c.req.header(name));
  const db = c.get('db');
  const rules = resetRequestRules(ip, username);
  const blocked = await activeLoginLock(db, rules.map((item) => item.key));
  if (blocked) {
    const limited = tooMany(blocked);
    return c.json(limited.body, 429, { 'Retry-After': limited.retryAfter });
  }
  const lock = await registerLoginFailure(db, rules);
  if (lock) {
    const limited = tooMany(lock);
    return c.json(limited.body, 429, { 'Retry-After': limited.retryAfter });
  }
  await recordPasswordResetRequest(db, username);
  return c.json({ message: RESET_REQUEST_MESSAGE });
});

authRoutes.post('/password-reset/confirm', async (c) => {
  const parsed = await readJson(c, passwordResetConfirmSchema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const username = parsed.data.username.trim().toLowerCase();
  const ip = clientIp((name) => c.req.header(name));
  const db = c.get('db');
  const rules = resetVerifyRules(ip, username);
  const blocked = await activeLoginLock(db, rules.map((item) => item.key));
  if (blocked) {
    const limited = tooMany(blocked);
    return c.json(limited.body, 429, { 'Retry-After': limited.retryAfter });
  }
  const invalidMessage = parsed.data.mode === 'admin_recovery' ? RECOVERY_CONFIRM_ERROR : RESET_CONFIRM_ERROR;
  let secret: string;
  try {
    secret = resolveJwtSecret(c);
  } catch (error) {
    throw error;
  }
  const accepted = parsed.data.mode === 'admin_recovery'
    ? await confirmAdminRecovery(db, secret, username, normalizeRecoveryCode(parsed.data.code), parsed.data.newPassword, Date.now(), ip)
    : await confirmEmployeeReset(db, secret, username, normalizeRecoveryCode(parsed.data.code), parsed.data.newPassword, Date.now(), ip);
  if (!accepted) {
    const lock = await registerLoginFailure(db, rules);
    if (lock) {
      const limited = tooMany(lock);
      return c.json(limited.body, 429, { 'Retry-After': limited.retryAfter });
    }
    return c.json({ error: invalidMessage }, 400);
  }
  await clearLoginFailures(db, recoverySuccessKeys(ip, username));
  return c.json({ ok: true, message: 'تم تعيين كلمة المرور الجديدة بنجاح؛ يمكنك تسجيل الدخول الآن' });
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
