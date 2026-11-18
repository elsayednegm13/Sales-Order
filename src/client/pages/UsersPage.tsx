import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Edit3,
  FileSpreadsheet,
  Loader2,
  Plus,
  Search,
  Shield,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
  X,
} from 'lucide-react';
import { api, ApiClientError } from '@/client/lib/api';
import { exportRowsToExcel } from '@/client/lib/export';
import { useExcelExport } from '@/client/lib/useExcelExport';
import { useAuth } from '@/client/contexts/AuthContext';
import { useToast } from '@/client/components/ui/Toast';
import {
  getDefaultPermissionsForRole,
  PERMISSION_GROUPS_AR,
  ROLE_DESCRIPTIONS_AR,
  ROLE_LABELS_AR,
} from '@/shared/permissions';
import type { UserDTO, UserPermissions, UserRole } from '@/shared/types';

interface UserFormState {
  username: string;
  fullName: string;
  password: string;
  role: UserRole;
  isActive: boolean;
  permissions: UserPermissions;
}

function countGrantedPermissions(perms: UserPermissions): number {
  let count = 0;
  for (const group of PERMISSION_GROUPS_AR) {
    const groupObj = perms[group.key] as Record<string, boolean>;
    for (const item of group.items) {
      if (groupObj?.[item.subKey]) {
        count += 1;
      }
    }
  }
  return count;
}

const TOTAL_PERMISSION_FLAGS = PERMISSION_GROUPS_AR.reduce(
  (acc, group) => acc + group.items.length,
  0
);

