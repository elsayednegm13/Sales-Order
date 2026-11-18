import { Hono } from 'hono';
import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { users } from '@/db/schema';
import {
  getDefaultPermissionsForRole,
  parseUserPermissions,
} from '@/shared/permissions';
import type { UserRole } from '@/shared/types';
import type { AppContextEnv } from '@/worker/types';
import { mapUserRowToDTO, requireAdmin, requireAuth, safeUserColumns } from '@/worker/middleware/auth';
import { hashPassword } from '@/worker/utils/crypto';
import { setAuthCookie, signUserToken } from '@/worker/utils/jwt';
import { createUserSchema, readJson, updateUserSchema } from '@/worker/schemas';

export const usersRoutes = new Hono<AppContextEnv>();

const USERNAME_REGEX = /^[a-z0-9._-]{3,40}$/;

usersRoutes.use('*', requireAuth, requireAdmin);

usersRoutes.get('/', async (c) => {
  const db = c.get('db');
  const rows = await db.select(safeUserColumns).from(users).orderBy(asc(users.id)).all();
  return c.json({
    users: rows.map(mapUserRowToDTO),
  });
});

usersRoutes.post('/', async (c) => {
  const parsed = await readJson(c, createUserSchema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const username = body.username.trim().toLowerCase();
  if (!USERNAME_REGEX.test(username)) {
    return c.json(
      {
        error:
          'اسم المستخدم يجب أن يتكون من 3 إلى 40 حرفاً إنجليزياً أو أرقاماً (a-z, 0-9, . _ -)',
      },
      400
    );
  }

  const password = body.password;
  const fullName = body.fullName.trim();
  const role: UserRole = body.role;
  const isActive = body.isActive !== undefined ? Boolean(body.isActive) : true;

  const normalizedPermissions =
    role === 'admin'
      ? getDefaultPermissionsForRole('admin')
      : parseUserPermissions(
          body.permissions ? JSON.stringify(body.permissions) : null,
          role
        );

  const db = c.get('db');
  const duplicate = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .get();

  if (duplicate) {
    return c.json({ error: 'اسم المستخدم مسجل مسبقاً لمستخدم آخر' }, 409);
  }

  const passwordHash = await hashPassword(password);

  const inserted = await db
    .insert(users)
    .values({
      username,
      passwordHash,
      fullName,
      role,
      permissions: JSON.stringify(normalizedPermissions),
      isActive,
    })
    .returning(safeUserColumns)
    .get();

  return c.json({ user: mapUserRowToDTO(inserted) }, 201);
});

usersRoutes.put('/:id', async (c) => {
  const targetId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(targetId)) {
    return c.json({ error: 'معرّف المستخدم غير صالح' }, 400);
  }

  const parsed = await readJson(c, updateUserSchema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const db = c.get('db');
  const existing = await db
    .select(safeUserColumns)
    .from(users)
    .where(eq(users.id, targetId))
    .get();

  if (!existing) {
    return c.json({ error: 'المستخدم غير موجود' }, 404);
  }

  const currentUser = c.get('user');

  const nextUsername =
    body.username !== undefined ? body.username.trim().toLowerCase() : existing.username;
  if (!USERNAME_REGEX.test(nextUsername)) {
    return c.json(
      {
        error:
          'اسم المستخدم يجب أن يتكون من 3 إلى 40 حرفاً إنجليزياً أو أرقاماً (a-z, 0-9, . _ -)',
      },
      400
    );
  }

  if (nextUsername !== existing.username) {
    const duplicate = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, nextUsername), ne(users.id, targetId)))
      .get();
    if (duplicate) {
      return c.json({ error: 'اسم المستخدم مسجل مسبقاً لمستخدم آخر' }, 409);
    }
  }

  const nextFullName = body.fullName !== undefined ? body.fullName.trim() : existing.fullName;
  if (nextFullName.length < 2 || nextFullName.length > 100) {
    return c.json({ error: 'يرجى إدخال الاسم الكامل بشكل صحيح' }, 400);
  }

  const nextRole: UserRole = body.role !== undefined ? body.role : existing.role;
  const nextIsActive =
    body.isActive !== undefined ? Boolean(body.isActive) : existing.isActive;

  // Prevent locking out current admin session
  if (targetId === currentUser.id) {
    if (!nextIsActive) {
      return c.json({ error: 'لا يمكنك إيقاف حسابك الحالي أثناء تسجيل الدخول' }, 400);
    }
    if (nextRole !== 'admin') {
      return c.json({ error: 'لا يمكنك خفض صلاحية حسابك الحالي من مدير النظام' }, 400);
    }
  }

  // Prevent removing or deactivating the last active admin
  if (existing.role === 'admin' && existing.isActive && (nextRole !== 'admin' || !nextIsActive)) {
    const otherActiveAdmins = await db
      .select({ total: count() })
      .from(users)
      .where(
        and(
          eq(users.role, 'admin'),
          eq(users.isActive, true),
          ne(users.id, targetId)
        )
      )
      .get();

    if (!otherActiveAdmins || otherActiveAdmins.total === 0) {
      return c.json(
        { error: 'يجب الإبقاء على مدير نظام نشط واحد على الأقل' },
        400
      );
    }
  }

  const passwordChanged = body.password !== undefined;
  const deactivated = existing.isActive && !nextIsActive;
  let nextPasswordHash: string | undefined;
  if (passwordChanged && body.password) {
    nextPasswordHash = await hashPassword(body.password);
  }

  const nextPermissions =
    nextRole === 'admin'
      ? getDefaultPermissionsForRole('admin')
      : body.permissions
        ? parseUserPermissions(JSON.stringify(body.permissions), nextRole)
        : parseUserPermissions(existing.permissions, nextRole);

  const revokeSessions = passwordChanged || deactivated;
  const updated = await db
    .update(users)
    .set({
      username: nextUsername,
      fullName: nextFullName,
      ...(nextPasswordHash ? { passwordHash: nextPasswordHash } : {}),
      role: nextRole,
      permissions: JSON.stringify(nextPermissions),
      isActive: nextIsActive,
      ...(revokeSessions ? { tokenVersion: sql`${users.tokenVersion} + 1` } : {}),
    })
    .where(eq(users.id, targetId))
    .returning(safeUserColumns)
    .get();

  if (revokeSessions && currentUser.id === targetId && updated.isActive) {
    const token = await signUserToken(c, { ...mapUserRowToDTO(updated), tokenVersion: updated.tokenVersion });
    setAuthCookie(c, token);
  }

  return c.json({ user: mapUserRowToDTO(updated) });
});

usersRoutes.delete('/:id', async (c) => {
  const targetId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(targetId)) {
    return c.json({ error: 'معرّف المستخدم غير صالح' }, 400);
  }

  const currentUser = c.get('user');
  if (targetId === currentUser.id) {
    return c.json({ error: 'لا يمكنك حذف حسابك الشخصي الحالي' }, 400);
  }

  const db = c.get('db');
  const existing = await db
    .select({ id: users.id, role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, targetId))
    .get();

  if (!existing) {
    return c.json({ error: 'المستخدم غير موجود' }, 404);
  }

  if (existing.role === 'admin' && existing.isActive) {
    const otherActiveAdmins = await db
      .select({ total: count() })
      .from(users)
      .where(
        and(
          eq(users.role, 'admin'),
          eq(users.isActive, true),
          ne(users.id, targetId)
        )
      )
      .get();

    if (!otherActiveAdmins || otherActiveAdmins.total === 0) {
      return c.json(
        { error: 'لا يمكن حذف آخر مدير نظام نشط في المنصة' },
        400
      );
    }
  }

  await db.delete(users).where(eq(users.id, targetId));
  return c.json({ ok: true, deletedId: targetId });
});
