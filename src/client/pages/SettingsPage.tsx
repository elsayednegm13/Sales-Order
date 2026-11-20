import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  Globe,
  Hash,
  ImagePlus,
  Loader2,
  RotateCcw,
  Save,
  Upload,
} from 'lucide-react';
import { api, ApiClientError } from '@/client/lib/api';
import { useBranding } from '@/client/contexts/BrandingContext';
import { useAuth } from '@/client/contexts/AuthContext';
import { useToast } from '@/client/components/ui/Toast';
import { BrandMark } from '@/client/components/ui/BrandMark';

export function SettingsPage() {
  const { settings, applySettings } = useBranding();
  const { refreshUser } = useAuth();
  const { notify } = useToast();

  const [companyName, setCompanyName] = useState(settings.companyName);
  const [startingOrderNumber, setStartingOrderNumber] = useState<string>(
    String(settings.startingOrderNumber)
  );
  const [isSavingGeneral, setIsSavingGeneral] = useState(false);

  // Staged local files + live object URL previews before/during R2 upload
  const [stagedLogoFile, setStagedLogoFile] = useState<File | null>(null);
  const [stagedLogoPreview, setStagedLogoPreview] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  const [stagedFaviconFile, setStagedFaviconFile] = useState<File | null>(null);
  const [stagedFaviconPreview, setStagedFaviconPreview] = useState<string | null>(
    null
  );
  const [isUploadingFavicon, setIsUploadingFavicon] = useState(false);

  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const faviconInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setCompanyName(settings.companyName);
    setStartingOrderNumber(String(settings.startingOrderNumber));
  }, [settings.companyName, settings.startingOrderNumber]);

  // Clean up temporary blob URLs on unmount or replacement
  useEffect(() => {
    return () => {
      if (stagedLogoPreview) URL.revokeObjectURL(stagedLogoPreview);
    };
  }, [stagedLogoPreview]);

  useEffect(() => {
    return () => {
      if (stagedFaviconPreview) URL.revokeObjectURL(stagedFaviconPreview);
    };
  }, [stagedFaviconPreview]);

  const effectiveLogoPreview = stagedLogoPreview ?? settings.logoUrl;
  const effectiveFaviconPreview =
    stagedFaviconPreview ?? settings.faviconUrl ?? '/favicon.svg';
  const effectiveCompanyName = companyName.trim() || 'نظام إدارة المبيعات';

  const handleSelectLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      notify('حجم ملف الشعار يجب ألا يتجاوز 5 ميجابايت', 'error');
      return;
    }
    if (stagedLogoPreview) {
      URL.revokeObjectURL(stagedLogoPreview);
    }
    setStagedLogoFile(file);
    setStagedLogoPreview(URL.createObjectURL(file));
  };

  const handleSelectFavicon = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      notify('حجم ملف الأيقونة يجب ألا يتجاوز 5 ميجابايت', 'error');
      return;
    }
    if (stagedFaviconPreview) {
      URL.revokeObjectURL(stagedFaviconPreview);
    }
    setStagedFaviconFile(file);
    setStagedFaviconPreview(URL.createObjectURL(file));
  };

  const handleUploadAsset = async (type: 'logo' | 'favicon') => {
    const file = type === 'logo' ? stagedLogoFile : stagedFaviconFile;
    if (!file) return;

    if (type === 'logo') setIsUploadingLogo(true);
    else setIsUploadingFavicon(true);

    try {
      const res = await api.settings.uploadAsset(type, file);
      applySettings(res.settings);

      if (type === 'logo') {
        setStagedLogoFile(null);
        setStagedLogoPreview(null);
        if (logoInputRef.current) logoInputRef.current.value = '';
        notify('تم رفع شعار الشركة وتحديث الهوية بنجاح');
      } else {
        setStagedFaviconFile(null);
        setStagedFaviconPreview(null);
        if (faviconInputRef.current) faviconInputRef.current.value = '';
        notify('تم رفع أيقونة المتصفح وتحديث التبويب بنجاح');
      }
    } catch (err) {
      notify(
        err instanceof ApiClientError ? err.message : 'تعذر رفع الملف إلى التخزين السحابي',
        'error'
      );
    } finally {
      if (type === 'logo') setIsUploadingLogo(false);
      else setIsUploadingFavicon(false);
    }
  };

  const handleResetStoredAsset = async (type: 'logo' | 'favicon') => {
    setIsSavingGeneral(true);
    try {
      const res = await api.settings.update({
        companyName: settings.companyName,
        startingOrderNumber: settings.startingOrderNumber,
        logoUrl: type === 'logo' ? null : settings.logoUrl,
        faviconUrl: type === 'favicon' ? null : settings.faviconUrl,
      });
      applySettings(res.settings);
      notify(
        type === 'logo'
          ? 'تمت استعادة الشعار الافتراضي'
          : 'تمت استعادة أيقونة المتصفح الافتراضية'
      );
    } catch (err) {
      notify(
        err instanceof ApiClientError ? err.message : 'تعذر تحديث الإعدادات',
        'error'
      );
    } finally {
      setIsSavingGeneral(false);
    }
  };

  const handleSaveGeneralSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingGeneral) return;

    const trimmedName = companyName.trim();
    const parsedOrderNum = Number.parseInt(startingOrderNumber, 10);

    if (trimmedName.length < 2) {
      notify('يرجى إدخال اسم الشركة (حرفان على الأقل)', 'error');
      return;
    }
    if (!Number.isInteger(parsedOrderNum) || parsedOrderNum < 1) {
      notify('رقم بداية الأوردرات يجب أن يكون رقماً صحيحاً موجباً', 'error');
      return;
    }

    setIsSavingGeneral(true);
    try {
      let latestSettings = settings;

      // Also upload any staged files automatically so one save button handles everything smoothly
      if (stagedLogoFile) {
        const uploadedLogo = await api.settings.uploadAsset('logo', stagedLogoFile);
        latestSettings = uploadedLogo.settings;
        setStagedLogoFile(null);
        setStagedLogoPreview(null);
        if (logoInputRef.current) logoInputRef.current.value = '';
      }

      if (stagedFaviconFile) {
        const uploadedFav = await api.settings.uploadAsset('favicon', stagedFaviconFile);
        latestSettings = uploadedFav.settings;
        setStagedFaviconFile(null);
        setStagedFaviconPreview(null);
        if (faviconInputRef.current) faviconInputRef.current.value = '';
      }

      const res = await api.settings.update({
        companyName: trimmedName,
        startingOrderNumber: parsedOrderNum,
        logoUrl: latestSettings.logoUrl,
        faviconUrl: latestSettings.faviconUrl,
      });

      applySettings(res.settings);
      await refreshUser();
      notify('تم حفظ إعدادات النظام والهوية بنجاح');
    } catch (err) {
      notify(
        err instanceof ApiClientError ? err.message : 'تعذر حفظ الإعدادات',
        'error'
      );
    } finally {
      setIsSavingGeneral(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Right Column: Settings Forms */}
      <div className="space-y-6 lg:col-span-7">
        {/* General Identity & Starting Order Number */}
        <form
          onSubmit={handleSaveGeneralSettings}
          className="rounded-2xl border border-slate-200/90 bg-white p-6 dark:border-slate-800/90 dark:bg-[#111827]"
        >
          <div className="mb-5 flex items-center gap-3 border-b border-slate-200/80 pb-4 dark:border-slate-800/80">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                البيانات الأساسية وترقيم الأوردرات
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                تتحكم هذه الإعدادات في عنوان المتصفح وشاشة الدخول والترقيم التلقائي للشيت اليومي
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="settings-company-name"
                className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                اسم الشركة / النظام
              </label>
              <input
                id="settings-company-name"
                type="text"
                required
                maxLength={120}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                placeholder="نظام إدارة المبيعات"
              />
            </div>

            <div>
              <label
                htmlFor="settings-starting-order"
                className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                رقم البداية التلقائي لأوردر اليوم (starting_order_number)
              </label>
              <div className="relative">
                <Hash className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="settings-starting-order"
                  type="number"
                  dir="ltr"
                  min={1}
                  step={1}
                  required
                  value={startingOrderNumber}
                  onChange={(e) => setStartingOrderNumber(e.target.value)}
                  className="tabular-nums w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-10 pl-3.5 text-left text-sm font-bold text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                يُستخدم كخط أساس للترقيم التلقائي عند فتح شيت يومي جديد، مع بقاء رقم الشيت قابلاً للتعديل اليدوي عند الحاجة.
              </p>
            </div>
          </div>

          <div className="mt-6 flex justify-end border-t border-slate-200/80 pt-4 dark:border-slate-800/80">
            <button
              type="submit"
              disabled={isSavingGeneral}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-xs transition-colors hover:bg-blue-700 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-500"
            >
              {isSavingGeneral ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              <span>حفظ الإعدادات</span>
            </button>
          </div>
        </form>

        {/* Company Logo R2 Upload Card */}
        <section className="rounded-2xl border border-slate-200/90 bg-white p-6 dark:border-slate-800/90 dark:bg-[#111827]">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                <ImagePlus className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  شعار الشركة (Company Logo — Cloudflare R2)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  يظهر في شاشة تسجيل الدخول ورأس القائمة الجانبية (PNG, SVG, WEBP, JPG)
                </p>
              </div>
            </div>

            {settings.logoUrl && !stagedLogoFile && (
              <button
                type="button"
                onClick={() => {
                  void handleResetStoredAsset('logo');
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>استعادة الافتراضي</span>
              </button>
            )}
          </div>

          <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 sm:flex-row sm:items-center dark:border-slate-700 dark:bg-slate-900/60">
            <BrandMark
              logoUrl={effectiveLogoPreview}
              companyName={effectiveCompanyName}
              size="lg"
            />

            <div className="flex-1 space-y-2">
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handleSelectLogo}
                className="hidden"
                id="upload-logo-input"
              />
              <div className="flex flex-wrap items-center gap-2">
                <label
                  htmlFor="upload-logo-input"
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>اختيار صورة الشعار</span>
                </label>

                {stagedLogoFile && (
                  <>
                    <button
                      type="button"
                      disabled={isUploadingLogo}
                      onClick={() => {
                        void handleUploadAsset('logo');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {isUploadingLogo && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      <span>رفع واعتماد الشعار الآن</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStagedLogoFile(null);
                        setStagedLogoPreview(null);
                        if (logoInputRef.current) logoInputRef.current.value = '';
                      }}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                    >
                      إلغاء المعاينة
                    </button>
                  </>
                )}
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                {stagedLogoFile
                  ? `جاهز للرفع (معاينة حية نشطة): ${stagedLogoFile.name}`
                  : 'يفضل صورة بخلفية شفافة بأبعاد مربعة أو أفقية متناسقة بحد أقصى 5 ميجابايت.'}
              </p>
            </div>
          </div>
        </section>

        {/* Favicon R2 Upload Card */}
        <section className="rounded-2xl border border-slate-200/90 bg-white p-6 dark:border-slate-800/90 dark:bg-[#111827]">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                <Globe className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  أيقونة تبويب المتصفح (Favicon — Cloudflare R2)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  تُحدّث أيقونة المتصفح لحظياً عبر النظام بالكامل (SVG, PNG, ICO)
                </p>
              </div>
            </div>

            {settings.faviconUrl && !stagedFaviconFile && (
              <button
                type="button"
                onClick={() => {
                  void handleResetStoredAsset('favicon');
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>استعادة الافتراضي</span>
              </button>
            )}
          </div>

          <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 sm:flex-row sm:items-center dark:border-slate-700 dark:bg-slate-900/60">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900">
              <img
                src={effectiveFaviconPreview}
                alt="معاينة الأيقونة"
                className="h-8 w-8 object-contain"
              />
            </div>

            <div className="flex-1 space-y-2">
              <input
                ref={faviconInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon"
                onChange={handleSelectFavicon}
                className="hidden"
                id="upload-favicon-input"
              />
              <div className="flex flex-wrap items-center gap-2">
                <label
                  htmlFor="upload-favicon-input"
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>اختيار ملف الأيقونة</span>
                </label>

                {stagedFaviconFile && (
                  <>
                    <button
                      type="button"
                      disabled={isUploadingFavicon}
                      onClick={() => {
                        void handleUploadAsset('favicon');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {isUploadingFavicon && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      <span>رفع واعتماد الأيقونة الآن</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStagedFaviconFile(null);
                        setStagedFaviconPreview(null);
                        if (faviconInputRef.current) faviconInputRef.current.value = '';
                      }}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                    >
                      إلغاء المعاينة
                    </button>
                  </>
                )}
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                {stagedFaviconFile
                  ? `جاهز للرفع (معاينة حية نشطة): ${stagedFaviconFile.name}`
                  : 'يفضل مقاس 64×64 بكسل أو ملف SVG مربع واضح.'}
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* Left Column: Live White-Labeling Preview */}
      <aside className="lg:col-span-5">
        <div className="sticky top-24 space-y-4 rounded-2xl border border-slate-200/90 bg-white p-6 dark:border-slate-800/90 dark:bg-[#111827]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              معاينة حية للهوية المؤسسية
            </h3>
            {(stagedLogoFile || stagedFaviconFile) && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                تعديلات قيد المعاينة
              </span>
            )}
          </div>

          {/* Browser Tab Mockup */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-200/70 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-400/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-400/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-400/70" />
              </div>

              <div className="flex max-w-[230px] items-center gap-2 rounded-lg bg-white px-3 py-1 shadow-2xs dark:bg-[#111827]">
                <img
                  src={effectiveFaviconPreview}
                  alt=""
                  className="h-3.5 w-3.5 shrink-0 object-contain"
                />
                <span className="truncate text-[11px] font-bold text-slate-800 dark:text-slate-200">
                  {effectiveCompanyName}
                </span>
              </div>
            </div>

            {/* Miniature Login Screen Preview */}
            <div className="flex flex-col items-center justify-center bg-slate-50 px-5 py-8 dark:bg-[#090d16]">
              <div className="w-full max-w-[260px] rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm dark:border-slate-800 dark:bg-[#111827]">
                <div className="flex justify-center">
                  <BrandMark
                    logoUrl={effectiveLogoPreview}
                    companyName={effectiveCompanyName}
                    size="md"
                  />
                </div>
                <p className="mt-3 truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                  {effectiveCompanyName}
                </p>

                <div className="mt-4 space-y-2 text-right">
                  <div className="h-7 rounded-lg border border-slate-200 bg-slate-50 px-2.5 dark:border-slate-800 dark:bg-slate-900" />
                  <div className="h-7 rounded-lg border border-slate-200 bg-slate-50 px-2.5 dark:border-slate-800 dark:bg-slate-900" />
                  <div className="flex h-8 items-center justify-center rounded-lg bg-blue-600 text-[11px] font-bold text-white">
                    تسجيل الدخول
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Starting Sheet Number Summary */}
          <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/70">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              أول رقم شيت تلقائي قادم:
            </span>
            <span
              dir="ltr"
              className="tabular-nums text-sm font-extrabold text-blue-600 dark:text-blue-400"
            >
              #{Number.parseInt(startingOrderNumber, 10) || settings.startingOrderNumber}
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}
