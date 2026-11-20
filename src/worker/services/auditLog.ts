import type { AppDatabase } from '@/db';
import { auditLogs } from '@/db/schema';
import { PERMISSION_GROUPS, parseUserPermissions } from '@/shared/permissions';
import type { UserPermissions, UserRole } from '@/shared/types';

const FORBIDDEN_DETAIL_KEYS = new Set([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'code',
  'codes',
  'codeHash',
  'token',
]);

export interface PermissionChange {
  key: string;
  from: boolean;
  to: boolean;
}

export interface AuditEvent {
  actorUserId: number | null;
  actorUsername: string;
  actorFullName: string;
  module: string;
  action: string;
  entityType?: string | null;
  entityId?: string | number | null;
  entityLabel?: string | null;
  summary: string;
  details?: unknown;
  ipAddress?: string | null;
}

function sanitizeDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeDetails(item));
  if (!value || typeof value !== 'object') return value;
  const clean: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_DETAIL_KEYS.has(key)) continue;
    clean[key] = sanitizeDetails(nested);
  }
  return clean;
}

export async function recordAuditLog(db: AppDatabase, event: AuditEvent): Promise<void> {
  try {
    const details = event.details == null ? null : JSON.stringify(sanitizeDetails(event.details));
    await db.insert(auditLogs).values({
      createdAt: Date.now(),
      actorUserId: event.actorUserId,
      actorUsername: event.actorUsername.slice(0, 80),
      actorFullName: event.actorFullName.slice(0, 160),
      module: event.module.slice(0, 40),
      action: event.action.slice(0, 60),
      entityType: event.entityType ? event.entityType.slice(0, 40) : null,
      entityId: event.entityId == null ? null : String(event.entityId).slice(0, 40),
      entityLabel: event.entityLabel ? event.entityLabel.slice(0, 200) : null,
      summary: event.summary.slice(0, 500),
      detailsJson: details,
      ipAddress: event.ipAddress ? event.ipAddress.slice(0, 80) : null,
    });
  } catch (error) {
    console.error('audit log write failed', error instanceof Error ? error.message : 'unknown');
  }
}

function permissionEntries(permissions: UserPermissions): Array<[string, boolean]> {
  const entries: Array<[string, boolean]> = [];
  for (const group of PERMISSION_GROUPS) {
    const state = permissions[group.key] as Record<string, boolean>;
    for (const item of group.items) {
      entries.push([`${group.key}.${item.subKey}`, Boolean(state?.[item.subKey])]);
    }
  }
  entries.push(['orders.view', Boolean(permissions.orders.view)]);
  return entries;
}

export function diffPermissions(oldPerms: UserPermissions, newPerms: UserPermissions): PermissionChange[] {
  const next = new Map(permissionEntries(newPerms));
  const changes: PermissionChange[] = [];
  for (const [key, from] of permissionEntries(oldPerms)) {
    const to = Boolean(next.get(key));
    if (from !== to) changes.push({ key, from, to });
  }
  return changes;
}

export function effectivePermissions(rawJson: string | null | undefined, role: UserRole): UserPermissions {
  return parseUserPermissions(rawJson, role);
}

function cairoOffsetMs(utcMs: number): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(new Date(utcMs));
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const wall = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'));
  return wall - utcMs;
}

function cairoWallToEpoch(date: string, hour: number, minute: number, second: number, millisecond: number): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error('invalid cairo date');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const first = wall - cairoOffsetMs(wall);
  const secondGuess = wall - cairoOffsetMs(first);
  return secondGuess;
}

export function cairoRangeToEpoch(fromDate: string, toDate: string): { fromMs: number; toMs: number } {
  return {
    fromMs: cairoWallToEpoch(fromDate, 0, 0, 0, 0),
    toMs: cairoWallToEpoch(toDate, 23, 59, 59, 999),
  };
}
