'use client';

/**
 * Searchable deal picker.
 *
 * Replaces the `<select>` dropdown used to assign / attach a deal to a
 * commission, payment, or accounting entry. With dozens or hundreds of
 * deals in the dropdown, scrolling becomes painful — this lets the user
 * type to filter by deal name or merchant name and click to select.
 *
 * Contract: same as a controlled `<select>` — `value` is the dealId
 * (empty string = nothing selected) and `onChange` fires with the new
 * dealId string.
 *
 * No external dependencies: pure React, click-outside via a ref, simple
 * substring match (case-insensitive, normalized).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface DealOption {
  id: string;
  name: string;
  merchantFirstName?: string | null;
  merchantLastName?: string | null;
  status?: string | null;
}

export function SearchableDealSelect({
  value,
  onChange,
  deals,
  placeholder = 'Search deals…',
  disabled,
  className,
}: {
  value: string;
  onChange: (dealId: string) => void;
  deals: DealOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Display label for the currently-selected deal — shown when the picker
  // is collapsed. Search by id so we can resolve even if the list changes.
  const selectedDeal = useMemo(
    () => (value ? deals.find((d) => d.id === value) ?? null : null),
    [value, deals],
  );

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Filter deals by query — match deal name OR merchant name (first/last
  // concatenated). Empty query shows everything. Case-insensitive.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return deals;
    return deals.filter((d) => {
      const merchant = [d.merchantFirstName, d.merchantLastName].filter(Boolean).join(' ').toLowerCase();
      return d.name.toLowerCase().includes(q) || merchant.includes(q);
    });
  }, [deals, query]);

  function pick(d: DealOption) {
    onChange(d.id);
    setOpen(false);
    setQuery('');
  }

  function clear() {
    onChange('');
    setQuery('');
    setOpen(false);
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {!open ? (
        // Collapsed state — looks like a normal select. Click opens the
        // search input below. Shows the selected deal's name + merchant
        // sub-line for context (helps disambiguate multiple deals with
        // similar names).
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setOpen(true);
            // Defer focus so the input exists when we focus it.
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-md border border-input bg-card px-3 py-1 text-sm transition-colors',
            'hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
            'disabled:cursor-not-allowed disabled:opacity-50',
            !selectedDeal && 'text-muted-foreground',
          )}
        >
          <span className="truncate text-left">
            {selectedDeal ? (
              <>
                <span className="text-foreground">{selectedDeal.name}</span>
                {(selectedDeal.merchantFirstName || selectedDeal.merchantLastName) && (
                  <span className="text-muted-foreground ml-2">
                    · {[selectedDeal.merchantFirstName, selectedDeal.merchantLastName].filter(Boolean).join(' ')}
                  </span>
                )}
              </>
            ) : placeholder}
          </span>
          <span className="text-muted-foreground text-xs ml-2 shrink-0">▼</span>
        </button>
      ) : (
        // Open state — search input + filtered results in a dropdown.
        // Pressing Esc closes; Enter picks the first result.
        <>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setOpen(false); setQuery(''); }
              if (e.key === 'Enter' && filtered.length > 0) {
                e.preventDefault();
                pick(filtered[0]);
              }
            }}
            placeholder={placeholder}
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          {/* Dropdown panel — positioned absolutely below the input so it
              doesn't shift layout. Max-height limits enormous lists. */}
          <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-card shadow-lg max-h-72 overflow-y-auto">
            {value && (
              <button
                type="button"
                onClick={clear}
                className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-muted border-b border-border"
              >
                Clear selection
              </button>
            )}
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-muted-foreground italic">No deals match &quot;{query}&quot;</div>
            ) : (
              filtered.slice(0, 100).map((d) => {
                const merchant = [d.merchantFirstName, d.merchantLastName].filter(Boolean).join(' ');
                const isSelected = d.id === value;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => pick(d)}
                    className={cn(
                      'w-full text-left px-3 py-2 text-sm hover:bg-muted',
                      isSelected && 'bg-primary/5',
                    )}
                  >
                    <div className="font-medium truncate">{d.name}</div>
                    {(merchant || d.status) && (
                      <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                        {merchant && <span className="truncate">{merchant}</span>}
                        {d.status && <span className="uppercase tracking-wider text-[9px]">{d.status}</span>}
                      </div>
                    )}
                  </button>
                );
              })
            )}
            {filtered.length > 100 && (
              <div className="px-3 py-2 text-[10px] text-muted-foreground italic border-t border-border">
                Showing first 100 matches — type more to narrow.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
