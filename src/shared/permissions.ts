import type { UserPermissions, UserRole } from './types';

export const ROLE_LABELS_AR: Record<UserRole, string> = {
  admin: 'مدير النظام',
  operator: 'مسؤول تشغيل ومبيعات',
  viewer: 'مُطّلع وتقارير',
};

export const ROLE_DESCRIPTIONS_AR: Record<UserRole, string> = {
  admin: 'صلاحية كاملة لإدارة المستخدمين وإعدادات الهوية وأوامر التشغيل والكتالوج والتقارير.',
  operator: 'إدارة أوردرات اليوم وطلبات العملاء والأصناف والعملاء والتجار الفرعيين وتصدير الكشوف.',
  viewer: 'استعراض أوردرات اليوم والكتالوج والتقارير وتصدير ملفات Excel والطباعة دون تعديل البيانات.',
};

export function getDefaultPermissionsForRole(role: UserRole): UserPermissions {
  switch (role) {
    case 'admin':
      return {
        dailySheets: { view: true, create: true, edit: true, close: true, archive: true, delete: true },
        orders: { view: true, create: true, edit: true, fulfillment: true, cancel: true, delete: true },
        catalog: { view: true, manage: true, bulkImport: true, delete: true },
        customers: { view: true, manage: true, bulkImport: true, delete: true, deleteSubMerchant: true },
        reports: { view: true, exportExcel: true, exportPdf: true },
        users: { manage: true },
        settings: { manage: true },
      };
    case 'operator':
      return {
        dailySheets: { view: true, create: true, edit: true, close: false, archive: false, delete: false },
        orders: { view: true, create: true, edit: true, fulfillment: true, cancel: false, delete: false },
        catalog: { view: true, manage: true, bulkImport: false, delete: false },
        customers: { view: true, manage: true, bulkImport: false, delete: false, deleteSubMerchant: false },
        reports: { view: true, exportExcel: true, exportPdf: true },
        users: { manage: false },
        settings: { manage: false },
      };
    case 'viewer':
      return {
        dailySheets: { view: true, create: false, edit: false, close: false, archive: false, delete: false },
        orders: { view: true, create: false, edit: false, fulfillment: false, cancel: false, delete: false },
        catalog: { view: true, manage: false, bulkImport: false, delete: false },
        customers: { view: true, manage: false, bulkImport: false, delete: false, deleteSubMerchant: false },
        reports: { view: true, exportExcel: true, exportPdf: true },
        users: { manage: false },
        settings: { manage: false },
      };
  }
}

function hasOwn(record: object | undefined, key: string): boolean {
  return Boolean(record) && Object.prototype.hasOwnProperty.call(record, key);
}

function flag(record: object | undefined, key: string, fallback: boolean): boolean {
  if (!hasOwn(record, key)) return fallback;
  return Boolean((record as Record<string, unknown>)[key]);
}

