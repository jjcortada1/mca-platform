'use client';

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, Search, X, Check } from 'lucide-react';

export interface RepOption {
  id: string;
  name: string;
  email?: string;
}

/**
 * Searchable single-select for assigning a rep to a deal/submission.
 *
 * Replaces the plain `<select>` pattern used throughout the app. The user
 * can either type to filter the rep list or scroll the dropdown. Selecting
 * an option closes the popover and fires `onChange`. Selecting "Unassigned"
 * emits an empty string so the calling code's existing "empty = null"
 * convention keeps working unchanged.
 *
 * Sized to slot into the same layout as a `<select>` (`h-9`); pass
 * `className` to override width / alignment.
 *
 * Why a custom picker vs. native <select>: a brokerage CRM grows past
 * 10–15 reps quickly, and a dropdown is unusable past that. Search-as-you-
 * type makes it a one-second action regardless of roster size.
 */
export function RepPicker({
  value,
  onChange,
  reps,
  placeholder = 'Pick a rep…',
  disabled = false,
  className,
  allowUnassigned = true,
  size = 'md',
}: {
  value: string;
  onChange: (repId: string) => void;
  reps: RepOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  allowUnassigned?: boolean;
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Auto-focus the search box when opening.
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const selected = value ? reps.find((r) => r.id === value) : null;

  // Case-insensitive match across name + email. Limit to 50 visible rows
  // so the popover stays reasonable even with massive rosters.
  const q = query.trim().toLowerCase();
  const filtered = q
    ? reps.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        (r.email ?? '').toLowerCase().includes(q)
      ).slice(0, 50)
    : reps.slice(0, 50);

  const triggerHeight = size === 'sm' ? 'h-7 text-xs' : 'h-9 text-sm';

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={cn(
          'w-full flex items-center justify-between gap-1 px-2 rounded-md border border-input bg-card disabled:opacity-50 disabled:cursor-not-allowed',
          triggerHeight,
          open && 'ring-2 ring-ring/40'
        )}
      >
        <span className={cn('truncate', !selected && 'text-muted-foreground')}>
          {selected ? selected.name : placeholder}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[200px] rounded-md border border-border bg-card shadow-lg">
          <div className="p-1.5 border-b border-border relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search reps…"
              className="h-7 w-full pl-7 pr-6 rounded text-xs bg-muted/40 border border-transparent focus:border-foreground/30 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setOpen(false); setQuery(''); }
              }}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="max-h-[260px] overflow-y-auto py-1">
            {allowUnassigned && (
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); setQuery(''); }}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-xs hover:bg-muted/40 flex items-center justify-between',
                  !value && 'text-muted-foreground font-medium'
                )}
              >
                <span>Unassigned</span>
                {!value && <Check className="h-3 w-3" />}
              </button>
            )}
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground italic">
                {q ? 'No matches' : 'No reps loaded'}
              </div>
            ) : (
              filtered.map((r) => {
                const isPicked = r.id === value;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => { onChange(r.id); setOpen(false); setQuery(''); }}
                    className={cn(
                      'w-full text-left px-3 py-1.5 text-xs hover:bg-muted/40 flex items-center justify-between gap-2',
                      isPicked && 'bg-primary/5 font-medium'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{r.name}</div>
                      {r.email && (
                        <div className="text-[10px] text-muted-foreground truncate">{r.email}</div>
                      )}
                    </div>
                    {isPicked && <Check className="h-3 w-3 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
