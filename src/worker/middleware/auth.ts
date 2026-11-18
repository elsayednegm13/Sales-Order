import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { users } from '@/db/schema';
import { parseUserPermissions } from '@/shared/permissions';
import type { UserDTO, UserPermissions } from '@/shared/types';
import type { AppContextEnv } from '@/worker/types';
import { clearAuthCookie, extractAuthToken, verifyUserToken } from '@/worker/utils/jwt';

export const safeUserColumns = {
  id: users.id,
  username: users.username,
  fullName: users.fullName,
  role: users.role,
  permissions: users.permissions,
  isActive: users.isActive,
  tokenVersion: users.tokenVersion,
  createdAt: users.createdAt,
};

export function mapUserRowToDTO(row: {
  id: number;
  username: string;
  fullName: string;
  role: UserDTO['role'];
  permissions: string;
  isActive: boolean;
  createdAt: string;
}): UserDTO {
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    role: row.role,
    permissions: parseUserPermissions(row.permissions, row.role),
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

export const requireAuth = createMiddleware<AppContextEnv>(async (c, next) => {
  const token = extractAuthToken(c);
  if (!token) {
    return c.json({ error: 'يرجى تسجيل الدخول للمتابعة', code: 'UNAUTHORIZED' }, 401);
  }

  const payload = await verifyUserToken(c, token);
  if (!payload) {
    clearAuthCookie(c);
    return c.json({ error: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً', code: 'INVALID_TOKEN' }, 401);
  }

  const userId = Number.parseInt(payload.sub, 10);
  if (!Number.isFinite(userId)) {
    clearAuthCookie(c);
    return c.json({ error: 'بيانات الجلسة غير صالحة', code: 'INVALID_SUB' }, 401);
  }

  const db = c.get('db');
  const userRow = await db
    .select(safeUserColumns)
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (!userRow || !userRow.isActive) {
    clearAuthCookie(c);
    return c.json(
      { error: 'تم إيقاف هذا الحساب أو لم يعد متاحاً', code: 'ACCOUNT_DISABLED' },
      401
    );
  }
  if (userRow.tokenVersion !== payload.tv) {
    clearAuthCookie(c);
    return c.json({ error: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً', code: 'SESSION_REVOKED' }, 401);
  }

  c.set('jwtPayload', payload);
  c.set('user', mapUserRowToDTO(userRow));
  await next();
});

export const requireAdmin = createMiddleware<AppContextEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user || user.role !== 'admin') {
    return c.json(
      { error: 'هذه الصفحة مخصصة لمدير النظام فقط', code: 'FORBIDDEN' },
      403
    );
  }
  await next();
});

export function requirePermission<K extends keyof UserPermissions>(
  section: K,
  action: keyof UserPermissions[K]
) {
  return createMiddleware<AppContextEnv>(async (c, next) => {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'يرجى تسجيل الدخول للمتابعة', code: 'UNAUTHORIZED' }, 401);
    }
    if (user.role === 'admin') {
      await next();
      return;
    }
    const allowed = Boolean(user.permissions[section]?.[action]);
    if (!allowed) {
      return c.json(
        { error: 'لا تملك الصلاحية الكافية لتنفيذ هذا الإجراء', code: 'FORBIDDEN' },
        403
      );
    }
    await next();
  });
}
