'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, Button, Input, Field, Badge, PageHeader, CurrencyInput } from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { formatCurrency } from '@/lib/utils';
import { Search, Download } from 'lucide-react';
import { exportCSV } from '@/lib/csv-export';
import { formatCalendarDate } from '@/lib/dates';

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

/**
 * Commission payment as surfaced on Accounting. Mirrors the response
 * shape from /api/commission-payments — we keep the field names so a
 * future merger of accounting + commission_payments into one table
 * would be a straight rename rather than a remapping.
 *
 * NOTE: commission payments are MONEY GOING OUT (paid to reps + lead
 * sources). They're modeled separately from `accounting` because they
 * have their own lifecycle (linked to commission rows, settlement state,
 * etc), but the broker thinks of them as "another row in accounting".
 * So we surface them here without merging the DB tables.
 */
interface CommissionPayment {
  id: string;
  amount: string;
  paidDate: string | null;
  method: string | null;
  notes: string | null;
  payeeName: string;
  payeeType: 'rep' | 'lead_source' | 'unknown';
  dealName: string | null;
  createdByName: string | null;
}

const METHODS = ['ach', 'wire', 'check', 'cash', 'zelle', 'other'] as const;
const fmtDate = (d: string | null) => formatCalendarDate(d);

export default function AccountingPage() {
  const toast = useToast();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [deals, setDeals] = useState<DealOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Filter now includes 'commission_pay' — when selected the table
  // shows commission payments (from /api/commission-payments) instead of
  // the standard accounting entries. The two record types live in
  // different DB tables so we never accidentally double-count totals.
  const [filter, setFilter] = useState<'all' | 'received' | 'sent_back' | 'commission_pay'>('all');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  // Commission payments — only loaded when the user selects the
  // Commission pay filter (avoids the network hit on first paint).
  const [commissionPays, setCommissionPays] = useState<CommissionPayment[]>([]);
  const [loadingCp, setLoadingCp] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [a, d] = await Promise.all([
        fetch('/api/accounting').then((r) => r.json()),
        fetch('/api/deals', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      setEntries(a.entries ?? []);
      setDeals((d.data ?? d.deals ?? []).map((x: DealOpt) => ({ id: x.id, name: x.name })));
    } finally { setLoading(false); }
  }

  /**
   * Load commission payments for the Commission Pay view. Pulled
   * lazily on first switch to that filter; subsequent switches reuse
   * the cached list. The "+ Log commission payment" button routes the
   * user to /payments where the existing form lives, then they come
   * back here and refresh to see the new entry.
   */
  async function loadCommissionPays() {
    setLoadingCp(true);
    try {
      const j = await fetch('/api/commission-payments', { cache: 'no-store' }).then((r) => r.json());
      setCommissionPays(j.payments ?? []);
    } finally { setLoadingCp(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (filter === 'commission_pay' && commissionPays.length === 0 && !loadingCp) {
      loadCommissionPays();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const filtered = useMemo(() => {
    // Commission_pay is rendered from a separate dataset below — not
    // part of the entries table — so this memo only handles received
    // and sent_back filters.
    let arr = entries;
    if (filter === 'received' || filter === 'sent_back') {
      arr = arr.filter((e) => e.entryType === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter((e) =>
        (e.dealName ?? '').toLowerCase().includes(q) ||
        (e.referenceNumber ?? '').toLowerCase().includes(q) ||
        (e.notes ?? '').toLowerCase().includes(q));
    }
    return arr;
  }, [entries, filter, search]);

  // Commission-pay rows post-search-filter — same fuzzy search across
  // payee, deal, and notes so the user can quickly scan a long list.
  const filteredCp = useMemo(() => {
    if (!search.trim()) return commissionPays;
    const q = search.toLowerCase();
    return commissionPays.filter((p) =>
      (p.payeeName ?? '').toLowerCase().includes(q) ||
      (p.dealName ?? '').toLowerCase().includes(q) ||
      (p.notes ?? '').toLowerCase().includes(q)
    );
  }, [commissionPays, search]);

  const totals = useMemo(() => {
    let received = 0, sent = 0;
    for (const e of entries) {
      const a = Number(e.amount);
      if (e.entryType === 'received') received += a;
      else sent += a;
    }
    // Commission paid out — counted independently of the
    // received/sent_back totals so the user can see at a glance how
    // much money has been disbursed as commissions. Net excludes
    // commission pay (it's already accounted for separately).
    const commissionPaid = commissionPays.reduce((s, p) => s + Number(p.amount), 0);
    return { received, sent, net: received - sent, commissionPaid, count: entries.length };
  }, [entries, commissionPays]);

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

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Tile label="Entries" value={String(totals.count)} />
        <Tile label="Money received" value={formatCurrency(totals.received)} tone="success" />
        <Tile label="Money sent back" value={formatCurrency(totals.sent)} tone="danger" />
        <Tile label="Net" value={formatCurrency(totals.net)} />
        {/* Commission paid out — separate column because this isn't
            money flowing in or out of the company in the same sense
            as received/sent_back; it's payroll for the broker team. */}
        <Tile label="Commission paid" value={formatCurrency(totals.commissionPaid)} tone="success" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([
          ['all', 'All'],
          ['received', 'Received'],
          ['sent_back', 'Sent back'],
          ['commission_pay', 'Commission pay'],
        ] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-3 py-1.5 rounded-full border text-xs font-medium transition ${filter === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:text-foreground'}`}>
            {label}
          </button>
        ))}
        {/* When viewing commission pay, surface a quick link to the
            existing /payments page (which has the full logging form).
            We don't duplicate that form here — single source of truth
            for the commission-payment editor. */}
        {filter === 'commission_pay' && (
          <a
            href="/payments"
            className="px-3 py-1.5 rounded-full border border-primary bg-primary/5 text-primary text-xs font-medium hover:bg-primary/10"
            title="Open the payments page to log a new commission payment"
          >
            + Log commission payment
          </a>
        )}
        <div className="ml-auto relative w-full sm:w-auto sm:min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search deal, reference, notes…" className="pl-9" />
        </div>
      </div>

      {/* Table — branched on filter. Commission Pay shows its own
          read-only table (sourced from /api/commission-payments); the
          other filters share the accounting-entries table. */}
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : filter === 'commission_pay' ? (
        loadingCp ? (
          <div className="text-sm text-muted-foreground">Loading commission payments…</div>
        ) : filteredCp.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
            No commission payments logged yet. Use the <a href="/payments" className="text-primary hover:underline">Payments page</a> to log one.
          </CardContent></Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[800px]">
                <thead><tr className="bg-muted/40 border-b border-border text-left">
                  <th className="px-4 py-2 th">Date paid</th>
                  <th className="px-3 py-2 th">Payee</th>
                  <th className="px-3 py-2 th text-right">Amount</th>
                  <th className="px-3 py-2 th">Deal</th>
                  <th className="px-3 py-2 th">Method</th>
                  <th className="px-3 py-2 th">Notes</th>
                  <th className="px-3 py-2 th">Logged by</th>
                </tr></thead>
                <tbody className="divide-y divide-border/60">
                  {filteredCp.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{fmtDate(p.paidDate)}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium">{p.payeeName}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{p.payeeType.replace('_', ' ')}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-emerald-700">
                        −{formatCurrency(Number(p.amount))}
                      </td>
                      <td className="px-3 py-2.5">{p.dealName ?? <span className="italic text-muted-foreground/60">—</span>}</td>
                      <td className="px-3 py-2.5 uppercase text-xs text-muted-foreground">{p.method ?? '—'}</td>
                      <td className="px-3 py-2.5 text-muted-foreground max-w-[240px] truncate">{p.notes ?? ''}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{p.createdByName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-border text-[11px] text-muted-foreground">
              To edit or delete a commission payment, open the{' '}
              <a href="/payments" className="text-primary hover:underline">Payments page</a>.
            </div>
          </Card>
        )
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
          <Field label="Amount *"><CurrencyInput value={amount} onChange={(v) => setAmount(v)} placeholder="10,000" /></Field>
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
