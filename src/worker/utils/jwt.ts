import type { Context } from 'hono';
import { sign, verify } from 'hono/jwt';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppContextEnv, AuthJwtPayload } from '@/worker/types';
import type { UserDTO } from '@/shared/types';

export const AUTH_COOKIE_NAME = 'sales_order_session';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
const MIN_SECRET_LENGTH = 32;

export class ServerConfigError extends Error {
  readonly code = 'SERVER_CONFIG';

  constructor(message: string) {
    super(message);
    this.name = 'ServerConfigError';
  }
}

function resolveJwtSecret(c: Context<AppContextEnv>): string {
  const configured = c.env.JWT_SECRET?.trim() ?? '';
  if (configured.length < MIN_SECRET_LENGTH) {
    const where = c.env.APP_ENV === 'production' ? 'الإنتاج' : 'بيئة التطوير (.dev.vars)';
    throw new ServerConfigError(
      `إعداد الخادم ناقص: JWT_SECRET يجب أن يكون ${MIN_SECRET_LENGTH} حرفاً على الأقل في ${where}`
    );
  }
  return configured;
}

export async function signUserToken(
  c: Context<AppContextEnv>,
  user: Pick<UserDTO, 'id' | 'username' | 'role'> & { tokenVersion: number }
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthJwtPayload = {
    sub: String(user.id),
    username: user.username,
    role: user.role,
    tv: user.tokenVersion,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  return sign(payload, resolveJwtSecret(c), 'HS256');
}

export async function verifyUserToken(
  c: Context<AppContextEnv>,
  token: string
): Promise<AuthJwtPayload | null> {
  try {
    const verified = await verify(token, resolveJwtSecret(c), 'HS256');
    if (!verified || typeof verified.sub !== 'string' || typeof verified.tv !== 'number') {
      return null;
    }
    return verified as AuthJwtPayload;
  } catch (error) {
    if (error instanceof ServerConfigError) throw error;
    return null;
  }
}

export function extractAuthToken(c: Context<AppContextEnv>): string | null {
  const cookieToken = getCookie(c, AUTH_COOKIE_NAME);
  return cookieToken?.trim() || null;
}

export function setAuthCookie(c: Context<AppContextEnv>, token: string): void {
  const isSecure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: TOKEN_TTL_SECONDS,
  });
}

export function clearAuthCookie(c: Context<AppContextEnv>): void {
  const isSecure = new URL(c.req.url).protocol === 'https:';
  deleteCookie(c, AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'Lax',
    path: '/',
  });
}
