'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Briefcase, Users as UsersIcon, GitBranch, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ============================================================
   Global search — a ⌘K / Ctrl-K command palette that searches
   deals, funders, people, and lead sources (server-scoped to
   what the user may see). Also opened by the sidebar Search button
   via the 'mca:open-search' custom event.
   ============================================================ */

interface Result {
  type: 'deal' | 'funder' | 'person' | 'lead_source';
  id: string;
  label: string;
  sublabel?: string;
  href: string;
}

const TYPE_META: Record<Result['type'], { icon: React.ComponentType<{ className?: string }>; group: string }> = {
  deal:        { icon: Briefcase,  group: 'Deals' },
  funder:      { icon: UsersIcon,  group: 'Funders' },
  person:      { icon: UsersIcon,  group: 'People' },
  lead_source: { icon: GitBranch,  group: 'Lead sources' },
};

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const close = useCallback(() => { setOpen(false); setQ(''); setResults([]); setActive(0); }, []);

  // Open on ⌘K / Ctrl-K, and on the custom event from the sidebar button.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    function onOpen() { setOpen(true); }
    document.addEventListener('keydown', onKey);
    window.addEventListener('mca:open-search', onOpen as EventListener);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('mca:open-search', onOpen as EventListener);
    };
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { cache: 'no-store' });
        const j = await r.json();
        if (mine === seq.current) { setResults(j.data ?? []); setActive(0); }
      } catch {
        if (mine === seq.current) setResults([]);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  function go(r: Result) {
    close();
    router.push(r.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active]); }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center p-4 pt-[12vh]" onClick={close}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in" />
      <div
        className="relative w-full max-w-xl bg-card rounded-xl border border-border [box-shadow:var(--shadow-xl)] animate-modal-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search deals, funders, people…"
            className="flex-1 h-12 bg-transparent text-sm focus:outline-none"
          />
          <button onClick={close} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {q.trim().length < 2 ? (
            <div className="px-4 py-6 text-xs text-muted-foreground text-center">Type at least 2 characters to search.</div>
          ) : loading && results.length === 0 ? (
            <div className="px-4 py-6 text-xs text-muted-foreground text-center">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-6 text-xs text-muted-foreground text-center">No matches for “{q.trim()}”.</div>
          ) : (
            <ResultList results={results} active={active} setActive={setActive} onPick={go} />
          )}
        </div>

        <div className="px-4 py-2 border-t border-border text-[10px] text-muted-foreground flex items-center gap-3">
          <span>↑↓ to navigate</span><span>↵ to open</span><span>esc to close</span>
        </div>
      </div>
    </div>
  );
}

function ResultList({
  results, active, setActive, onPick,
}: {
  results: Result[];
  active: number;
  setActive: (i: number) => void;
  onPick: (r: Result) => void;
}) {
  // Render grouped by type, but keep a flat index for keyboard nav.
  let flatIdx = -1;
  const groups: Result['type'][] = ['deal', 'funder', 'person', 'lead_source'];
  return (
    <div className="py-1">
      {groups.map((g) => {
        const items = results.filter((r) => r.type === g);
        if (!items.length) return null;
        return (
          <div key={g}>
            <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {TYPE_META[g].group}
            </div>
            {items.map((r) => {
              flatIdx += 1;
              const idx = flatIdx;
              const Icon = TYPE_META[r.type].icon;
              return (
                <button
                  key={`${r.type}-${r.id}`}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => onPick(r)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-2 text-left text-sm',
                    idx === active ? 'bg-muted' : 'hover:bg-muted/50'
                  )}
                >
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-medium">{r.label}</span>
                    {r.sublabel && <span className="block truncate text-[11px] text-muted-foreground">{r.sublabel}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
