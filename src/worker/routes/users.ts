import { Hono } from 'hono';
import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { users } from '@/db/schema';
import { permissionsForSave } from '@/shared/permissions';
import { diffPermissions, effectivePermissions, recordAuditLog } from '@/worker/services/auditLog';
import { clientIp } from '@/worker/utils/loginRateLimit';
import type { UserRole } from '@/shared/types';
import type { AppContextEnv } from '@/worker/types';
import { mapUserRowToDTO, requireAdmin, requireAuth, safeUserColumns } from '@/worker/middleware/auth';
import { hashPassword, verifyPassword, generateUnambiguousCode } from '@/worker/utils/crypto';
import { resolveJwtSecret, setAuthCookie, signUserToken } from '@/worker/utils/jwt';
import { createUserSchema, isUniqueConstraintError, readJson, regenerateRecoveryCodesSchema, updateUserSchema } from '@/worker/schemas';
import {
  issueEmployeeResetCode,
  listActiveResetRequests,
  recoveryCodeStatus,
  replaceAdminRecoveryCodes,
  revokeResetRequests,
} from '@/worker/services/passwordRecovery';

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

usersRoutes.get('/reset-requests', async (c) => {
  const requests = await listActiveResetRequests(c.get('db'));
  return c.json({ requests });
});

usersRoutes.get('/recovery-codes', async (c) => {
  const status = await recoveryCodeStatus(c.get('db'), c.get('user').id);
  return c.json(status);
});

usersRoutes.post('/recovery-codes', async (c) => {
  const parsed = await readJson(c, regenerateRecoveryCodesSchema);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const currentUser = c.get('user');
  const db = c.get('db');
  const admin = await db
    .select({ id: users.id, passwordHash: users.passwordHash, username: users.username, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, currentUser.id))
    .get();
  if (!admin?.isActive || !(await verifyPassword(parsed.data.currentPassword, admin.passwordHash))) {
    return c.json({ error: 'كلمة المرور الحالية غير صحيحة', code: 'INVALID_CURRENT_PASSWORD' }, 401);
  }
  const codes = Array.from({ length: 8 }, () => generateUnambiguousCode(3, 4));
  const generatedAt = Date.now();
  await replaceAdminRecoveryCodes(db, resolveJwtSecret(c), admin.id, codes, generatedAt);
  await recordAuditLog(db, {
    actorUserId: currentUser.id,
    actorUsername: currentUser.username,
    actorFullName: currentUser.fullName,
    module: 'users',
    action: 'generate_recovery_codes',
    entityType: 'user',
    entityId: admin.id,
    entityLabel: admin.username,
    summary: `توليد 8 رموز طوارئ لحساب ${admin.username}`,
    details: { count: 8 },
    ipAddress: clientIp((name) => c.req.header(name)),
  });
  return c.json({ codes, totalCount: 8, remainingCount: 8, generatedAt });
});

usersRoutes.post('/:id/reset-code', async (c) => {
  const targetId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(targetId)) return c.json({ error: 'معرّف المستخدم غير صالح' }, 400);
  const currentUser = c.get('user');
  if (targetId === currentUser.id) {
    return c.json({ error: 'استخدم رموز الطوارئ لاستعادة حساب المدير الحالي' }, 400);
  }
  const db = c.get('db');
  const target = await db
    .select({ id: users.id, username: users.username, fullName: users.fullName, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, targetId))
    .get();
  if (!target || !target.isActive) {
    return c.json({ error: 'لا يمكن إصدار كود استعادة إلا لحساب نشط' }, 400);
  }
  const code = generateUnambiguousCode(2, 4);
  const expiresAt = Date.now() + 30 * 60 * 1000;
  await issueEmployeeResetCode(db, resolveJwtSecret(c), target.id, currentUser.id, code);
  await recordAuditLog(db, {
    actorUserId: currentUser.id,
    actorUsername: currentUser.username,
    actorFullName: currentUser.fullName,
    module: 'users',
    action: 'issue_reset_code',
    entityType: 'user',
    entityId: target.id,
    entityLabel: target.fullName,
    summary: `إصدار كود استعادة لحساب ${target.username}`,
    details: { expiresInMinutes: 30 },
    ipAddress: clientIp((name) => c.req.header(name)),
  });
  return c.json({
    code,
    expiresAt,
    expiresInMinutes: 30,
    username: target.username,
    fullName: target.fullName,
  });
});

