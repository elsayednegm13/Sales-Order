import { PERMISSION_GROUPS } from '@/shared/permissions';

export const AUDIT_MODULES = ['dailySheets', 'orders', 'catalog', 'customers', 'users', 'auth', 'settings'] as const;
export type AuditModule = (typeof AUDIT_MODULES)[number];

export const AUDIT_MODULE_LABELS: Record<string, string> = {
  dailySheets: 'أوردرات اليوم',
  orders: 'الطلبات',
  catalog: 'الكتالوج',
  customers: 'العملاء والتجار',
  users: 'المستخدمون',
  auth: 'الدخول والاستعادة',
  settings: 'الإعدادات',
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  close: 'إغلاق الشيت',
  reopen: 'إعادة فتح الشيت',
  archive: 'أرشفة الشيت',
  unarchive: 'إخراج الشيت من الأرشيف',
  delete_sheet: 'حذف الشيت',
  cancel: 'إلغاء الطلب',
  restore: 'استرجاع الطلب',
  delete_order: 'حذف الطلب',
  bulk_import: 'استيراد Excel',
  delete_product: 'حذف صنف',
  delete_customer: 'حذف عميل',
  delete_sub_merchant: 'حذف تاجر فرعي',
  create_user: 'إنشاء مستخدم',
  update_user: 'تعديل مستخدم',
  delete_user: 'حذف مستخدم',
  issue_reset_code: 'إصدار كود استعادة',
  revoke_reset_code: 'إلغاء كود استعادة',
  employee_reset: 'استعادة كلمة مرور موظف',
  admin_recovery: 'استعادة طوارئ المدير',
  generate_recovery_codes: 'توليد رموز الطوارئ',
  update_settings: 'تعديل الإعدادات',
  upload_branding: 'رفع الشعار أو الأيقونة',
};

export interface AuditActorOption {
  id: number | null;
  username: string;
  fullName: string;
}

export interface AuditPermissionChange {
  key: string;
  from: boolean;
  to: boolean;
}

export interface AuditLogEntry {
  id: number;
  createdAt: number;
  actorUserId: number | null;
  actorUsername: string;
  actorFullName: string;
  module: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  summary: string;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
}

export interface AuditLogResponse {
  logs: AuditLogEntry[];
  page: number;
  pageSize: number;
  total: number;
  truncated: boolean;
  actors: AuditActorOption[];
}

export function auditModuleLabel(module: string): string {
  return AUDIT_MODULE_LABELS[module] ?? module;
}

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function permissionKeyLabel(key: string): string {
  const [groupKey, subKey] = key.split('.');
  const group = PERMISSION_GROUPS.find((item) => item.key === groupKey);
  const match = group?.items.find((item) => item.subKey === subKey);
  if (match) return match.label;
  if (key === 'orders.view') return 'عرض الطلبات';
  return key;
}

const STATUS_LABELS: Record<string, string> = {
  open: 'مفتوح',
  closed: 'مغلق',
  archived: 'مؤرشف',
  admin: 'مدير النظام',
  operator: 'مسؤول تشغيل ومبيعات',
  viewer: 'مُطّلع وتقارير',
};

function labelValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'نشط' : 'موقوف';
  if (typeof value === 'string') return STATUS_LABELS[value] ?? value;
  if (typeof value === 'number') return String(value);
  return '';
}

export function describeAuditDetails(details: Record<string, unknown> | null): string[] {
  if (!details) return [];
  const lines: string[] = [];
  const diff = Array.isArray(details.permissionsDiff) ? details.permissionsDiff as AuditPermissionChange[] : [];
  for (const change of diff) {
    if (!change || typeof change.key !== 'string') continue;
    const name = permissionKeyLabel(change.key);
    lines.push(change.to ? `${name}: مسحوبة ← ممنوحة` : `${name}: ممنوحة ← مسحوبة`);
  }
  if (details.role && typeof details.role === 'object') {
    const role = details.role as { from?: unknown; to?: unknown };
    lines.push(`الدور: ${labelValue(role.from)} ← ${labelValue(role.to)}`);
  }
  if (details.isActive && typeof details.isActive === 'object') {
    const state = details.isActive as { from?: unknown; to?: unknown };
    lines.push(`حالة الحساب: ${labelValue(state.from)} ← ${labelValue(state.to)}`);
  }
  if (details.passwordChanged === true) lines.push('تم تغيير كلمة المرور');
  if (typeof details.created === 'number' || typeof details.updated === 'number') {
    lines.push(`أُنشئ ${Number(details.created ?? 0)} · حُدّث ${Number(details.updated ?? 0)} · أخطاء ${Number(details.errorCount ?? 0)}`);
  }
  if (typeof details.count === 'number') lines.push(`العدد: ${details.count}`);
  if (typeof details.companyName === 'object' && details.companyName) {
    const name = details.companyName as { from?: unknown; to?: unknown };
    lines.push(`اسم الشركة: ${labelValue(name.from)} ← ${labelValue(name.to)}`);
  }
  if (typeof details.startingOrderNumber === 'object' && details.startingOrderNumber) {
    const number = details.startingOrderNumber as { from?: unknown; to?: unknown };
    lines.push(`رقم البداية: ${labelValue(number.from)} ← ${labelValue(number.to)}`);
  }
  if (details.logoChanged === true) lines.push('تغيّر الشعار');
  if (details.faviconChanged === true) lines.push('تغيّرت الأيقونة');
  if (typeof details.brandingType === 'string') {
    lines.push(details.brandingType === 'logo' ? 'رُفع شعار الشركة' : 'رُفعت أيقونة المتصفح');
  }
  if (details.fromStatus || details.toStatus) {
    lines.push(`الحالة: ${labelValue(details.fromStatus)} ← ${labelValue(details.toStatus)}`);
  }
  return lines;
}

export function formatCairoDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function cairoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function cairoMonth(): string {
  return cairoToday().slice(0, 7);
}

export function monthBounds(month: string): { from: string; to: string } {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const last = new Date(year, monthNumber, 0).getDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, '0')}`,
  };
}
