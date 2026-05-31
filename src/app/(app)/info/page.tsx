'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Card, CardContent,
  Button, Input, Textarea, Field, Badge, PageHeader, EmptyState,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { formatDate, cn } from '@/lib/utils';
import { Plus, Search, X, BookOpen, Hash, Trash2 } from 'lucide-react';

interface InfoEntry {
  id: string;
  title: string;
  body: string;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

const blank = (): InfoEntry => ({ id: '', title: '', body: '', category: '', createdAt: '', updatedAt: '' });

// Stable color tints per category so categories are visually distinguishable
const CAT_COLORS = [
  { ring: 'ring-blue-200',    badge: 'bg-blue-50 text-blue-700 ring-blue-200',       chip: 'bg-blue-50' },
  { ring: 'ring-violet-200',  badge: 'bg-violet-50 text-violet-700 ring-violet-200', chip: 'bg-violet-50' },
  { ring: 'ring-emerald-200', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', chip: 'bg-emerald-50' },
  { ring: 'ring-amber-200',   badge: 'bg-amber-50 text-amber-700 ring-amber-200',   chip: 'bg-amber-50' },
  { ring: 'ring-rose-200',    badge: 'bg-rose-50 text-rose-700 ring-rose-200',     chip: 'bg-rose-50' },
  { ring: 'ring-cyan-200',    badge: 'bg-cyan-50 text-cyan-700 ring-cyan-200',     chip: 'bg-cyan-50' },
  { ring: 'ring-indigo-200',  badge: 'bg-indigo-50 text-indigo-700 ring-indigo-200', chip: 'bg-indigo-50' },
];

function colorFor(cat: string | null): typeof CAT_COLORS[number] {
  if (!cat) return { ring: 'ring-border', badge: 'bg-muted text-muted-foreground ring-border', chip: 'bg-muted' };
  // Hash category to one of the palettes — stable across renders
  let h = 0;
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0;
  return CAT_COLORS[h % CAT_COLORS.length];
}

export default function InfoPage() {
  const toast = useToast();
  const [entries, setEntries] = useState<InfoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<InfoEntry | null>(null);
  const [viewing, setViewing] = useState<InfoEntry | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  async function load() {
    setLoading(true);
    const res = await fetch('/api/info');
    const json = await res.json();
    setEntries(json.data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing) return;
    const body = { title: editing.title, body: editing.body, category: editing.category };
    const res = editing.id
      ? await fetch(`/api/info/${editing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch('/api/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const j = await res.json();
      toast.error(j.error || 'Save failed.');
      return;
    }
    toast.success(editing.id ? 'Entry updated.' : 'Entry created.');
    setEditing(null);
    load();
  }

  async function del(id: string) {
    if (!confirm('Delete this entry?')) return;
    const res = await fetch(`/api/info/${id}`, { method: 'DELETE' });
    if (res.ok) toast.success('Entry deleted.');
    else toast.error('Delete failed.');
    load();
    if (editing?.id === id) setEditing(null);
  }

  const categories = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => e.category && set.add(e.category));
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!e.title.toLowerCase().includes(q) && !e.body.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [entries, categoryFilter, search]);

  // Group by category for visual sections (only when no specific filter is active)
  const grouped = useMemo(() => {
    if (categoryFilter !== 'all' || search) return null; // when filtering, just show flat grid
    const map = new Map<string, InfoEntry[]>();
    for (const e of filtered) {
      const cat = e.category || 'Uncategorized';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(e);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Uncategorized') return 1;
      if (b === 'Uncategorized') return -1;
      return a.localeCompare(b);
    });
  }, [filtered, categoryFilter, search]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Knowledge Base"
        description="Internal notes, scripts, funder quirks, and process docs."
        actions={
          <Button onClick={() => setEditing(blank())} className="gap-1.5">
            <Plus className="h-4 w-4" /> New entry
          </Button>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setCategoryFilter('all')}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all',
            categoryFilter === 'all'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
          )}
        >
          <span>All</span>
          <span className={cn('tabular-nums px-1.5 py-0.5 rounded text-[10px]', categoryFilter === 'all' ? 'bg-primary-foreground/20' : 'bg-muted')}>
            {entries.length}
          </span>
        </button>
        {categories.map((c) => {
          const count = entries.filter((e) => e.category === c).length;
          const palette = colorFor(c);
          return (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all',
                categoryFilter === c
                  ? 'bg-primary text-primary-foreground border-primary'
                  : `bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30`,
              )}
            >
              <Hash className={cn('h-3 w-3', categoryFilter !== c && 'text-muted-foreground/60')} />
              <span>{c}</span>
              <span className={cn('tabular-nums px-1.5 py-0.5 rounded text-[10px]', categoryFilter === c ? 'bg-primary-foreground/20' : palette.chip)}>
                {count}
              </span>
            </button>
          );
        })}
        <div className="ml-auto relative w-full sm:w-auto sm:min-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search title or content…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={BookOpen}
              title="No entries yet"
              description={search || categoryFilter !== 'all' ? 'Try changing your filters.' : 'Capture funder quirks, scripts, and process notes here so the team has a single source of truth.'}
              action={!search && categoryFilter === 'all' ? <Button onClick={() => setEditing(blank())}>Create first entry</Button> : undefined}
            />
          </CardContent>
        </Card>
      ) : grouped ? (
        <div className="space-y-8">
          {grouped.map(([cat, items]) => (
            <section key={cat}>
              <div className="flex items-baseline justify-between mb-3 px-0.5">
                <div className="flex items-baseline gap-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground/80">{cat}</h2>
                  <span className="text-xs text-muted-foreground">{items.length} {items.length === 1 ? 'entry' : 'entries'}</span>
                </div>
              </div>
              <Grid items={items} onOpen={setViewing} />
            </section>
          ))}
        </div>
      ) : (
        <Grid items={filtered} onOpen={setViewing} />
      )}

      {editing && (
        <EditorDrawer
          entry={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={editing.id ? () => del(editing.id) : undefined}
          existingCategories={categories}
        />
      )}

      {viewing && (
        <QuickView
          entry={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing(viewing); setViewing(null); }}
          onDelete={() => { del(viewing.id); setViewing(null); }}
        />
      )}
    </div>
  );
}

function Grid({ items, onOpen }: { items: InfoEntry[]; onOpen: (e: InfoEntry) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((e) => {
        const palette = colorFor(e.category);
        return (
          <button
            key={e.id}
            onClick={() => onOpen(e)}
            className={cn(
              'text-left rounded-lg border bg-card p-4 transition-all hover:shadow-md hover:-translate-y-0.5',
              'border-border hover:border-foreground/20',
              'flex flex-col h-full min-h-[160px]'
            )}
          >
            {e.category && (
              <div className="mb-2">
                <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ring-1', palette.badge)}>
                  <Hash className="h-2.5 w-2.5" />
                  {e.category}
                </span>
              </div>
            )}
            <div className="text-sm font-semibold leading-snug mb-1.5 line-clamp-2">{e.title || '(untitled)'}</div>
            <div className="text-xs text-muted-foreground line-clamp-4 leading-relaxed flex-1 whitespace-pre-wrap">
              {e.body || <span className="italic">empty</span>}
            </div>
            <div className="mt-3 pt-2 border-t border-border/50 text-[10px] text-muted-foreground/70 tabular-nums">
              Updated {formatDate(e.updatedAt)}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function EditorDrawer({
  entry, onChange, onClose, onSave, onDelete, existingCategories,
}: {
  entry: InfoEntry;
  onChange: (e: InfoEntry) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  existingCategories: string[];
}) {
  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-card border-l border-border h-full overflow-y-auto shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-base font-semibold">{entry.id ? 'Edit entry' : 'New entry'}</h2>
          <div className="flex items-center gap-2">
            {onDelete && (
              <Button variant="ghost" size="sm" onClick={onDelete} className="gap-1.5 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={onSave} disabled={!entry.title.trim() || !entry.body.trim()}>Save</Button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1.5 rounded ml-1">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 p-6 space-y-4">
          <Field label="Title" required>
            <Input
              value={entry.title}
              onChange={(ev) => onChange({ ...entry, title: ev.target.value })}
              placeholder="e.g. How Velocity Capital handles trucking deals"
              autoFocus
            />
          </Field>

          <Field label="Category" hint="Group similar entries — used for visual grouping in the dashboard.">
            <Input
              value={entry.category ?? ''}
              onChange={(ev) => onChange({ ...entry, category: ev.target.value })}
              placeholder="e.g. Funder process, Scripts, Compliance"
              list="info-categories"
            />
            <datalist id="info-categories">
              {existingCategories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </Field>

          <Field label="Body" required>
            <Textarea
              rows={18}
              value={entry.body}
              onChange={(ev) => onChange({ ...entry, body: ev.target.value })}
              placeholder="Use plain text. Newlines preserved when displayed."
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   QUICK VIEW — read-only centered modal. Renders URLs as clickable links.
   ============================================================ */
function QuickView({
  entry,
  onClose,
  onEdit,
  onDelete,
}: {
  entry: InfoEntry;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // Close on Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const palette = colorFor(entry.category);

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {entry.category && (
              <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ring-1 mb-2', palette.badge)}>
                <Hash className="h-2.5 w-2.5" />
                {entry.category}
              </span>
            )}
            <h2 className="text-lg font-semibold leading-tight">{entry.title || '(untitled)'}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <RichBody text={entry.body} />
        </div>

        <div className="border-t border-border px-6 py-3 flex items-center justify-between bg-muted/30">
          <div className="text-[11px] text-muted-foreground">Updated {formatDate(entry.updatedAt)}</div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onDelete} className="gap-1.5 text-muted-foreground hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
            <Button size="sm" onClick={onEdit}>Edit</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   RICH BODY — preserve newlines + auto-link URLs and emails.
   ============================================================ */
function RichBody({ text }: { text: string }) {
  if (!text) return <div className="text-sm italic text-muted-foreground">empty</div>;
  return (
    <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
      {text.split('\n').map((line, i) => (
        <div key={i}>{linkify(line)}</div>
      ))}
    </div>
  );
}

/**
 * Convert a string into an array of React nodes where any URL or email
 * becomes a clickable <a>. Non-URL text is left as plain strings.
 */
function linkify(line: string): React.ReactNode[] {
  if (!line) return [<br key="br" />];
  // URL regex: https?, www., or bare domain.tld + paths; also raw emails.
  const re = /\b((https?:\/\/[^\s<>]+|www\.[^\s<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}))/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const match = m[0];
    if (match.includes('@') && !match.startsWith('http')) {
      out.push(
        <a key={`a${key++}`} href={`mailto:${match}`} className="text-foreground font-medium underline decoration-foreground/30 hover:decoration-foreground transition-colors">
          {match}
        </a>
      );
    } else {
      const href = match.startsWith('http') ? match : `https://${match}`;
      out.push(
        <a
          key={`a${key++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground font-medium underline decoration-foreground/30 hover:decoration-foreground transition-colors break-all"
        >
          {match}
        </a>
      );
    }
    last = m.index + match.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}
