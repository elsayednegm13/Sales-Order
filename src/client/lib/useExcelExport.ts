import { useCallback, useRef, useState } from 'react';

/** Blocks a second Excel export while the first dynamic library load is still running. */
export function useExcelExport() {
  const exportingRef = useRef(false);
  const [isExporting, setIsExporting] = useState(false);

  const runExport = useCallback(async (task: () => Promise<void>) => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setIsExporting(true);
    try {
      await task();
    } finally {
      exportingRef.current = false;
      setIsExporting(false);
    }
  }, []);

  return { isExporting, runExport };
}
