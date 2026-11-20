import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  BarChart3,
  ClipboardList,
  Hash,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ScrollText,
  Settings,
  ShieldCheck,
  Store,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '@/client/contexts/AuthContext';
import { useBranding } from '@/client/contexts/BrandingContext';
import { ROLE_LABELS_AR } from '@/shared/permissions';
import { BrandMark } from '@/client/components/ui/BrandMark';
import { ThemeToggleButton } from '@/client/components/ui/ThemeToggleButton';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  requiresReports?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'لوحة التحكم',
    icon: LayoutDashboard,
  },
  {
    to: '/daily-sheets',
    label: 'أوردر اليوم',
    icon: ClipboardList,
  },
  {
    to: '/catalog',
    label: 'الكتالوج والمنتجات',
    icon: Package,
  },
  {
    to: '/customers',
    label: 'العملاء والتجار',
    icon: Store,
  },
  {
    to: '/reports',
    label: 'التقارير والإحصائيات',
    icon: BarChart3,
    requiresReports: true,
  },
  {
    to: '/users',
    label: 'المستخدمون والصلاحيات',
    icon: Users,
    adminOnly: true,
  },
  {
    to: '/settings',
    label: 'إعدادات النظام والهوية',
    icon: Settings,
    adminOnly: true,
  },
  {
    to: '/audit-log',
    label: 'سجل النشاط',
    icon: ScrollText,
    adminOnly: true,
  },
];

const PAGE_TITLES: Record<string, string> = {
  '/': 'لوحة التحكم الرئيسية',
  '/daily-sheets': 'أوردر اليوم',
  '/catalog': 'الكتالوج والمنتجات',
  '/customers': 'العملاء والتجار',
  '/reports': 'التقارير والإحصائيات',
  '/users': 'إدارة المستخدمين والصلاحيات',
  '/settings': 'إعدادات النظام والهوية المؤسسية',
  '/audit-log': 'سجل النشاط',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, logout } = useAuth();
  const { settings } = useBranding();
  const { nextSheetNumber, isLoading: authLoading } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawerOpen]);

  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (!user) return false;
    if (item.adminOnly && !isAdmin) return false;
    if (item.to === '/' || item.to === '/daily-sheets') return isAdmin || Boolean(user.permissions.dailySheets.view);
    if (item.to === '/catalog') return isAdmin || Boolean(user.permissions.catalog.view);
    if (item.to === '/customers') return isAdmin || Boolean(user.permissions.customers.view);
    if (item.requiresReports) return isAdmin || Boolean(user.permissions.reports.view);
    return true;
  });
  const activePageTitle = location.pathname.startsWith('/daily-sheets/')
    ? 'تفاصيل أوردر اليوم'
    : (PAGE_TITLES[location.pathname] ?? settings.companyName);

  const renderSidebarContent = () => (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200/80 px-3 py-3 dark:border-slate-800/80">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandMark
              logoUrl={settings.logoUrl}
              companyName={settings.companyName}
              size="sm"
            />
            <div className="min-w-0">
              <p className="line-clamp-2 text-xs font-semibold leading-4 text-slate-900 dark:text-slate-100">
                {settings.companyName}
              </p>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                توزيع الجملة والأوردرات
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 lg:hidden dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
            aria-label="إغلاق القائمة الجانبية"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="التنقل الرئيسي">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors duration-150 ${
                    isActive
                      ? 'bg-blue-600 text-white dark:bg-blue-600 dark:text-white'
                      : 'text-slate-700 hover:bg-slate-200/70 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white'
                  }`
                }
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

      {user && (
        <div className="shrink-0 border-t border-slate-200/80 p-2.5 dark:border-slate-800/80">
          <div className="mb-2 rounded-lg border border-slate-200/80 bg-white px-2.5 py-2 dark:border-slate-800 dark:bg-slate-900/90">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                {user.fullName}
              </p>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/70 dark:text-blue-300">
                <ShieldCheck className="h-3 w-3" />
                {ROLE_LABELS_AR[user.role]}
              </span>
            </div>
            <p
              dir="ltr"
              className="mt-0.5 truncate text-right text-xs text-slate-500 dark:text-slate-400"
            >
              @{user.username}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              void logout();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-red-800 dark:hover:bg-red-950/70 dark:hover:text-red-200"
          >
            <LogOut className="h-4 w-4" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-dvh w-full bg-slate-50 text-slate-900 dark:bg-[#090d16] dark:text-slate-100">
      {/* Desktop Fixed RTL Sidebar */}
      <aside className="no-print sticky top-0 hidden h-dvh w-56 shrink-0 border-l border-slate-200/90 bg-slate-100/80 lg:block dark:border-slate-800/80 dark:bg-[#0d1321]">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Slide-Over Drawer */}
      {drawerOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs transition-opacity"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="fixed inset-y-0 right-0 z-10 w-72 max-w-[85vw] border-l border-slate-200 bg-slate-100 shadow-2xl dark:border-slate-800 dark:bg-[#0d1321]">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200/90 bg-white/90 px-4 backdrop-blur-md sm:px-6 lg:px-8 dark:border-slate-800/80 dark:bg-[#090d16]/90">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 lg:hidden dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white"
              aria-label="فتح القائمة الجانبية"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="truncate text-base font-bold text-slate-900 sm:text-lg dark:text-slate-100">
              {activePageTitle}
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            {!authLoading && nextSheetNumber && (
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                <Hash className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                <span>الأوردر القادم:</span>
                <span dir="ltr" className="tabular-nums font-bold text-slate-900 dark:text-white">
                  {nextSheetNumber}
                </span>
              </div>
            )}

            <ThemeToggleButton />
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
