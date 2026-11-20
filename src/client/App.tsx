import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { ThemeProvider } from '@/client/contexts/ThemeContext';
import { BrandingProvider } from '@/client/contexts/BrandingContext';
import { AuthProvider, useAuth } from '@/client/contexts/AuthContext';
import { ToastProvider } from '@/client/components/ui/Toast';
import { AppShell } from '@/client/components/layout/AppShell';
import { SkeletonCard } from '@/client/components/ui/Skeleton';

const LoginPage = lazy(() => import('@/client/pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const DashboardPage = lazy(() => import('@/client/pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const UsersPage = lazy(() => import('@/client/pages/UsersPage').then((module) => ({ default: module.UsersPage })));
const SettingsPage = lazy(() => import('@/client/pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const CatalogPage = lazy(() => import('@/client/pages/CatalogPage').then((module) => ({ default: module.CatalogPage })));
const CustomersPage = lazy(() => import('@/client/pages/CustomersPage').then((module) => ({ default: module.CustomersPage })));
const DailySheetsPage = lazy(() => import('@/client/pages/DailySheetsPage').then((module) => ({ default: module.DailySheetsPage })));
const DailySheetDetailPage = lazy(() => import('@/client/pages/DailySheetDetailPage').then((module) => ({ default: module.DailySheetDetailPage })));
const ReportsPage = lazy(() => import('@/client/pages/ReportsPage').then((module) => ({ default: module.ReportsPage })));
const AuditLogPage = lazy(() => import('@/client/pages/AuditLogPage').then((module) => ({ default: module.AuditLogPage })));

function PageFallback() {
  return <SkeletonCard count={4} />;
}

function firstAllowedPath(user: NonNullable<ReturnType<typeof useAuth>['user']>): string | null {
  const allow = (section: 'dailySheets' | 'catalog' | 'customers' | 'reports') =>
    user.role === 'admin' || Boolean(user.permissions[section].view);
  if (allow('dailySheets')) return '/';
  if (allow('catalog')) return '/catalog';
  if (allow('customers')) return '/customers';
  if (allow('reports')) return '/reports';
  if (user.role === 'admin') return '/users';
  return null;
}

function GuardedDashboard() {
  const { user } = useAuth();
  const allowed = user?.role === 'admin' || Boolean(user?.permissions.dailySheets.view);
  if (!user || !allowed) {
    const next = user ? firstAllowedPath(user) : null;
    if (next && next !== '/') return <Navigate to={next} replace />;
    return <p className="py-16 text-center text-sm text-slate-500">لا توجد صفحة متاحة لهذا الحساب.</p>;
  }
  return <DashboardPage />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function ViewRoute({
  section,
  children,
}: {
  section: 'catalog' | 'customers' | 'dailySheets' | 'reports';
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const allowed =
    user?.role === 'admin' || Boolean(user?.permissions[section].view);
  if (!user || !allowed) {
    const next = user ? firstAllowedPath(user) : '/';
    if (!next) return <p className="py-16 text-center text-sm text-slate-500">لا توجد صفحة متاحة لهذا الحساب.</p>;
    return <Navigate to={next} replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 dark:bg-[#090d16]">
        <Loader2 className="h-7 w-7 animate-spin text-blue-600 dark:text-blue-400" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <AppShell>
      <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<GuardedDashboard />} />
        <Route
          path="/daily-sheets"
          element={
            <ViewRoute section="dailySheets">
              <DailySheetsPage />
            </ViewRoute>
          }
        />
        <Route
          path="/daily-sheets/:sheetId"
          element={
            <ViewRoute section="dailySheets">
              <DailySheetDetailPage />
            </ViewRoute>
          }
        />
        <Route
          path="/catalog"
          element={
            <ViewRoute section="catalog">
              <CatalogPage />
            </ViewRoute>
          }
        />
        <Route
          path="/customers"
          element={
            <ViewRoute section="customers">
              <CustomersPage />
            </ViewRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ViewRoute section="reports">
              <ReportsPage />
            </ViewRoute>
          }
        />
        <Route
          path="/users"
          element={
            <AdminRoute>
              <UsersPage />
            </AdminRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <AdminRoute>
              <SettingsPage />
            </AdminRoute>
          }
        />
        <Route
          path="/audit-log"
          element={
            <AdminRoute>
              <AuditLogPage />
            </AdminRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </AppShell>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <BrandingProvider>
        <AuthProvider>
          <ToastProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </ToastProvider>
        </AuthProvider>
      </BrandingProvider>
    </ThemeProvider>
  );
}
