import { useEffect, useId } from 'react';

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'تراجع',
  variant = 'primary',
  loading = false,
  optionalInput,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
  loading?: boolean;
  optionalInput?: {
    label: string;
    placeholder?: string;
    value: string;
    onChange: (value: string) => void;
  };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, loading, onCancel]);

  if (!open) return null;

  const confirmClass =
    variant === 'danger'
      ? 'bg-red-600 text-white hover:bg-red-700 dark:bg-red-700 dark:text-red-50 dark:hover:bg-red-600'
      : variant === 'warning'
        ? 'bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400'
        : 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400';

  return (
    <div className="no-print fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
        onClick={() => {
          if (!loading) onCancel();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-[#111827]"
      >
        <h3 id={titleId} className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{description}</p>
        {optionalInput ? (
          <label className="mt-4 block text-xs font-bold text-slate-700 dark:text-slate-200">
            {optionalInput.label}
            <input
              value={optionalInput.value}
              placeholder={optionalInput.placeholder}
              maxLength={160}
              disabled={loading}
              onChange={(event) => optionalInput.onChange(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-700 dark:hover:text-white"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-60 ${confirmClass}`}
          >
            {loading ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
