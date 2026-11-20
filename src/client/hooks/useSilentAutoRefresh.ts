import { useEffect, useRef } from 'react';

const INTERVAL_MS = 15_000;
const RETURN_COOLDOWN_MS = 3_000;

function inputIsActive(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  const tag = active.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function canRun(paused: boolean): boolean {
  if (paused) return false;
  if (document.visibilityState !== 'visible') return false;
  if (!navigator.onLine) return false;
  if (inputIsActive()) return false;
  return true;
}

export function useSilentAutoRefresh(options: {
  paused: boolean;
  resetKey?: string | number;
  onTick: (signal: AbortSignal) => Promise<void>;
}): void {
  const pausedRef = useRef(options.paused);
  const onTickRef = useRef(options.onTick);
  const lastCheckRef = useRef(Date.now());
  const inflightRef = useRef<AbortController | null>(null);
  pausedRef.current = options.paused;
  onTickRef.current = options.onTick;

  useEffect(() => {
    inflightRef.current?.abort();
    inflightRef.current = null;
  }, [options.resetKey]);

  useEffect(() => {
    if (options.paused) {
      inflightRef.current?.abort();
      inflightRef.current = null;
    }
  }, [options.paused]);

  useEffect(() => {
    let stopped = false;

    const run = () => {
      if (stopped || inflightRef.current) return;
      if (!canRun(pausedRef.current)) return;
      const controller = new AbortController();
      inflightRef.current = controller;
      lastCheckRef.current = Date.now();
      void onTickRef.current(controller.signal)
        .catch(() => {
          // Background checks stay silent. The next tick retries.
        })
        .finally(() => {
          if (inflightRef.current === controller) inflightRef.current = null;
        });
    };

    const onReturn = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastCheckRef.current < RETURN_COOLDOWN_MS) return;
      run();
    };

    const timer = window.setInterval(run, INTERVAL_MS);
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
      inflightRef.current?.abort();
      inflightRef.current = null;
    };
  }, []);
}