usersRoutes.delete('/:id/reset-code', async (c) => {
  const targetId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(targetId)) return c.json({ error: 'معرّف المستخدم غير صالح' }, 400);
  const db = c.get('db');
  const target = await db
    .select({ id: users.id, username: users.username, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, targetId))
    .get();
  await revokeResetRequests(db, targetId);
  const currentUser = c.get('user');
  await recordAuditLog(db, {
    actorUserId: currentUser.id,
    actorUsername: currentUser.username,
    actorFullName: currentUser.fullName,
    module: 'users',
    action: 'revoke_reset_code',
    entityType: 'user',
    entityId: targetId,
    entityLabel: target?.fullName ?? String(targetId),
    summary: `إلغاء طلب استعادة لحساب ${target?.username ?? targetId}`,
    ipAddress: clientIp((name) => c.req.header(name)),
  });
  return c.json({ ok: true });
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

  const normalizedPermissions = permissionsForSave(role, body.permissions);
  if (role !== 'admin') {
    normalizedPermissions.users.manage = false;
    normalizedPermissions.settings.manage = false;
  }

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

  try {
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

    const currentUser = c.get('user');
    await recordAuditLog(db, {
      actorUserId: currentUser.id,
      actorUsername: currentUser.username,
      actorFullName: currentUser.fullName,
      module: 'users',
      action: 'create_user',
      entityType: 'user',
      entityId: inserted.id,
      entityLabel: inserted.fullName,
      summary: `إنشاء حساب ${inserted.username} بدور ${inserted.role}`,
      details: { role: inserted.role, isActive: inserted.isActive },
      ipAddress: clientIp((name) => c.req.header(name)),
    });
    return c.json({ user: mapUserRowToDTO(inserted) }, 201);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json({ error: 'اسم المستخدم مسجل مسبقاً لمستخدم آخر' }, 409);
    }
    throw error;
  }
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

  const nextPermissions = permissionsForSave(nextRole, body.permissions ?? existing.permissions);
  if (nextRole !== 'admin') {
    nextPermissions.users.manage = false;
    nextPermissions.settings.manage = false;
  }

  const revokeSessions = passwordChanged || deactivated;
  let updated;
  try {
    updated = await db
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
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json({ error: 'اسم المستخدم مسجل مسبقاً لمستخدم آخر' }, 409);
    }
    throw error;
  }

  if (revokeSessions && currentUser.id === targetId && updated.isActive) {
    const token = await signUserToken(c, { ...mapUserRowToDTO(updated), tokenVersion: updated.tokenVersion });
    setAuthCookie(c, token);
  }

  const permissionsDiff = diffPermissions(effectivePermissions(existing.permissions, existing.role), nextPermissions);
  const passwordWasChanged = Boolean(nextPasswordHash);
  const roleChanged = existing.role !== nextRole;
  const activeChanged = existing.isActive !== nextIsActive;
  if (permissionsDiff.length > 0 || passwordWasChanged || roleChanged || activeChanged) {
    const pieces = [
      roleChanged ? 'الدور' : '',
      permissionsDiff.length > 0 ? 'الصلاحيات' : '',
      activeChanged ? 'حالة الحساب' : '',
      passwordWasChanged ? 'كلمة المرور' : '',
    ].filter(Boolean);
    await recordAuditLog(db, {
      actorUserId: currentUser.id,
      actorUsername: currentUser.username,
      actorFullName: currentUser.fullName,
      module: 'users',
      action: 'update_user',
      entityType: 'user',
      entityId: updated.id,
      entityLabel: updated.fullName,
      summary: `تعديل ${pieces.join(' و')} لحساب ${updated.username}`,
      details: {
        ...(roleChanged ? { role: { from: existing.role, to: nextRole } } : {}),
        ...(activeChanged ? { isActive: { from: existing.isActive, to: nextIsActive } } : {}),
        ...(passwordWasChanged ? { passwordChanged: true } : {}),
        ...(permissionsDiff.length > 0 ? { permissionsDiff } : {}),
      },
      ipAddress: clientIp((name) => c.req.header(name)),
    });
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
    .select({ id: users.id, username: users.username, fullName: users.fullName, role: users.role, isActive: users.isActive })
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
  await recordAuditLog(db, {
    actorUserId: currentUser.id,
    actorUsername: currentUser.username,
    actorFullName: currentUser.fullName,
    module: 'users',
    action: 'delete_user',
    entityType: 'user',
    entityId: targetId,
    entityLabel: existing.fullName,
    summary: `حذف حساب ${existing.username}`,
    ipAddress: clientIp((name) => c.req.header(name)),
  });
  return c.json({ ok: true, deletedId: targetId });
});