export function parseUserPermissions(rawJson: string | null | undefined, role: UserRole): UserPermissions {
  const defaults = getDefaultPermissionsForRole(role);
  if (role === 'admin') return defaults;

  let parsed: Partial<UserPermissions> = {};
  if (rawJson) {
    try {
      const value = JSON.parse(rawJson) as Partial<UserPermissions> | null;
      if (value && typeof value === 'object') parsed = value;
    } catch {
      parsed = {};
    }
  }

  const sheet = parsed.dailySheets;
  const order = parsed.orders;
  const catalog = parsed.catalog;
  const customer = parsed.customers;
  const report = parsed.reports;
  const dailySheets = {
    view: flag(sheet, 'view', defaults.dailySheets.view),
    create: flag(sheet, 'create', defaults.dailySheets.create),
    edit: flag(sheet, 'edit', defaults.dailySheets.edit),
    close: flag(sheet, 'close', false),
    archive: flag(sheet, 'archive', false),
    delete: flag(sheet, 'delete', false),
  };
  const fulfillment = hasOwn(order, 'fulfillment')
    ? Boolean(order?.fulfillment)
    : typeof order?.edit === 'boolean'
      ? order.edit
      : defaults.orders.fulfillment;

  return {
    dailySheets,
    orders: {
      view: dailySheets.view,
      create: flag(order, 'create', defaults.orders.create),
      edit: flag(order, 'edit', defaults.orders.edit),
      fulfillment,
      cancel: flag(order, 'cancel', false),
      delete: flag(order, 'delete', false),
    },
    catalog: {
      view: flag(catalog, 'view', defaults.catalog.view),
      manage: flag(catalog, 'manage', defaults.catalog.manage),
      bulkImport: flag(catalog, 'bulkImport', false),
      delete: flag(catalog, 'delete', false),
    },
    customers: {
      view: flag(customer, 'view', defaults.customers.view),
      manage: flag(customer, 'manage', defaults.customers.manage),
      bulkImport: flag(customer, 'bulkImport', false),
      delete: flag(customer, 'delete', false),
      deleteSubMerchant: flag(customer, 'deleteSubMerchant', false),
    },
    reports: {
      view: flag(report, 'view', defaults.reports.view),
      exportExcel: flag(report, 'exportExcel', defaults.reports.exportExcel),
      exportPdf: flag(report, 'exportPdf', defaults.reports.exportPdf),
    },
    users: { manage: false },
    settings: { manage: false },
  };
}

export function permissionsForSave(role: UserRole, raw: unknown): UserPermissions {
  if (role === 'admin') return getDefaultPermissionsForRole('admin');
  const normalized = parseUserPermissions(typeof raw === 'string' ? raw : raw ? JSON.stringify(raw) : null, role);
  return {
    ...normalized,
    orders: { ...normalized.orders, view: normalized.dailySheets.view },
    users: { manage: false },
    settings: { manage: false },
  };
}

export interface PermissionItemDefinition {
  subKey: string;
  label: string;
  sensitive: boolean;
  adminOnly?: boolean;
}

export interface PermissionGroupDefinition {
  key: keyof UserPermissions;
  title: string;
  adminOnly?: boolean;
  items: PermissionItemDefinition[];
}

export const PERMISSION_GROUPS: PermissionGroupDefinition[] = [
  {
    key: 'dailySheets',
    title: 'أوردرات اليوم',
    items: [
      { subKey: 'view', label: 'عرض أوردرات اليوم وتفاصيل الطلبات', sensitive: false },
      { subKey: 'create', label: 'فتح شيت يومي', sensitive: false },
      { subKey: 'edit', label: 'تعديل بيانات الشيت', sensitive: false },
      { subKey: 'close', label: 'إغلاق الشيت وإعادة فتحه', sensitive: true },
      { subKey: 'archive', label: 'أرشفة الشيت وإخراجه من الأرشيف', sensitive: true },
      { subKey: 'delete', label: 'حذف الشيت نهائياً', sensitive: true },
    ],
  },
  {
    key: 'orders',
    title: 'طلبات العملاء',
    items: [
      { subKey: 'create', label: 'إنشاء وتكرار طلب', sensitive: false },
      { subKey: 'edit', label: 'تعديل أصناف وكميات الطلب', sensitive: false },
      { subKey: 'fulfillment', label: 'تسجيل التنفيذ (خروج / متبقي)', sensitive: false },
      { subKey: 'cancel', label: 'إلغاء الطلب واسترجاعه', sensitive: true },
      { subKey: 'delete', label: 'حذف الطلب نهائياً', sensitive: true },
    ],
  },
  {
    key: 'catalog',
    title: 'الكتالوج',
    items: [
      { subKey: 'view', label: 'عرض الكتالوج', sensitive: false },
      { subKey: 'manage', label: 'إضافة وتعديل الأصناف والتعبئة والأوزان', sensitive: true },
      { subKey: 'bulkImport', label: 'استيراد المنتجات من Excel', sensitive: true },
      { subKey: 'delete', label: 'حذف صنف', sensitive: true },
    ],
  },
  {
    key: 'customers',
    title: 'العملاء والتجار',
    items: [
      { subKey: 'view', label: 'عرض العملاء والتجار', sensitive: false },
      { subKey: 'manage', label: 'إضافة وتعديل عميل أو تاجر', sensitive: false },
      { subKey: 'bulkImport', label: 'استيراد العملاء من Excel', sensitive: true },
      { subKey: 'delete', label: 'حذف عميل', sensitive: true },
      { subKey: 'deleteSubMerchant', label: 'حذف تاجر فرعي', sensitive: true },
    ],
  },
  {
    key: 'reports',
    title: 'التقارير والتصدير',
    items: [
      { subKey: 'view', label: 'عرض التقارير والإجماليات', sensitive: false },
      { subKey: 'exportExcel', label: 'تصدير ملفات Excel', sensitive: true },
      { subKey: 'exportPdf', label: 'الطباعة وتصدير PDF', sensitive: true },
    ],
  },
  {
    key: 'users',
    title: 'الإدارة والنظام',
    adminOnly: true,
    items: [{ subKey: 'manage', label: 'إدارة حسابات المستخدمين', sensitive: true, adminOnly: true }],
  },
  {
    key: 'settings',
    title: 'الإدارة والنظام',
    adminOnly: true,
    items: [{ subKey: 'manage', label: 'تعديل الهوية ورقم البداية', sensitive: true, adminOnly: true }],
  },
];

