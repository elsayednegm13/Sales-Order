import React, { useState } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '@/client/contexts/AuthContext';
import { useBranding } from '@/client/contexts/BrandingContext';
import { ApiClientError } from '@/client/lib/api';
import { BrandMark } from '@/client/components/ui/BrandMark';
import { ThemeToggleButton } from '@/client/components/ui/ThemeToggleButton';

export function LoginPage() {
  const { login } = useAuth();
  const { settings } = useBranding();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password) {
      setErrorMessage('يرجى إدخال اسم المستخدم وكلمة المرور');
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await login({ username: trimmedUsername, password });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-dvh w-full items-center justify-center bg-slate-50 px-4 py-10 dark:bg-[#090d16]">
      <ThemeToggleButton floating />

      <div className="w-full max-w-[400px] rounded-2xl border border-slate-200/90 bg-white p-8 shadow-[0_14px_40px_-14px_rgba(15,23,42,0.10)] dark:border-slate-800/90 dark:bg-[#111827] dark:shadow-[0_20px_50px_-16px_rgba(0,0,0,0.65)]">
        <div className="mb-7 flex flex-col items-center text-center">
          <BrandMark
            logoUrl={settings.logoUrl}
            companyName={settings.companyName}
            size="lg"
          />
          <h1 className="mt-4 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            {settings.companyName}
          </h1>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/80 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label
              htmlFor="login-username"
              className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300"
            >
              اسم المستخدم
            </label>
            <input
              id="login-username"
              type="text"
              dir="ltr"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isSubmitting}
              className="block w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-left text-sm text-slate-900 placeholder:text-slate-400 hover:border-slate-400 focus:border-blue-600 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100 dark:placeholder:text-slate-500 dark:hover:border-slate-600 dark:focus:border-blue-500"
              placeholder="admin"
            />
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300"
            >
              كلمة المرور
            </label>
            <div className="relative">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                dir="ltr"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
                className="block w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-3.5 pl-10 text-left text-sm text-slate-900 placeholder:text-slate-400 hover:border-slate-400 focus:border-blue-600 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100 dark:placeholder:text-slate-500 dark:hover:border-slate-600 dark:focus:border-blue-500"
                placeholder="••••••••"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                className="absolute inset-y-0 left-0 flex items-center px-3 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-xs transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-65 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>جاري تسجيل الدخول...</span>
              </>
            ) : (
              <span>تسجيل الدخول</span>
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
