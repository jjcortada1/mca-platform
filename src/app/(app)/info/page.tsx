'use client';

import { useEffect, useState } from 'react';
import {
  Card, CardContent,
  Button, Input, Textarea, Field, Badge,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { formatDate } from '@/lib/utils';

interface InfoEntry {
  id: string;
  title: string;
  body: string;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

const blank = (): InfoEntry => ({ id: '', title: '', body: '', category: '', createdAt: '', updatedAt: '' });

export default function InfoPage() {
  const toast = useToast();
  const [entries, setEntries] = useState<InfoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<InfoEntry | null>(null);
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
      ? await fetch(`/api/info/${editing.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
      : await fetch('/api/info', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
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
  }

  const categories = Array.from(new Set(entries.map((e) => e.category).filter(Boolean) as string[]));
  const filtered = entries.filter((e) => {
    if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
    if (search && !e.title.toLowerCase().includes(search.toLowerCase()) && !e.body.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6 p-6 max-w-5xl">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Info</h1>
          <p className="text-sm text-muted-foreground mt-1">Internal knowledge base — funder quirks, processes, scripts.</p>
        </div>
        <Button onClick={() => setEditing(blank())}>+ New entry</Button>
      </header>

      <div className="flex items-center gap-3">
        <Input
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`px-3 py-1 rounded text-xs ${categoryFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`px-3 py-1 rounded text-xs ${categoryFilter === c ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">No entries.</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((e) => (
            <Card key={e.id} className="cursor-pointer hover:bg-muted/30 transition" onClick={() => setEditing(e)}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between mb-1">
                  <h3 className="font-medium">{e.title}</h3>
                  <div className="flex items-center gap-2">
                    {e.category && <Badge variant="outline">{e.category}</Badge>}
                    <span className="text-xs text-muted-foreground">{formatDate(e.updatedAt)}</span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 whitespace-pre-wrap">{e.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-40 flex justify-end" onClick={() => setEditing(null)}>
          <div
            className="w-full max-w-2xl bg-background border-l border-border h-full overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-semibold">{editing.id ? 'Edit entry' : 'New entry'}</h2>
              <div className="flex gap-2">
                {editing.id && <Button variant="ghost" size="sm" onClick={() => del(editing.id)}>Delete</Button>}
                <Button variant="outline" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                <Button size="sm" onClick={save}>Save</Button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <Field label="Title" required>
                <Input value={editing.title} onChange={(ev) => setEditing({ ...editing, title: ev.target.value })} />
              </Field>
              <Field label="Category">
                <Input
                  value={editing.category ?? ''}
                  onChange={(ev) => setEditing({ ...editing, category: ev.target.value })}
                  placeholder="e.g. Funder process, Scripts, Compliance"
                />
              </Field>
              <Field label="Body" required>
                <Textarea
                  rows={20}
                  value={editing.body}
                  onChange={(ev) => setEditing({ ...editing, body: ev.target.value })}
                />
              </Field>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
