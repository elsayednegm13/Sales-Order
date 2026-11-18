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
        dailySheets: { view: true, create: true, edit: true, archive: true },
        orders: { view: true, create: true, edit: true, delete: true },
        catalog: { view: true, manage: true },
        customers: { view: true, manage: true },
        reports: { view: true, exportExcel: true, exportPdf: true },
        users: { manage: true },
        settings: { manage: true },
      };
    case 'operator':
      return {
        dailySheets: { view: true, create: true, edit: true, archive: false },
        orders: { view: true, create: true, edit: true, delete: true },
        catalog: { view: true, manage: true },
        customers: { view: true, manage: true },
        reports: { view: true, exportExcel: true, exportPdf: true },
        users: { manage: false },
        settings: { manage: false },
      };
    case 'viewer':
      return {
        dailySheets: { view: true, create: false, edit: false, archive: false },
        orders: { view: true, create: false, edit: false, delete: false },
        catalog: { view: true, manage: false },
        customers: { view: true, manage: false },
        reports: { view: true, exportExcel: true, exportPdf: true },
        users: { manage: false },
        settings: { manage: false },
      };
  }
}

export function parseUserPermissions(rawJson: string | null | undefined, role: UserRole): UserPermissions {
  const defaults = getDefaultPermissionsForRole(role);
  if (role === 'admin') {
    return defaults;
  }
  if (!rawJson) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(rawJson) as Partial<UserPermissions>;
    return {
      dailySheets: { ...defaults.dailySheets, ...(parsed.dailySheets ?? {}) },
      orders: { ...defaults.orders, ...(parsed.orders ?? {}) },
      catalog: { ...defaults.catalog, ...(parsed.catalog ?? {}) },
      customers: { ...defaults.customers, ...(parsed.customers ?? {}) },
      reports: { ...defaults.reports, ...(parsed.reports ?? {}) },
      users: { ...defaults.users, ...(parsed.users ?? {}) },
      settings: { ...defaults.settings, ...(parsed.settings ?? {}) },
    };
  } catch {
    return defaults;
  }
}

export interface PermissionGroupDefinition {
  key: keyof UserPermissions;
  title: string;
  items: {
    subKey: string;
    label: string;
  }[];
}

export const PERMISSION_GROUPS_AR: PermissionGroupDefinition[] = [
  {
    key: 'dailySheets',
    title: 'أوردرات اليوم (الشيت اليومي)',
    items: [
      { subKey: 'view', label: 'عرض الشيتات' },
      { subKey: 'create', label: 'فتح شيت جديد' },
      { subKey: 'edit', label: 'تعديل بيانات الشيت' },
      { subKey: 'archive', label: 'أرشفة وإغلاق الشيت' },
    ],
  },
  {
    key: 'orders',
    title: 'طلبات العملاء والأصناف',
    items: [
      { subKey: 'view', label: 'عرض الطلبات' },
      { subKey: 'create', label: 'إضافة طلب عميل' },
      { subKey: 'edit', label: 'تعديل واستبدال الأصناف' },
      { subKey: 'delete', label: 'حذف الطلبات' },
    ],
  },
  {
    key: 'catalog',
    title: 'كتالوج البطاطين والدفايات',
    items: [
      { subKey: 'view', label: 'استعراض الأصناف والأوزان' },
      { subKey: 'manage', label: 'إضافة وتعديل الأصناف والتعبئة' },
    ],
  },
  {
    key: 'customers',
    title: 'العملاء والتجار الفرعيون',
    items: [
      { subKey: 'view', label: 'عرض سجل العملاء' },
      { subKey: 'manage', label: 'إدارة العملاء والتجار الفرعيين' },
    ],
  },
  {
    key: 'reports',
    title: 'التقارير والتصدير',
    items: [
      { subKey: 'view', label: 'عرض التقارير التجميعية' },
      { subKey: 'exportExcel', label: 'تصدير ملفات Excel' },
      { subKey: 'exportPdf', label: 'طباعة وتصدير PDF' },
    ],
  },
  {
    key: 'users',
    title: 'المستخدمون والصلاحيات',
    items: [{ subKey: 'manage', label: 'إدارة حسابات المستخدمين' }],
  },
  {
    key: 'settings',
    title: 'إعدادات النظام والهوية',
    items: [{ subKey: 'manage', label: 'تعديل الهوية ورقم البداية' }],
  },
];
