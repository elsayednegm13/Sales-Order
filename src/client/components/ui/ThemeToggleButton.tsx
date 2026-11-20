import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/client/contexts/ThemeContext';

interface ThemeToggleButtonProps {
  className?: string;
  floating?: boolean;
}

export function ThemeToggleButton({
  className = '',
  floating = false,
}: ThemeToggleButtonProps) {
  const { isDark, toggleTheme } = useTheme();

  const baseStyles = floating
    ? 'fixed top-5 left-5 z-40 h-11 w-11 rounded-full border border-slate-200/90 bg-white/90 text-slate-700 shadow-sm hover:bg-slate-100 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white backdrop-blur-sm'
    : 'h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white';

  return (
    <button
      type="button"
      onClick={(e) => {
        void toggleTheme(e);
      }}
      aria-label={isDark ? 'التبديل إلى الوضع النهاري' : 'التبديل إلى الوضع الليلي'}
      title={isDark ? 'الوضع النهاري' : 'الوضع الليلي'}
      className={`no-print inline-flex items-center justify-center transition-colors duration-150 ${baseStyles} ${className}`}
    >
      {isDark ? (
        <Sun className="h-[18px] w-[18px] text-amber-400" strokeWidth={2} />
      ) : (
        <Moon className="h-[18px] w-[18px] text-slate-700" strokeWidth={2} />
      )}
    </button>
  );
}
