import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { flushSync } from 'react-dom';

export type ThemeMode = 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemeMode;
  isDark: boolean;
  toggleTheme: (event?: React.MouseEvent<HTMLElement>) => Promise<void>;
  setTheme: (nextTheme: ThemeMode) => void;
}

const THEME_STORAGE_KEY = 'sales_order_theme';

interface ViewTransition {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition: () => void;
}

type DocumentWithViewTransition = Document & {
  startViewTransition?: (updateCallback: () => void | Promise<void>) => ViewTransition;
};

function readInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light';
  }
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
  } catch {
    // Ignore storage read issues
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeClass(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  root.style.colorScheme = mode;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(readInitialTheme);

  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  // Synchronize theme changes across multiple open browser tabs
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        applyThemeClass(e.newValue);
        setThemeState(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const persistTheme = useCallback((nextTheme: ThemeMode) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Ignore storage write issues
    }
  }, []);

  const setTheme = useCallback(
    (nextTheme: ThemeMode) => {
      persistTheme(nextTheme);
      applyThemeClass(nextTheme);
      setThemeState(nextTheme);
    },
    [persistTheme]
  );

  const toggleTheme = useCallback(
    async (event?: React.MouseEvent<HTMLElement>) => {
      const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark';
      const doc = document as DocumentWithViewTransition;
      const prefersReducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;

      // Determine exact (x, y) origin coordinates from click or button center
      let originX = window.innerWidth / 2;
      let originY = 28;

      if (event) {
        const hasPointerCoords = event.clientX !== 0 || event.clientY !== 0;
        if (hasPointerCoords) {
          originX = event.clientX;
          originY = event.clientY;
        } else if (event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          originX = rect.left + rect.width / 2;
          originY = rect.top + rect.height / 2;
        }
      }

      if (!doc.startViewTransition || prefersReducedMotion) {
        setTheme(nextTheme);
        return;
      }

      const maxHorizontal = Math.max(originX, window.innerWidth - originX);
      const maxVertical = Math.max(originY, window.innerHeight - originY);
      const endRadius = Math.hypot(maxHorizontal, maxVertical);

      document.documentElement.classList.add('theme-transitioning');

      try {
        const transition = doc.startViewTransition(() => {
          flushSync(() => {
            persistTheme(nextTheme);
            applyThemeClass(nextTheme);
            setThemeState(nextTheme);
          });
        });

        await transition.ready;

        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${originX}px ${originY}px)`,
              `circle(${endRadius}px at ${originX}px ${originY}px)`,
            ],
          },
          {
            duration: 520,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            pseudoElement: '::view-transition-new(root)',
          }
        );

        await transition.finished;
      } catch {
        setTheme(nextTheme);
      } finally {
        document.documentElement.classList.remove('theme-transitioning');
      }
    },
    [persistTheme, setTheme, theme]
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      isDark: theme === 'dark',
      toggleTheme,
      setTheme,
    }),
    [theme, toggleTheme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
