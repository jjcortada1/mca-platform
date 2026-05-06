'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card, CardContent,
  Button, Input, Textarea, Field, Badge,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { formatDate } from '@/lib/utils';

interface Deal {
  id: string;
  name: string;
  merchantFirstName: string | null;
  merchantLastName: string | null;
  merchantEmail: string | null;
  merchantPhone: string | null;
  offerNotes: string | null;
  assignedRepId: string | null;
  status: 'shopping' | 'submitted' | 'active' | 'funded' | 'dead';
  createdAt: string;
  updatedAt: string;
}

const blankDeal = (): Deal => ({
  id: '',
  name: '',
  merchantFirstName: '',
  merchantLastName: '',
  merchantEmail: '',
  merchantPhone: '',
  offerNotes: '',
  assignedRepId: null,
  status: 'shopping',
  createdAt: '',
  updatedAt: '',
});

export default function ActiveDealsPage() {
  const toast = useToast();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [reps, setReps] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Deal | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  async function load() {
    setLoading(true);
    const [dRes, uRes] = await Promise.all([
      fetch('/api/deals').then((r) => r.json()),
      fetch('/api/users').then((r) => r.json()).catch(() => ({ data: [] })),
    ]);
    setDeals(dRes.data ?? dRes ?? []);
    setReps((uRes.data ?? []).filter((u: { role: string }) => u.role !== 'master_admin'));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing) return;
    const body = {
      name: editing.name,
      merchantFirstName: editing.merchantFirstName,
      merchantLastName: editing.merchantLastName,
      merchantEmail: editing.merchantEmail,
      merchantPhone: editing.merchantPhone,
      offerNotes: editing.offerNotes,
      assignedRepId: editing.assignedRepId,
      status: editing.status,
    };
    const res = editing.id
      ? await fetch(`/api/deals/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      : await fetch('/api/deals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
    if (!res.ok) {
      const j = await res.json();
      toast.error(j.error || 'Save failed.');
      return;
    }
    toast.success(editing.id ? 'Deal updated.' : 'Deal created.');
    setEditing(null);
    load();
  }

  async function del(id: string) {
    if (!confirm('Delete this deal? This cannot be undone.')) return;
    const res = await fetch(`/api/deals/${id}`, { method: 'DELETE' });
    if (res.ok) toast.success('Deal deleted.');
    else toast.error('Delete failed.');
    load();
  }

  const filtered = statusFilter === 'all' ? deals : deals.filter((d) => d.status === statusFilter);
  const statusCounts = deals.reduce((acc, d) => {
    acc[d.status] = (acc[d.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Active Deals</h1>
          <p className="text-sm text-muted-foreground mt-1">All deals in your pipeline.</p>
        </div>
        <Button onClick={() => setEditing(blankDeal())}>+ New deal</Button>
      </header>

      <div className="flex gap-1 flex-wrap">
        {['all', 'shopping', 'submitted', 'active', 'funded', 'dead'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded text-xs ${statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
          >
            {s} {s === 'all' ? `(${deals.length})` : statusCounts[s] ? `(${statusCounts[s]})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="data-grid w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Deal</th>
                  <th className="px-4 py-2 font-medium">Merchant</th>
                  <th className="px-4 py-2 font-medium">Rep</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No deals.</td></tr>
                ) : filtered.map((d) => {
                  const repName = d.assignedRepId ? reps.find((r) => r.id === d.assignedRepId)?.name : '—';
                  return (
                    <tr
                      key={d.id}
                      className="border-b border-border hover:bg-muted/30 cursor-pointer"
                      onClick={() => setEditing(d)}
                    >
                      <td className="px-4 py-3 font-medium">{d.name}</td>
                      <td className="px-4 py-3">{[d.merchantFirstName, d.merchantLastName].filter(Boolean).join(' ') || '—'}</td>
                      <td className="px-4 py-3">{repName ?? '—'}</td>
                      <td className="px-4 py-3">
                        <Badge variant={
                          d.status === 'funded' ? 'success' :
                          d.status === 'dead' ? 'destructive' :
                          d.status === 'active' ? 'default' : 'outline'
                        }>{d.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(d.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/deal-shop/submit?dealId=${d.id}`}
                          className="text-xs text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Shop →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-40 flex justify-end" onClick={() => setEditing(null)}>
          <div
            className="w-full max-w-xl bg-background border-l border-border h-full overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-semibold">{editing.id ? 'Edit deal' : 'New deal'}</h2>
              <div className="flex gap-2">
                {editing.id && <Button variant="ghost" size="sm" onClick={() => del(editing.id)}>Delete</Button>}
                <Button variant="outline" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                <Button size="sm" onClick={save}>Save</Button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <Field label="Deal name" required>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Merchant first name">
                  <Input
                    value={editing.merchantFirstName ?? ''}
                    onChange={(e) => setEditing({ ...editing, merchantFirstName: e.target.value })}
                  />
                </Field>
                <Field label="Merchant last name">
                  <Input
                    value={editing.merchantLastName ?? ''}
                    onChange={(e) => setEditing({ ...editing, merchantLastName: e.target.value })}
                  />
                </Field>
                <Field label="Email">
                  <Input
                    value={editing.merchantEmail ?? ''}
                    onChange={(e) => setEditing({ ...editing, merchantEmail: e.target.value })}
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    value={editing.merchantPhone ?? ''}
                    onChange={(e) => setEditing({ ...editing, merchantPhone: e.target.value })}
                  />
                </Field>
                <Field label="Status">
                  <select
                    value={editing.status}
                    onChange={(e) => setEditing({ ...editing, status: e.target.value as Deal['status'] })}
                    className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="shopping">Shopping</option>
                    <option value="submitted">Submitted</option>
                    <option value="active">Active</option>
                    <option value="funded">Funded</option>
                    <option value="dead">Dead</option>
                  </select>
                </Field>
                <Field label="Assigned rep">
                  <select
                    value={editing.assignedRepId ?? ''}
                    onChange={(e) => setEditing({ ...editing, assignedRepId: e.target.value || null })}
                    className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">— unassigned —</option>
                    {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </Field>
              </div>

              <Field label="Offer notes">
                <Textarea
                  rows={5}
                  value={editing.offerNotes ?? ''}
                  onChange={(e) => setEditing({ ...editing, offerNotes: e.target.value })}
                />
              </Field>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
