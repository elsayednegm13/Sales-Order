import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from '@/client/lib/api';
import type { SystemSettingsDTO } from '@/shared/types';

const DEFAULT_SETTINGS: SystemSettingsDTO = {
  id: 1,
  companyName: 'نظام إدارة المبيعات',
  logoUrl: null,
  faviconUrl: null,
  startingOrderNumber: 1000,
  updatedAt: new Date().toISOString(),
};

interface BrandingContextValue {
  settings: SystemSettingsDTO;
  isLoading: boolean;
  refreshSettings: () => Promise<void>;
  applySettings: (nextSettings: SystemSettingsDTO) => void;
}

function inferFaviconMimeType(href: string): string {
  const clean = href.split('?')[0].toLowerCase();
  if (clean.endsWith('.svg')) return 'image/svg+xml';
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
  if (clean.endsWith('.ico')) return 'image/x-icon';
  return 'image/png';
}

function syncFaviconLink(faviconUrl: string | null): void {
  const resolvedHref = faviconUrl || '/favicon.svg';
  let link = document.querySelector<HTMLLinkElement>('link#dynamic-favicon');
  if (!link) {
    link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
  }
  if (!link) {
    link = document.createElement('link');
    link.id = 'dynamic-favicon';
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = inferFaviconMimeType(resolvedHref);
  link.href = resolvedHref;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<SystemSettingsDTO>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const applyDomBranding = useCallback((target: SystemSettingsDTO) => {
    document.title = target.companyName || DEFAULT_SETTINGS.companyName;
    syncFaviconLink(target.faviconUrl);
  }, []);

  const applySettings = useCallback(
    (nextSettings: SystemSettingsDTO) => {
      setSettings(nextSettings);
      applyDomBranding(nextSettings);
    },
    [applyDomBranding]
  );

  const refreshSettings = useCallback(async () => {
    try {
      const fetched = await api.settings.get();
      applySettings(fetched.settings);
    } catch {
      applyDomBranding(DEFAULT_SETTINGS);
    } finally {
      setIsLoading(false);
    }
  }, [applyDomBranding, applySettings]);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

  const value = useMemo<BrandingContextValue>(
    () => ({
      settings,
      isLoading,
      refreshSettings,
      applySettings,
    }),
    [settings, isLoading, refreshSettings, applySettings]
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

/**
 * Dynamic White-Labeling hook: provides live `system_settings` and keeps
 * `document.title` and `<link rel="icon">` synchronized across the app.
 */
export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) {
    throw new Error('useBranding must be used within a BrandingProvider');
  }
  return ctx;
}
