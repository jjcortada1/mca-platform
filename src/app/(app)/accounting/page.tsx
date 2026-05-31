'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, Button, Input, Field, Badge, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { formatCurrency } from '@/lib/utils';
import { Search, Download } from 'lucide-react';
import { exportCSV } from '@/lib/csv-export';

interface Entry {
  id: string;
  dealId: string | null;
  entryType: 'received' | 'sent_back';
  amount: string;
  entryDate: string;
  method: string | null;
  referenceNumber: string | null;
  notes: string | null;
  createdAt: string;
  dealName: string | null;
  createdByName: string | null;
}

interface DealOpt { id: string; name: string }

const METHODS = ['ach', 'wire', 'check', 'cash', 'zelle', 'other'] as const;
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

export default function AccountingPage() {
  const toast = useToast();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [deals, setDeals] = useState<DealOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'received' | 'sent_back'>('all');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [a, d] = await Promise.all([
        fetch('/api/accounting').then((r) => r.json()),
        fetch('/api/deals').then((r) => r.json()),
      ]);
      setEntries(a.entries ?? []);
      setDeals((d.data ?? d.deals ?? []).map((x: DealOpt) => ({ id: x.id, name: x.name })));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let arr = entries;
    if (filter !== 'all') arr = arr.filter((e) => e.entryType === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter((e) =>
        (e.dealName ?? '').toLowerCase().includes(q) ||
        (e.referenceNumber ?? '').toLowerCase().includes(q) ||
        (e.notes ?? '').toLowerCase().includes(q));
    }
    return arr;
  }, [entries, filter, search]);

  const totals = useMemo(() => {
    let received = 0, sent = 0;
    for (const e of entries) {
      const a = Number(e.amount);
      if (e.entryType === 'received') received += a;
      else sent += a;
    }
    return { received, sent, net: received - sent, count: entries.length };
  }, [entries]);

  async function remove(e: Entry) {
    if (!confirm(`Delete ${e.entryType === 'received' ? 'received' : 'sent back'} entry of ${formatCurrency(Number(e.amount))}?`)) return;
    const res = await fetch(`/api/accounting/${e.id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Delete failed'); return; }
    toast.success('Removed.'); load();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Accounting"
        description="Track money received from funders and money sent back (clawbacks/refunds). Each entry can be tied to a specific deal."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => exportCSV('accounting', filtered, [
                { key: 'entryDate', label: 'Date', format: (v) => (v ? new Date(v as string).toISOString().slice(0, 10) : '') },
                { key: 'entryType', label: 'Type' },
                { key: 'amount', label: 'Amount', format: (v) => (v ? Number(v) : 0) },
                { key: 'dealName', label: 'Deal' },
                { key: 'method', label: 'Method' },
                { key: 'referenceNumber', label: 'Reference #' },
                { key: 'notes', label: 'Notes' },
                { key: 'createdByName', label: 'Created By' },
                { key: 'createdAt', label: 'Created At', format: (v) => (v ? new Date(v as string).toISOString().slice(0, 10) : '') },
              ])}
              disabled={filtered.length === 0}
              className="gap-1.5"
            >
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button onClick={() => setCreating(true)}>+ New entry</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Entries" value={String(totals.count)} />
        <Tile label="Money received" value={formatCurrency(totals.received)} tone="success" />
        <Tile label="Money sent back" value={formatCurrency(totals.sent)} tone="danger" />
        <Tile label="Net" value={formatCurrency(totals.net)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([['all', 'All'], ['received', 'Received'], ['sent_back', 'Sent back']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-3 py-1.5 rounded-full border text-xs font-medium transition ${filter === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:text-foreground'}`}>
            {label}
          </button>
        ))}
        <div className="ml-auto relative w-full sm:w-auto sm:min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search deal, reference, notes…" className="pl-9" />
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No accounting entries yet.</CardContent></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead><tr className="bg-muted/40 border-b border-border text-left">
                <th className="px-4 py-2 th">Date</th>
                <th className="px-3 py-2 th">Type</th>
                <th className="px-3 py-2 th text-right">Amount</th>
                <th className="px-3 py-2 th">Deal</th>
                <th className="px-3 py-2 th">Method</th>
                <th className="px-3 py-2 th">Reference</th>
                <th className="px-3 py-2 th">Notes</th>
                <th className="px-3 py-2 th">Created by</th>
                <th className="w-32"></th>
              </tr></thead>
              <tbody className="divide-y divide-border/60">
                {filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{fmtDate(e.entryDate)}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant={e.entryType === 'received' ? 'success' : 'destructive'} className="text-[10px]">
                        {e.entryType === 'received' ? 'Received' : 'Sent back'}
                      </Badge>
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${e.entryType === 'received' ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {e.entryType === 'received' ? '+' : '−'}{formatCurrency(Number(e.amount))}
                    </td>
                    <td className="px-3 py-2.5">{e.dealName ?? <span className="italic text-muted-foreground/60">none</span>}</td>
                    <td className="px-3 py-2.5 uppercase text-xs text-muted-foreground">{e.method ?? '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{e.referenceNumber ?? '—'}</td>
                    <td className="px-3 py-2.5 text-muted-foreground max-w-[200px] truncate">{e.notes ?? ''}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{e.createdByName ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button onClick={() => setEditing(e)} className="text-xs text-primary hover:underline mr-3">Edit</button>
                      <button onClick={() => remove(e)} className="text-xs text-rose-600 hover:underline">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(creating || editing) && (
        <EntryModal
          entry={editing}
          deals={deals}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'danger' }) {
  const color = tone === 'success' ? 'text-emerald-700' : tone === 'danger' ? 'text-rose-700' : 'text-foreground';
  return (
    <Card><CardContent className="p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`text-xl font-semibold tabular-nums mt-1 ${color}`}>{value}</div>
    </CardContent></Card>
  );
}

function EntryModal({ entry, deals, onClose, onSaved }: { entry: Entry | null; deals: DealOpt[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [entryType, setEntryType] = useState<'received' | 'sent_back'>(entry?.entryType ?? 'received');
  const [amount, setAmount] = useState(entry?.amount ?? '');
  const [entryDate, setEntryDate] = useState(entry?.entryDate ? entry.entryDate.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [dealId, setDealId] = useState(entry?.dealId ?? '');
  const [method, setMethod] = useState(entry?.method ?? 'ach');
  const [referenceNumber, setReferenceNumber] = useState(entry?.referenceNumber ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!amount) { toast.error('Enter an amount.'); return; }
    setSaving(true);
    try {
      const body = {
        entryType, amount: Number(amount),
        entryDate: entryDate || null,
        dealId: dealId || null,
        method, referenceNumber: referenceNumber || null, notes: notes || null,
      };
      const res = entry
        ? await fetch(`/api/accounting/${entry.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/accounting', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || 'Save failed'); return; }
      toast.success(entry ? 'Updated.' : 'Logged.');
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl border border-border w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">{entry ? 'Edit entry' : 'New accounting entry'}</h2>
        </div>
        <div className="p-6 space-y-3">
          <Field label="Type">
            <div className="grid grid-cols-2 gap-2">
              {(['received', 'sent_back'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setEntryType(t)}
                  className={`px-3 py-2 rounded border-2 text-sm font-medium ${entryType === t ? (t === 'received' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-rose-600 text-white border-rose-600') : 'border-border text-muted-foreground'}`}>
                  {t === 'received' ? 'Money received' : 'Money sent back'}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Amount ($) *"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000" /></Field>
          <Field label="Date"><Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></Field>
          <Field label="Related deal (optional)">
            <select value={dealId} onChange={(e) => setDealId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-card px-2 text-sm">
              <option value="">— No deal —</option>
              {deals.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Method">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-10 w-full rounded-md border border-input bg-card px-2 text-sm">
              {METHODS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
            </select>
          </Field>
          <Field label="Reference / confirmation #"><Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} /></Field>
          <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <div className="px-6 py-3 border-t border-border flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} loading={saving}>{entry ? 'Save' : 'Log entry'}</Button>
        </div>
      </div>
    </div>
  );
}
