import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, ClipboardList, Package, Scale, Store, Users } from 'lucide-react';
import { api, ApiClientError } from '@/client/lib/api';
import { useAuth } from '@/client/contexts/AuthContext';
import { useToast } from '@/client/components/ui/Toast';
import type { DashboardStatsDTO, DailySheetStatus } from '@/shared/types';

const EMPTY_STATS: DashboardStatsDTO = {
  activeProducts: 0,
  customers: 0,
  subMerchants: 0,
  openDailySheets: 0,
  openCartons: 0,
  openPieces: 0,
  todayOrderCount: 0,
  openWeightKg: 0,
  recentSheets: [],
};

function statusLabel(status: DailySheetStatus): string {
  if (status === 'open') return 'مفتوح';
  if (status === 'closed') return 'مغلق';
  return 'مؤرشف';
}

export function DashboardPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [stats, setStats] = useState<DashboardStatsDTO>(EMPTY_STATS);
  const [isLoading, setIsLoading] = useState(true);
  const greetingName = user?.fullName?.trim() || user?.username || '';

  useEffect(() => {
    let active = true;
    api.dashboard
      .stats()
      .then((res) => {
        if (active) setStats(res.stats);
      })
      .catch((err: unknown) => {
        notify(err instanceof ApiClientError ? err.message : 'تعذر تحميل مؤشرات التشغيل', 'error');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [notify]);

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">لوحة التحكم</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {greetingName ? `مرحباً، ${greetingName}` : 'متابعة أوردرات اليوم'}
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi label="عدد طلبات اليوم" value={stats.todayOrderCount} loading={isLoading} icon={<ClipboardList className="h-4 w-4 text-blue-600" />} />
        <Kpi label="إجمالي الكراتين / الأكياس" value={stats.openCartons} loading={isLoading} icon={<Boxes className="h-4 w-4 text-slate-600" />} />
        <Kpi label="إجمالي القطع" value={stats.openPieces} loading={isLoading} icon={<Package className="h-4 w-4 text-emerald-600" />} />
        <Kpi label="إجمالي الوزن الصافي (كجم)" value={stats.openWeightKg} loading={isLoading} icon={<Scale className="h-4 w-4 text-amber-600" />} />
        <Kpi label="العملاء" value={stats.customers} loading={isLoading} icon={<Users className="h-4 w-4 text-slate-600" />} />
        <Kpi label="الأصناف النشطة" value={stats.activeProducts} loading={isLoading} icon={<Store className="h-4 w-4 text-blue-600" />} />
      </section>

      <section className="rounded-2xl border border-slate-200/90 bg-white p-6 dark:border-slate-800/90 dark:bg-[#111827]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-base font-bold">آخر أوردرات اليوم</h3>
          <Link to="/daily-sheets" className="text-xs font-bold text-blue-600">عرض الكل</Link>
        </div>
        {stats.recentSheets.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">لا توجد أوردرات يومية بعد.</p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {stats.recentSheets.map((sheet) => (
              <li key={sheet.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <Link to={`/daily-sheets/${sheet.id}`} className="font-bold text-slate-900 hover:text-blue-700 dark:text-slate-100 dark:hover:text-blue-300">
                    أوردر #{sheet.sheetNumber}
                  </Link>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    <span dir="ltr">{sheet.sheetDate}</span>
                    <span className="mx-2">·</span>
                    {statusLabel(sheet.status)}
                  </p>
                </div>
                <div className="text-left text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <p className="tabular-nums">{sheet.totalCartons} كرتونة</p>
                  <p className="tabular-nums">{sheet.totalPieces} قطعة</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  loading,
  icon,
}: {
  label: string;
  value: number;
  loading: boolean;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white px-5 py-5 dark:border-slate-800/90 dark:bg-[#111827]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{label}</p>
        {icon}
      </div>
      <p className="tabular-nums mt-3 text-3xl font-extrabold text-slate-900 dark:text-slate-100">
        {loading ? '—' : value}
      </p>
    </div>
  );
}