export function UsersPage() {
  const { user: currentUser, refreshUser } = useAuth();
  const { notify } = useToast();
  const { isExporting, runExport } = useExcelExport();

  const [usersList, setUsersList] = useState<UserDTO[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Slide-over drawer form state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserDTO | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<UserFormState>(() => ({
    username: '',
    fullName: '',
    password: '',
    role: 'operator',
    isActive: true,
    permissions: getDefaultPermissionsForRole('operator'),
  }));

  // Inline delete confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [busyRowId, setBusyRowId] = useState<number | null>(null);

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.users.list();
      setUsersList(res.users);
    } catch (err) {
      const msg =
        err instanceof ApiClientError ? err.message : 'تعذر تحميل قائمة المستخدمين';
      notify(msg, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return usersList.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (statusFilter === 'active' && !u.isActive) return false;
      if (statusFilter === 'inactive' && u.isActive) return false;
      if (!q) return true;
      return (
        u.fullName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q)
      );
    });
  }, [usersList, searchQuery, roleFilter, statusFilter]);

  const openCreateDrawer = () => {
    setEditingUser(null);
    setFormError(null);
    setForm({
      username: '',
      fullName: '',
      password: '',
      role: 'operator',
      isActive: true,
      permissions: getDefaultPermissionsForRole('operator'),
    });
    setDrawerOpen(true);
  };

  const openEditDrawer = (target: UserDTO) => {
    setEditingUser(target);
    setFormError(null);
    setForm({
      username: target.username,
      fullName: target.fullName,
      password: '',
      role: target.role,
      isActive: target.isActive,
      permissions: structuredClone(target.permissions),
    });
    setDrawerOpen(true);
  };

  const handleRoleChange = (nextRole: UserRole) => {
    setForm((prev) => ({
      ...prev,
      role: nextRole,
      permissions: getDefaultPermissionsForRole(nextRole),
    }));
  };

  const handleTogglePermission = (
    groupKey: keyof UserPermissions,
    subKey: string
  ) => {
    if (form.role === 'admin') return;
    setForm((prev) => {
      const currentGroup = prev.permissions[groupKey] as Record<string, boolean>;
      return {
        ...prev,
        permissions: {
          ...prev.permissions,
          [groupKey]: {
            ...currentGroup,
            [subKey]: !currentGroup[subKey],
          },
        },
      };
    });
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    setFormError(null);
    setIsSaving(true);
    try {
      if (editingUser) {
        const res = await api.users.update(editingUser.id, {
          username: form.username.trim().toLowerCase(),
          fullName: form.fullName.trim(),
          password: form.password ? form.password : undefined,
          role: form.role,
          isActive: form.isActive,
          permissions: form.permissions,
        });
        setUsersList((prev) =>
          prev.map((item) => (item.id === res.user.id ? res.user : item))
        );
        if (currentUser && res.user.id === currentUser.id) {
          await refreshUser();
        }
        notify('تم تحديث بيانات المستخدم وصلاحياته بنجاح');
      } else {
        const res = await api.users.create({
          username: form.username.trim().toLowerCase(),
          fullName: form.fullName.trim(),
          password: form.password,
          role: form.role,
          isActive: form.isActive,
          permissions: form.permissions,
        });
        setUsersList((prev) => [...prev, res.user]);
        notify('تم إنشاء حساب المستخدم بنجاح');
      }
      setDrawerOpen(false);
    } catch (err) {
      setFormError(
        err instanceof ApiClientError ? err.message : 'حدث خطأ أثناء حفظ بيانات المستخدم'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActiveQuick = async (target: UserDTO) => {
    if (busyRowId !== null) return;
    setBusyRowId(target.id);
    try {
      const res = await api.users.update(target.id, {
        isActive: !target.isActive,
      });
      setUsersList((prev) =>
        prev.map((u) => (u.id === res.user.id ? res.user : u))
      );
      notify(
        res.user.isActive
          ? `تم تفعيل حساب ${res.user.fullName}`
          : `تم إيقاف حساب ${res.user.fullName}`
      );
    } catch (err) {
      notify(
        err instanceof ApiClientError ? err.message : 'تعذر تغيير حالة الحساب',
        'error'
      );
    } finally {
      setBusyRowId(null);
    }
  };

  const handleDeleteUser = async (target: UserDTO) => {
    if (busyRowId !== null) return;
    setBusyRowId(target.id);
    try {
      await api.users.remove(target.id);
      setUsersList((prev) => prev.filter((u) => u.id !== target.id));
      setConfirmDeleteId(null);
      notify(`تم حذف حساب ${target.fullName}`);
    } catch (err) {
      notify(
        err instanceof ApiClientError ? err.message : 'تعذر حذف الحساب',
        'error'
      );
    } finally {
      setBusyRowId(null);
    }
  };

  const handleExportExcel = () => {
    void runExport(() => exportRowsToExcel({
      filename: 'المستخدمون.xlsx',
      sheetName: 'المستخدمون',
      rows: usersList,
      columns: [
        { header: 'الاسم', width: 28, accessor: (row) => row.fullName },
        { header: 'اسم المستخدم', width: 22, accessor: (row) => row.username },
        { header: 'الدور / الصلاحية', width: 24, accessor: (row) => ROLE_LABELS_AR[row.role] },
        { header: 'الحالة', width: 12, accessor: (row) => (row.isActive ? 'نشط' : 'موقوف') },
      ],
    }));
  };

  return (
    <div className="space-y-3">
      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-950">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">المستخدمون والصلاحيات</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">حسابات التشغيل ونطاق الصلاحيات</p>
        </div>
        <div className="inline-flex flex-wrap items-center overflow-hidden rounded-lg border border-slate-200 bg-white text-xs dark:border-slate-800 dark:bg-slate-900">
          <span className="tabular-nums px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200">إجمالي المستخدمين: {usersList.length.toLocaleString('en-US')}</span>
          <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <span className="tabular-nums px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200">النشطون: {usersList.filter((item) => item.isActive).length.toLocaleString('en-US')}</span>
          <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <span className="tabular-nums px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200">الموقوفون: {usersList.filter((item) => !item.isActive).length.toLocaleString('en-US')}</span>
        </div>
      </section>
      <div className="no-print sticky top-16 z-20 -mx-4 flex flex-col justify-between gap-2 border-y border-slate-200 bg-slate-50/95 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:flex-row lg:items-center lg:px-8 dark:border-slate-800 dark:bg-slate-950/95">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث بالاسم أو اسم المستخدم..."
              className="w-full rounded-xl border border-slate-300 bg-slate-50/60 py-2 pr-10 pl-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
            />
          </div>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'all' | UserRole)}
            aria-label="تصفية حسب الدور"
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="all">كل الأدوار الوظيفية</option>
            <option value="admin">مدير النظام</option>
            <option value="operator">مسؤول تشغيل ومبيعات</option>
            <option value="viewer">مُطّلع وتقارير</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')
            }
            aria-label="تصفية حسب الحالة"
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="all">كل الحالات</option>
            <option value="active">الحسابات النشطة</option>
            <option value="inactive">الحسابات الموقوفة</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={usersList.length === 0 || isExporting}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span>تصدير Excel</span>
          </button>

          <button
            type="button"
            onClick={openCreateDrawer}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-xs transition-colors hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            <Plus className="h-4 w-4" />
            <span>إضافة مستخدم</span>
          </button>
        </div>
      </div>

      {/* Users Data Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/90 text-xs font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-400">
                <th className="px-5 py-3.5">المستخدم</th>
                <th className="px-4 py-3.5">الدور الوظيفي</th>
                <th className="px-4 py-3.5">نطاق الصلاحيات</th>
                <th className="px-4 py-3.5">الحالة</th>
                <th className="px-4 py-3.5">تاريخ الإنشاء</th>
                <th className="no-print px-5 py-3.5 text-left">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
              {isLoading ? (
                Array.from({ length: 3 }).map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    <td className="px-5 py-4">
                      <div className="h-4 w-36 rounded bg-slate-200 dark:bg-slate-800" />
                      <div className="mt-1.5 h-3 w-24 rounded bg-slate-100 dark:bg-slate-800/60" />
                    </td>
                    <td className="px-4 py-4">
                      <div className="h-6 w-28 rounded-lg bg-slate-200 dark:bg-slate-800" />
                    </td>
                    <td className="px-4 py-4">
                      <div className="h-4 w-20 rounded bg-slate-200 dark:bg-slate-800" />
                    </td>
                    <td className="px-4 py-4">
                      <div className="h-6 w-16 rounded-full bg-slate-200 dark:bg-slate-800" />
                    </td>
                    <td className="px-4 py-4">
                      <div className="h-4 w-24 rounded bg-slate-200 dark:bg-slate-800" />
                    </td>
                    <td className="no-print px-5 py-4" />
                  </tr>
                ))
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-14 text-center">
                    <UserPlus className="mx-auto h-9 w-9 text-slate-400 dark:text-slate-600" />
                    <p className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-200">
                      لا توجد حسابات مطابقة لمعايير البحث الحالية
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      يمكنك تعديل التصفية أو إضافة مستخدم جديد وتخصيص صلاحياته التشغيلية.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isSelf = currentUser?.id === u.id;
                  const grantedCount = countGrantedPermissions(u.permissions);
                  const isRowBusy = busyRowId === u.id;

                  return (
                    <tr
                      key={u.id}
                      className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-900/40"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            {u.fullName}
                          </span>
                          {isSelf && (
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              أنت
                            </span>
                          )}
                        </div>
                        <p
                          dir="ltr"
                          className="mt-0.5 text-right text-xs text-slate-500 dark:text-slate-400"
                        >
                          @{u.username}
                        </p>
                      </td>

                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold ${
                            u.role === 'admin'
                              ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                              : u.role === 'operator'
                                ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          <Shield className="h-3.5 w-3.5" />
                          {ROLE_LABELS_AR[u.role]}
                        </span>
                      </td>

                      <td className="px-4 py-3.5">
                        {u.role === 'admin' ? (
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                            كامل الصلاحيات ({TOTAL_PERMISSION_FLAGS}/{TOTAL_PERMISSION_FLAGS})
                          </span>
                        ) : (
                          <span className="tabular-nums text-xs font-semibold text-slate-600 dark:text-slate-400">
                            {grantedCount} من {TOTAL_PERMISSION_FLAGS} صلاحية
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                            u.isActive
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              u.isActive ? 'bg-emerald-500' : 'bg-red-500'
                            }`}
                          />
                          {u.isActive ? 'نشط' : 'موقوف'}
                        </span>
                      </td>

                      <td
                        dir="ltr"
                        className="tabular-nums px-4 py-3.5 text-right text-xs text-slate-500 dark:text-slate-400"
                      >
                        {u.createdAt.slice(0, 10)}
                      </td>

                      <td className="no-print px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditDrawer(u)}
                            disabled={isRowBusy}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                            title="تعديل البيانات والصلاحيات"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>تعديل</span>
                          </button>

                          {!isSelf && (
                            <button
                              type="button"
                              onClick={() => {
                                void handleToggleActiveQuick(u);
                              }}
                              disabled={isRowBusy}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                                u.isActive
                                  ? 'border-amber-200 bg-amber-50/70 text-amber-800 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300'
                                  : 'border-emerald-200 bg-emerald-50/70 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                              }`}
                              title={u.isActive ? 'إيقاف الحساب' : 'تفعيل الحساب'}
                            >
                              {u.isActive ? (
                                <>
                                  <UserX className="h-3.5 w-3.5" />
                                  <span>إيقاف</span>
                                </>
                              ) : (
                                <>
                                  <UserCheck className="h-3.5 w-3.5" />
                                  <span>تفعيل</span>
                                </>
                              )}
                            </button>
                          )}

                          {!isSelf &&
                            (confirmDeleteId === u.id ? (
                              <div className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-2 py-1 dark:border-red-800 dark:bg-red-950/60">
                                <button
                                  type="button"
                                  disabled={isRowBusy}
                                  onClick={() => {
                                    void handleDeleteUser(u);
                                  }}
                                  className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-red-700"
                                >
                                  تأكيد الحذف
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300"
                                >
                                  إلغاء
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                disabled={isRowBusy}
                                onClick={() => setConfirmDeleteId(u.id)}
                                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-red-900/60 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                                aria-label={`حذف ${u.fullName}`}
                                title="حذف المستخدم"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            ))}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit User & Granular RBAC Slide-Over Drawer */}
      {drawerOpen && (
        <div
          className="no-print fixed inset-0 z-50 flex justify-start"
          role="dialog"
          aria-modal="true"
          aria-labelledby="user-drawer-title"
        >
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={() => !isSaving && setDrawerOpen(false)}
          />

          <div className="relative z-10 flex h-dvh w-full max-w-xl flex-col border border-slate-200 border-r-4 border-r-blue-600 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <div>
                <h2
                  id="user-drawer-title"
                  className="text-base font-bold text-slate-900 dark:text-slate-100"
                >
                  {editingUser
                    ? `تعديل حساب: ${editingUser.fullName}`
                    : 'إضافة مستخدم جديد'}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  تحديد بيانات الدخول والدور الوظيفي ومصفوفة الصلاحيات التفصيلية
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                disabled={isSaving}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="إغلاق"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={handleSubmitForm}
              className="flex flex-1 flex-col overflow-hidden"
            >
              <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                {formError && (
                  <div
                    role="alert"
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                  >
                    {formError}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-300">
                      الاسم الكامل
                    </label>
                    <input
                      type="text"
                      required
                      value={form.fullName}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, fullName: e.target.value }))
                      }
                      placeholder="مثال: أحمد محمود"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-300">
                      اسم المستخدم (للدخول)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      required
                      value={form.username}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, username: e.target.value }))
                      }
                      placeholder="ahmed.sales"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-left text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-300">
                      {editingUser ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور'}
                    </label>
                    <input
                      type="password"
                      dir="ltr"
                      required={!editingUser}
                      value={form.password}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, password: e.target.value }))
                      }
                      placeholder={
                        editingUser ? 'اتركه فارغاً لعدم التغيير' : '6 أحرف على الأقل'
                      }
                      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-left text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div className="flex flex-col justify-end">
                    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-900">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        حالة الحساب ({form.isActive ? 'نشط' : 'موقوف'})
                      </span>
                      <input
                        type="checkbox"
                        checked={form.isActive}
                        disabled={editingUser?.id === currentUser?.id}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            isActive: e.target.checked,
                          }))
                        }
                        className="h-4 w-4 accent-blue-600"
                      />
                    </label>
                  </div>
                </div>

                {/* Role Selection */}
                <div>
                  <label className="mb-2 block text-xs font-bold text-slate-700 dark:text-slate-300">
                    الدور الوظيفي الأساسي
                  </label>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    {(['admin', 'operator', 'viewer'] as UserRole[]).map((r) => {
                      const selected = form.role === r;
                      const lockedSelf =
                        editingUser?.id === currentUser?.id && r !== 'admin';
                      return (
                        <button
                          key={r}
                          type="button"
                          disabled={lockedSelf}
                          onClick={() => handleRoleChange(r)}
                          className={`rounded-xl border p-3 text-right transition-colors disabled:opacity-45 ${
                            selected
                              ? 'border-blue-600 bg-blue-50/80 dark:border-blue-500 dark:bg-blue-950/50'
                              : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/70'
                          }`}
                        >
                          <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            {ROLE_LABELS_AR[r]}
                          </p>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                            {ROLE_DESCRIPTIONS_AR[r]}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Granular Permissions Matrix */}
                <div>
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      مصفوفة الصلاحيات التفصيلية (RBAC)
                    </span>
                    {form.role === 'admin' && (
                      <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                        يمتلك مدير النظام جميع الصلاحيات تلقائياً
                      </span>
                    )}
                  </div>

                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                    {PERMISSION_GROUPS_AR.map((group) => {
                      const groupState = form.permissions[group.key] as Record<
                        string,
                        boolean
                      >;
                      return (
                        <div
                          key={group.key}
                          className="rounded-xl border border-slate-200/80 bg-white p-3.5 dark:border-slate-800 dark:bg-[#111827]"
                        >
                          <p className="mb-2.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                            {group.title}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {group.items.map((permItem) => {
                              const checked = Boolean(groupState?.[permItem.subKey]);
                              const disabled =
                                form.role === 'admin' ||
                                group.key === 'users' ||
                                group.key === 'settings';

                              return (
                                <button
                                  key={permItem.subKey}
                                  type="button"
                                  disabled={disabled}
                                  onClick={() =>
                                    handleTogglePermission(group.key, permItem.subKey)
                                  }
                                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                                    checked
                                      ? 'border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-600'
                                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300'
                                  } ${disabled ? 'cursor-default opacity-80' : ''}`}
                                >
                                  <span
                                    className={`flex h-3.5 w-3.5 items-center justify-center rounded-xs ${
                                      checked
                                        ? 'bg-white/20 text-white'
                                        : 'border border-slate-400 dark:border-slate-500'
                                    }`}
                                  >
                                    {checked && <Check className="h-2.5 w-2.5" />}
                                  </span>
                                  <span>{permItem.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-800 dark:bg-slate-900/80">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>{editingUser ? 'حفظ التغييرات' : 'إنشاء الحساب'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
