'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, Button, Input, Field, Badge, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { formatCurrency } from '@/lib/utils';
import { Search, Download } from 'lucide-react';
import { exportCSV } from '@/lib/csv-export';
import { formatCalendarDate } from '@/lib/dates';

interface Payment {
  id: string;
  repId: string | null;
  dealCommissionId: string | null;
  leadSourceCommissionId: string | null;
  leadSourceId: string | null;
  amount: string;
  paidDate: string;
  method: string | null;
  confirmationNumber: string | null;
  notes: string | null;
  isDeleted: boolean;
  createdBy: string | null;
  createdAt: string;
  repName: string | null;
  leadSourceName: string | null;
  dealName: string | null;
  createdByName: string | null;
  payeeName: string;
  payeeType: 'rep' | 'lead_source' | 'unknown';
}

const METHODS = ['ach', 'wire', 'check', 'cash', 'zelle', 'other'] as const;
const fmtDate = (d: string | null) => formatCalendarDate(d);

export default function PaymentsPage() {
  const toast = useToast();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'rep' | 'lead_source'>('all');
  const [editing, setEditing] = useState<Payment | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/commission-payments');
      const j = await res.json();
      setPayments(j.payments ?? []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let arr = payments;
    if (filter !== 'all') arr = arr.filter((p) => p.payeeType === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter((p) =>
        p.payeeName.toLowerCase().includes(q) ||
        (p.dealName ?? '').toLowerCase().includes(q) ||
        (p.confirmationNumber ?? '').toLowerCase().includes(q) ||
        (p.notes ?? '').toLowerCase().includes(q));
    }
    return arr;
  }, [payments, filter, search]);

  const totals = useMemo(() => {
    let total = 0, rep = 0, ls = 0;
    for (const p of payments) {
      const a = Number(p.amount);
      total += a;
      if (p.payeeType === 'rep') rep += a;
      else if (p.payeeType === 'lead_source') ls += a;
    }
    return { total, rep, ls, count: payments.length };
  }, [payments]);

  async function deletePayment(p: Payment) {
    if (!confirm(`Delete payment of ${formatCurrency(Number(p.amount))} to ${p.payeeName}? The paid amount on any linked commission will be reversed.`)) return;
    const res = await fetch(`/api/commission-payments/${p.id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Delete failed'); return; }
    toast.success('Payment removed.');
    load();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payments"
        description="Every payment logged to any rep or lead source. Edit or delete any record here."
        actions={
          <Button
            variant="outline"
            onClick={() => exportCSV('payments', filtered, [
              { key: 'paidDate', label: 'Date', format: (v) => (v ? new Date(v as string).toISOString().slice(0, 10) : '') },
              { key: 'payeeName', label: 'Payee' },
              { key: 'payeeType', label: 'Type' },
              { key: 'amount', label: 'Amount', format: (v) => (v ? Number(v) : 0) },
              { key: 'method', label: 'Method' },
              { key: 'confirmationNumber', label: 'Confirmation #' },
              { key: 'dealName', label: 'Related Deal' },
              { key: 'notes', label: 'Notes' },
              { key: 'createdByName', label: 'Created By' },
              { key: 'createdAt', label: 'Created At', format: (v) => (v ? new Date(v as string).toISOString().slice(0, 10) : '') },
            ])}
            disabled={filtered.length === 0}
            className="gap-1.5"
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Total payments" value={String(totals.count)} />
        <Tile label="Total paid" value={formatCurrency(totals.total)} />
        <Tile label="Paid to reps" value={formatCurrency(totals.rep)} />
        <Tile label="Paid to lead sources" value={formatCurrency(totals.ls)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([['all', 'All'], ['rep', 'Reps'], ['lead_source', 'Lead sources']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-3 py-1.5 rounded-full border text-xs font-medium transition ${filter === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:text-foreground'}`}>
            {label}
          </button>
        ))}
        <div className="ml-auto relative w-full sm:w-auto sm:min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search payee, deal, confirmation, notes…" className="pl-9" />
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No payments yet.</CardContent></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead><tr className="bg-muted/40 border-b border-border text-left">
                <th className="px-4 py-2 th">Date</th>
                <th className="px-3 py-2 th">Payee</th>
                <th className="px-3 py-2 th">Type</th>
                <th className="px-3 py-2 th text-right">Amount</th>
                <th className="px-3 py-2 th">Method</th>
                <th className="px-3 py-2 th">Related deal</th>
                <th className="px-3 py-2 th">Notes</th>
                <th className="px-3 py-2 th">Created by</th>
                <th className="w-32"></th>
              </tr></thead>
              <tbody className="divide-y divide-border/60">
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{fmtDate(p.paidDate)}</td>
                    <td className="px-3 py-2.5 font-medium">{p.payeeName}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant={p.payeeType === 'lead_source' ? 'outline' : 'default'} className="text-[10px]">
                        {p.payeeType === 'lead_source' ? 'Lead source' : p.payeeType === 'rep' ? 'Rep' : '—'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-emerald-700">{formatCurrency(Number(p.amount))}</td>
                    <td className="px-3 py-2.5 uppercase text-xs text-muted-foreground">{p.method ?? '—'}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{p.dealName ?? <span className="italic text-muted-foreground/60">none</span>}</td>
                    <td className="px-3 py-2.5 text-muted-foreground max-w-[200px] truncate">{p.notes ?? ''}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      <div>{p.createdByName ?? '—'}</div>
                      <div className="text-[10px]">{fmtDate(p.createdAt)}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button onClick={() => setEditing(p)} className="text-xs text-primary hover:underline mr-3">Edit</button>
                      <button onClick={() => deletePayment(p)} className="text-xs text-rose-600 hover:underline">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editing && (
        <EditPaymentModal payment={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="text-xl font-semibold tabular-nums mt-1">{value}</div>
    </CardContent></Card>
  );
}

function EditPaymentModal({ payment, onClose, onSaved }: { payment: Payment; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState(payment.amount);
  const [paidDate, setPaidDate] = useState(payment.paidDate ? payment.paidDate.slice(0, 10) : '');
  const [method, setMethod] = useState(payment.method ?? 'ach');
  const [confirmationNumber, setConfirmationNumber] = useState(payment.confirmationNumber ?? '');
  const [notes, setNotes] = useState(payment.notes ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/commission-payments/${payment.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(amount),
          paidDate: paidDate || null,
          method,
          confirmationNumber: confirmationNumber || null,
          notes: notes || null,
        }),
      });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || 'Save failed'); return; }
      toast.success('Payment updated.');
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl border border-border w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Edit payment</h2>
          <p className="text-xs text-muted-foreground mt-1">Payee: {payment.payeeName}{payment.dealName ? ` · ${payment.dealName}` : ''}</p>
        </div>
        <div className="p-6 space-y-3">
          <Field label="Amount ($)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Date"><Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} /></Field>
          <Field label="Method">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-10 w-full rounded-md border border-input bg-card px-2 text-sm">
              {METHODS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
            </select>
          </Field>
          <Field label="Confirmation #"><Input value={confirmationNumber} onChange={(e) => setConfirmationNumber(e.target.value)} /></Field>
          <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <div className="px-6 py-3 border-t border-border flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} loading={saving}>Save</Button>
        </div>
      </div>
    </div>
  );
}
