import { and, desc, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';
import { adminRecoveryCodes, passwordResetRequests, users } from '@/db/schema';
import type { AppDatabase } from '@/db';
import { hashPassword, hashRecoveryCode, verifyRecoveryCodeHash } from '@/worker/utils/crypto';
import { recordAuditLog } from '@/worker/services/auditLog';

const RESET_TTL_MS = 30 * 60 * 1000;
const DUMMY_HASH = '0'.repeat(64);

export const RESET_REQUEST_MESSAGE = 'إذا كان الحساب مسجلاً ومفعّلاً، فقد تم تسجيل طلب الاستعادة لدى مدير النظام.';
export const RESET_CONFIRM_ERROR = 'بيانات الاستعادة غير صحيحة أو منتهية الصلاحية';
export const RECOVERY_CONFIRM_ERROR = 'بيانات الاستعادة غير صحيحة أو رمز الطوارئ مستخدم مسبقاً';

function d1(db: AppDatabase): D1Database {
  return (db as AppDatabase & { $client: D1Database }).$client;
}

export async function recordPasswordResetRequest(db: AppDatabase, username: string, now = Date.now()): Promise<void> {
  const user = await db
    .select({ id: users.id, role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.username, username))
    .get();
  if (!user || !user.isActive || user.role === 'admin') return;

  const pending = await db
    .select({ id: passwordResetRequests.id })
    .from(passwordResetRequests)
    .where(and(eq(passwordResetRequests.userId, user.id), eq(passwordResetRequests.status, 'pending')))
    .get();
  if (pending) {
    await db.update(passwordResetRequests).set({ requestedAt: now }).where(eq(passwordResetRequests.id, pending.id));
    return;
  }
  await db.insert(passwordResetRequests).values({
    userId: user.id,
    status: 'pending',
    requestedAt: now,
  });
}

async function consumeIssuedReset(db: AppDatabase, requestId: number, now: number): Promise<boolean> {
  const result = await d1(db).prepare(`
    UPDATE password_reset_requests
    SET status = 'used', used_at = ?1
    WHERE id = ?2 AND status = 'issued' AND used_at IS NULL AND expires_at > ?1
  `).bind(now, requestId).run();
  return (result.meta.changes ?? 0) === 1;
}

async function consumeRecoveryCode(db: AppDatabase, codeId: number, now: number): Promise<boolean> {
  const result = await d1(db).prepare(`
    UPDATE admin_recovery_codes
    SET used_at = ?1
    WHERE id = ?2 AND used_at IS NULL
  `).bind(now, codeId).run();
  return (result.meta.changes ?? 0) === 1;
}

async function replacePassword(db: AppDatabase, userId: number, passwordHash: string): Promise<void> {
  await d1(db).prepare(`
    UPDATE users
    SET password_hash = ?1, token_version = token_version + 1
    WHERE id = ?2 AND is_active = 1
  `).bind(passwordHash, userId).run();
}

export async function confirmEmployeeReset(
  db: AppDatabase,
  secret: string,
  username: string,
  normalizedCode: string,
  newPassword: string,
  now = Date.now(),
  ipAddress: string | null = null,
): Promise<boolean> {
  const user = await db
    .select({ id: users.id, username: users.username, fullName: users.fullName, isActive: users.isActive })
    .from(users)
    .where(eq(users.username, username))
    .get();
  const candidate = user
    ? await hashRecoveryCode(secret, `emp_reset:${user.id}`, normalizedCode)
    : await hashRecoveryCode(secret, 'emp_reset:0', normalizedCode);
  const request = user?.isActive
    ? await db
      .select()
      .from(passwordResetRequests)
      .where(and(
        eq(passwordResetRequests.userId, user.id),
        eq(passwordResetRequests.status, 'issued'),
        isNull(passwordResetRequests.usedAt),
        isNotNull(passwordResetRequests.codeHash),
        gt(passwordResetRequests.expiresAt, now),
      ))
      .orderBy(desc(passwordResetRequests.id))
      .get()
    : undefined;
  const matches = verifyRecoveryCodeHash(request?.codeHash ?? DUMMY_HASH, candidate);
  if (!user?.isActive || !request?.codeHash || !matches) return false;
  const consumed = await consumeIssuedReset(db, request.id, now);
  if (!consumed) return false;
  await replacePassword(db, user.id, await hashPassword(newPassword));
  await recordAuditLog(db, {
    actorUserId: user.id,
    actorUsername: user.username,
    actorFullName: user.fullName,
    module: 'auth',
    action: 'employee_reset',
    entityType: 'user',
    entityId: user.id,
    entityLabel: user.fullName,
    summary: `تعيين كلمة مرور جديدة لحساب الموظف ${user.username}`,
    ipAddress,
  });
  return true;
}

export async function confirmAdminRecovery(
  db: AppDatabase,
  secret: string,
  username: string,
  normalizedCode: string,
  newPassword: string,
  now = Date.now(),
  ipAddress: string | null = null,
): Promise<boolean> {
  const user = await db
    .select({ id: users.id, username: users.username, fullName: users.fullName, role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.username, username))
    .get();
  const activeAdmin = Boolean(user?.isActive && user.role === 'admin');
  const candidate = await hashRecoveryCode(secret, `admin_recovery:${activeAdmin && user ? user.id : 0}`, normalizedCode);
  const rows = activeAdmin && user
    ? await db
      .select({ id: adminRecoveryCodes.id, codeHash: adminRecoveryCodes.codeHash })
      .from(adminRecoveryCodes)
      .where(and(eq(adminRecoveryCodes.userId, user.id), isNull(adminRecoveryCodes.usedAt)))
    : [];
  let matchedId: number | null = null;
  if (rows.length === 0) {
    verifyRecoveryCodeHash(DUMMY_HASH, candidate);
  } else {
    for (const row of rows) {
      if (verifyRecoveryCodeHash(row.codeHash, candidate) && matchedId === null) matchedId = row.id;
    }
  }
  if (!activeAdmin || !user || matchedId === null) return false;
  const consumed = await consumeRecoveryCode(db, matchedId, now);
  if (!consumed) return false;
  await replacePassword(db, user.id, await hashPassword(newPassword));
  await recordAuditLog(db, {
    actorUserId: user.id,
    actorUsername: user.username,
    actorFullName: user.fullName,
    module: 'auth',
    action: 'admin_recovery',
    entityType: 'user',
    entityId: user.id,
    entityLabel: user.fullName,
    summary: `تعيين كلمة مرور جديدة بحساب المدير ${user.username} عبر رمز طوارئ`,
    ipAddress,
  });
  return true;
}

export async function listActiveResetRequests(db: AppDatabase, now = Date.now()) {
  const pending = await db
    .select({
      userId: passwordResetRequests.userId,
      status: passwordResetRequests.status,
      requestedAt: passwordResetRequests.requestedAt,
      expiresAt: passwordResetRequests.expiresAt,
    })
    .from(passwordResetRequests)
    .where(eq(passwordResetRequests.status, 'pending'))
    .orderBy(desc(passwordResetRequests.requestedAt));
  const issued = await db
    .select({
      userId: passwordResetRequests.userId,
      status: passwordResetRequests.status,
      requestedAt: passwordResetRequests.requestedAt,
      expiresAt: passwordResetRequests.expiresAt,
    })
    .from(passwordResetRequests)
    .where(and(
      eq(passwordResetRequests.status, 'issued'),
      isNull(passwordResetRequests.usedAt),
      gt(passwordResetRequests.expiresAt, now),
    ))
    .orderBy(desc(passwordResetRequests.requestedAt));
  return [...issued, ...pending];
}

export async function issueEmployeeResetCode(
  db: AppDatabase,
  secret: string,
  targetId: number,
  adminId: number,
  code: string,
  now = Date.now(),
): Promise<void> {
  const normalized = code.replace(/[\s-]+/g, '').toUpperCase();
  const codeHash = await hashRecoveryCode(secret, `emp_reset:${targetId}`, normalized);
  const client = d1(db);
  await client.batch([
    client.prepare(`
      UPDATE password_reset_requests
      SET status = 'revoked'
      WHERE user_id = ?1 AND status IN ('pending', 'issued')
    `).bind(targetId),
    client.prepare(`
      INSERT INTO password_reset_requests (user_id, code_hash, status, requested_at, expires_at, issued_by)
      VALUES (?1, ?2, 'issued', ?3, ?4, ?5)
    `).bind(targetId, codeHash, now, now + RESET_TTL_MS, adminId),
  ]);
}

export async function revokeResetRequests(db: AppDatabase, targetId: number): Promise<void> {
  await db
    .update(passwordResetRequests)
    .set({ status: 'revoked' })
    .where(and(
      eq(passwordResetRequests.userId, targetId),
      inArray(passwordResetRequests.status, ['pending', 'issued']),
    ));
}

export async function recoveryCodeStatus(db: AppDatabase, adminId: number) {
  const rows = await db
    .select({
      createdAt: adminRecoveryCodes.createdAt,
      usedAt: adminRecoveryCodes.usedAt,
    })
    .from(adminRecoveryCodes)
    .where(eq(adminRecoveryCodes.userId, adminId));
  const totalCount = rows.length;
  const usedCount = rows.filter((row) => row.usedAt !== null).length;
  const generatedAt = rows.reduce((latest, row) => Math.max(latest, row.createdAt), 0);
  return {
    totalCount,
    remainingCount: totalCount - usedCount,
    usedCount,
    generatedAt: generatedAt || null,
  };
}

export async function replaceAdminRecoveryCodes(
  db: AppDatabase,
  secret: string,
  adminId: number,
  codes: string[],
  now = Date.now(),
): Promise<void> {
  const batchId = crypto.randomUUID();
  const hashes = await Promise.all(codes.map((code) => {
    const normalized = code.replace(/[\s-]+/g, '').toUpperCase();
    return hashRecoveryCode(secret, `admin_recovery:${adminId}`, normalized);
  }));
  const client = d1(db);
  await client.batch([
    client.prepare('DELETE FROM admin_recovery_codes WHERE user_id = ?1').bind(adminId),
    ...hashes.map((codeHash) => client.prepare(`
      INSERT INTO admin_recovery_codes (user_id, code_hash, batch_id, created_at)
      VALUES (?1, ?2, ?3, ?4)
    `).bind(adminId, codeHash, batchId, now)),
  ]);
}
