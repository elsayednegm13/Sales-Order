import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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

interface MenuBox {
  left: number;
  width: number;
  maxHeight: number;
  top: number | null;
  bottom: number | null;
}

const MENU_MAX = 256;
const MENU_MIN = 120;
const FLIP_ROOM = 180;

function placeMenu(anchor: HTMLElement): MenuBox {
  const rect = anchor.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - 8;
  const spaceAbove = rect.top - 8;
  const openDown = spaceBelow >= Math.min(MENU_MAX, spaceBelow) && (spaceBelow >= FLIP_ROOM || spaceBelow >= spaceAbove);
  const available = openDown ? spaceBelow : spaceAbove;
  return {
    left: rect.left,
    width: rect.width,
    maxHeight: Math.min(MENU_MAX, Math.max(MENU_MIN, available)),
    top: openDown ? rect.bottom + 4 : null,
    bottom: openDown ? null : window.innerHeight - rect.top + 4,
  };
}

function anchorOffscreen(anchor: HTMLElement): boolean {
  const rect = anchor.getBoundingClientRect();
  return rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth;
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
  const [box, setBox] = useState<MenuBox | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return items.slice(0, 12);
    return items.filter((item) => filter(item, term)).slice(0, 12);
  }, [filter, items, query]);

  const typedQuery = query.trim();
  const showQuickAdd = Boolean(typedQuery) && (quickAddWhen === 'always' || matches.length === 0);
  const addLabel = showQuickAdd ? quickAddLabel?.(typedQuery) ?? null : null;
  const optionCount = matches.length + (addLabel ? 1 : 0);

  const updatePosition = useCallback(() => {
    const anchor = inputRef.current;
    if (!anchor) return;
    if (anchorOffscreen(anchor)) {
      setOpen(false);
      return;
    }
    setBox(placeMenu(anchor));
  }, []);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }
    updatePosition();
  }, [open, optionCount, updatePosition]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const handleScroll = (event: Event) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return;
      const anchor = inputRef.current;
      if (!anchor || anchorOffscreen(anchor)) {
        setOpen(false);
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePosition);
    };
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open || !menuRef.current) return;
    const menu = menuRef.current;
    const option = menu.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`);
    if (!option) return;
    const optionTop = option.offsetTop;
    const optionBottom = optionTop + option.offsetHeight;
    if (optionTop < menu.scrollTop) menu.scrollTop = optionTop;
    else if (optionBottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = optionBottom - menu.clientHeight;
  }, [activeIndex, open, box]);

  const choose = (item: T) => {
    onSelect(item);
    setQuery('');
    setOpen(false);
  };

  const menu = open && box && typeof document !== 'undefined'
    ? createPortal(
      <ul
        ref={menuRef}
        id={listId}
        role="listbox"
        dir="rtl"
        style={{
          position: 'fixed',
          left: box.left,
          width: box.width,
          maxHeight: box.maxHeight,
          top: box.top ?? undefined,
          bottom: box.bottom ?? undefined,
        }}
        className="no-print z-[70] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
      >
        {matches.map((item, index) => (
          <li key={getKey(item)}>
            <button
              type="button"
              role="option"
              data-option-index={index}
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(item)}
              className={`block w-full px-3 py-2 text-right text-sm ${
                index === activeIndex ? 'bg-blue-50 text-blue-900 dark:bg-blue-950/60 dark:text-blue-100' : 'text-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 dark:hover:text-white'
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
              data-option-index={matches.length}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onQuickAdd?.(query.trim());
                setOpen(false);
                setQuery('');
              }}
              className={`block w-full px-3 py-2 text-right text-sm font-bold text-blue-700 dark:text-blue-300 ${
                activeIndex === matches.length ? 'bg-blue-50 dark:bg-blue-950/60' : 'dark:hover:bg-slate-700 dark:hover:text-white'
              }`}
            >
              {addLabel}
            </button>
          </li>
        )}
        {matches.length === 0 && !addLabel && (
          <li className="px-3 py-2 text-xs text-slate-500">لا توجد نتائج</li>
        )}
      </ul>,
      document.body,
    )
    : null;

  return (
    <div ref={rootRef} className="relative">
      {label ? <span className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-200">{label}</span> : null}
      <input
        ref={inputRef}
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
      {menu}
    </div>
  );
}