export const PERMISSION_GROUPS_AR = PERMISSION_GROUPS;

export const SENSITIVE_PERMISSION_KEYS: string[] = PERMISSION_GROUPS.flatMap((group) =>
  group.items.filter((item) => item.sensitive).map((item) => `${group.key}.${item.subKey}`),
);

export function countPermissions(permissions: UserPermissions): { standard: number; sensitive: number } {
  let standard = 0;
  let sensitive = 0;
  for (const group of PERMISSION_GROUPS) {
    const groupState = permissions[group.key] as Record<string, boolean>;
    for (const item of group.items) {
      if (!groupState?.[item.subKey]) continue;
      if (item.sensitive) sensitive += 1;
      else standard += 1;
    }
  }
  return { standard, sensitive };
}

export function isCustomizedPermissions(role: UserRole, permissions: UserPermissions): boolean {
  if (role === 'admin') return false;
  const defaults = getDefaultPermissionsForRole(role);
  for (const group of PERMISSION_GROUPS) {
    const current = permissions[group.key] as Record<string, boolean>;
    const template = defaults[group.key] as Record<string, boolean>;
    for (const item of group.items) {
      if (Boolean(current?.[item.subKey]) !== Boolean(template?.[item.subKey])) return true;
    }
  }
  return false;
}

export function withSyncedOrderView(permissions: UserPermissions): UserPermissions {
  return {
    ...permissions,
    orders: { ...permissions.orders, view: permissions.dailySheets.view },
    users: permissions.users,
    settings: permissions.settings,
  };
}

export function applyStandardOnly(permissions: UserPermissions): UserPermissions {
  const next = structuredClone(permissions);
  for (const group of PERMISSION_GROUPS) {
    const groupState = next[group.key] as Record<string, boolean>;
    for (const item of group.items) {
      groupState[item.subKey] = item.sensitive || item.adminOnly ? false : true;
    }
  }
  next.orders.view = next.dailySheets.view;
  next.users.manage = false;
  next.settings.manage = false;
  return next;
}

export function clearSensitivePermissions(permissions: UserPermissions): UserPermissions {
  const next = structuredClone(permissions);
  for (const group of PERMISSION_GROUPS) {
    const groupState = next[group.key] as Record<string, boolean>;
    for (const item of group.items) {
      if (item.sensitive || item.adminOnly) groupState[item.subKey] = false;
    }
  }
  next.orders.view = next.dailySheets.view;
  next.users.manage = false;
  next.settings.manage = false;
  return next;
}
