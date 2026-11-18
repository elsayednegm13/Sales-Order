import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

interface SearchComboboxProps<T> {
  label: string;
  placeholder: string;
  items: T[];
  selectedKey: string;
  selectedLabel: string;
  filter: (item: T, query: string) => boolean;
  getKey: (item: T) => string;
  renderOption: (item: T) => ReactNode;
  onSelect: (item: T) => void;
  quickAddLabel?: (query: string) => string | null;
  quickAddWhen?: 'empty' | 'always';
  onQuickAdd?: (query: string) => void;
  dense?: boolean;
}

export function SearchCombobox<T>({
  label,
  placeholder,
  items,
  selectedKey,
  selectedLabel,
  filter,
  getKey,
  renderOption,
  onSelect,
  quickAddLabel,
  quickAddWhen = 'empty',
  onQuickAdd,
  dense = false,
}: SearchComboboxProps<T>) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return items.slice(0, 12);
    return items.filter((item) => filter(item, term)).slice(0, 12);
  }, [filter, items, query]);

  const typedQuery = query.trim();
  const showQuickAdd = Boolean(typedQuery) && (quickAddWhen === 'always' || matches.length === 0);
  const addLabel = showQuickAdd ? quickAddLabel?.(typedQuery) ?? null : null;
  const optionCount = matches.length + (addLabel ? 1 : 0);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const choose = (item: T) => {
    onSelect(item);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      {label ? <span className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-200">{label}</span> : null}
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={open ? query : selectedLabel}
        placeholder={selectedKey ? selectedLabel : placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) => Math.min(optionCount - 1, index + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index) => Math.max(0, index - 1));
          } else if (event.key === 'Enter' && open) {
            event.preventDefault();
            if (activeIndex < matches.length && matches[activeIndex]) {
              choose(matches[activeIndex]);
            } else if (addLabel) {
              onQuickAdd?.(query.trim());
              setOpen(false);
            }
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        className={dense
          ? 'h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
          : 'h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {matches.map((item, index) => (
            <li key={getKey(item)}>
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(item)}
                className={`block w-full px-3 py-2 text-right text-sm ${
                  index === activeIndex ? 'bg-blue-50 text-blue-900 dark:bg-blue-950/60 dark:text-blue-100' : 'text-slate-800 dark:text-slate-100'
                }`}
              >
                {renderOption(item)}
              </button>
            </li>
          ))}
          {addLabel && (
            <li>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onQuickAdd?.(query.trim());
                  setOpen(false);
                  setQuery('');
                }}
                className={`block w-full px-3 py-2 text-right text-sm font-bold text-blue-700 dark:text-blue-300 ${
                  activeIndex === matches.length ? 'bg-blue-50 dark:bg-blue-950/60' : ''
                }`}
              >
                {addLabel}
              </button>
            </li>
          )}
          {matches.length === 0 && !addLabel && (
            <li className="px-3 py-2 text-xs text-slate-500">لا توجد نتائج</li>
          )}
        </ul>
      )}
    </div>
  );
}
