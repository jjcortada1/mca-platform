'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, Button, Input, Field, PageHeader, Badge } from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { formatCurrency, formatDate } from '@/lib/utils';

interface Commission {
  id: string;
  dealId: string;
  dealName: string;
  merchantName: string | null;
  merchantPhone: string | null;
  merchantEmail: string | null;
  repId: string | null;
  repName: string | null;
  fundedAmount: string | null;
  rate: string | null;
  termMonths: string | null;
  fees: string | null;
  brokerFee: string | null;
  grossCommission: string;
  repSplitPct: string;
  repCommissionAmount: string;
  paidAmount: string;
  pendingAmount: number;
  owedAmount: number;
  status: 'pending' | 'cleared' | 'clawed_back';
  fundingDate: string | null;
  clearedDate: string | null;
  earlyPayoffDiscount: string | null;
  notes: string | null;
  syncState: 'pending' | 'synced' | 'failed';
  updatedAt: string;
}

const STATUS_TONE = {
  pending: 'warning',
  cleared: 'success',
  clawed_back: 'destructive',
} as const;

const STATUS_LABEL = {
  pending: 'Pending',
  cleared: 'Cleared',
  clawed_back: 'Clawed Back',
} as const;

export default function CommissionsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [cRes, meRes] = await Promise.all([
        fetch('/api/commissions'),
        fetch('/api/auth/me').catch(() => null),
      ]);
      const j = await cRes.json();
      setRows(j.commissions ?? []);
      if (meRes && meRes.ok) {
        const me = await meRes.json();
        const role = me?.user?.role ?? me?.role;
        setIsAdmin(role === 'company_admin' || role === 'master_admin');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const totals = useMemo(() => {
    let total = 0, paid = 0, pending = 0, owed = 0, clawed = 0;
    for (const r of rows) {
      const amt = Number(r.repCommissionAmount);
      const p = Number(r.paidAmount);
      if (r.status === 'clawed_back') { clawed += amt; continue; }
      total += amt; paid += p; owed += r.owedAmount; pending += r.pendingAmount;
    }
    return { total, paid, pending, owed, clawed };
  }, [rows]);

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/commissions/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Update failed'); return; }
    toast.success('Updated.');
    load();
  }

  async function softDelete(id: string) {
    if (!confirm('Remove this commission? It will be marked deleted (kept in the Google Sheet backup).')) return;
    const res = await fetch(`/api/commissions/${id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Delete failed'); return; }
    toast.success('Removed.');
    load();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Commissions"
        description={isAdmin ? 'Manage rep commissions, splits, statuses, and payouts.' : 'Your commission earnings and payout status.'}
      />

      {/* Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <TotalCard label="Total" value={totals.total} />
        <TotalCard label="Paid" value={totals.paid} tone="success" />
        <TotalCard label="Pending" value={totals.pending} tone="warning" />
        <TotalCard label="Owed" value={totals.owed} />
        <TotalCard label="Clawed back" value={totals.clawed} tone="destructive" />
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          No commissions yet.{isAdmin ? ' Create one from a funded deal.' : ''}
        </CardContent></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="bg-muted/40 border-b border-border text-left">
                  <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Deal</th>
                  {isAdmin && <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Rep</th>}
                  <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Gross</th>
                  <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Split %</th>
                  <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Rep comm.</th>
                  <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Paid</th>
                  <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Owed</th>
                  <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((r) => (
                  <>
                    <tr key={r.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                      <td className="px-4 py-2.5 font-medium">{r.dealName}</td>
                      {isAdmin && <td className="px-3 py-2.5 text-muted-foreground">{r.repName ?? '—'}</td>}
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(Number(r.grossCommission))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{Number(r.repSplitPct)}%</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium">{formatCurrency(Number(r.repCommissionAmount))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{formatCurrency(Number(r.paidAmount))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(r.owedAmount)}</td>
                      <td className="px-3 py-2.5"><Badge variant={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
                      <td className="px-2 py-2.5 text-muted-foreground text-xs">{expanded === r.id ? '▲' : '▼'}</td>
                    </tr>
                    {expanded === r.id && (
                      <tr className="bg-muted/10">
                        <td colSpan={isAdmin ? 9 : 8} className="px-4 py-3">
                          <CommissionDetail r={r} isAdmin={isAdmin} onPatch={patch} onDelete={softDelete} />
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function TotalCard({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'warning' | 'destructive' }) {
  const color = tone === 'success' ? 'text-emerald-700' : tone === 'warning' ? 'text-amber-700' : tone === 'destructive' ? 'text-rose-700' : 'text-foreground';
  return (
    <Card><CardContent className="p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`text-xl font-semibold tabular-nums mt-1 ${color}`}>{formatCurrency(value)}</div>
    </CardContent></Card>
  );
}

function CommissionDetail({ r, isAdmin, onPatch, onDelete }: {
  r: Commission; isAdmin: boolean;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [paid, setPaid] = useState(r.paidAmount);
  const [status, setStatus] = useState(r.status);
  const [notes, setNotes] = useState(r.notes ?? '');

  return (
    <div className="space-y-3">
      {/* Detail grid — merchant info only visible to admins/reps (NOT lead sources, who never reach this page) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <Detail label="Merchant" value={r.merchantName ?? '—'} />
        {isAdmin && <Detail label="Phone" value={r.merchantPhone ?? '—'} />}
        {isAdmin && <Detail label="Email" value={r.merchantEmail ?? '—'} />}
        <Detail label="Funded amount" value={r.fundedAmount ? formatCurrency(Number(r.fundedAmount)) : '—'} />
        <Detail label="Rate" value={r.rate ?? '—'} />
        <Detail label="Term (mo)" value={r.termMonths ?? '—'} />
        <Detail label="Fees" value={r.fees ? formatCurrency(Number(r.fees)) : '—'} />
        <Detail label="Broker fee" value={r.brokerFee ? formatCurrency(Number(r.brokerFee)) : '—'} />
        <Detail label="Pending" value={formatCurrency(r.pendingAmount)} />
        <Detail label="Funding date" value={r.fundingDate ? formatDate(r.fundingDate) : '—'} />
        <Detail label="Cleared date" value={r.clearedDate ? formatDate(r.clearedDate) : '—'} />
        <Detail label="Early payoff" value={r.earlyPayoffDiscount ?? '—'} />
      </div>

      {isAdmin && (
        <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-border">
          <Field label="Paid amount" className="w-36">
            <Input type="text" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} />
          </Field>
          <Field label="Status" className="w-40">
            <select value={status} onChange={(e) => setStatus(e.target.value as Commission['status'])}
              className="h-10 w-full rounded-md border border-input bg-card px-2 text-sm">
              <option value="pending">Pending</option>
              <option value="cleared">Cleared</option>
              <option value="clawed_back">Clawed Back</option>
            </select>
          </Field>
          <Field label="Notes" className="flex-1 min-w-[180px]">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Button size="sm" onClick={() => onPatch(r.id, { paidAmount: Number(paid), status, notes })}>Save</Button>
          <Button size="sm" variant="outline" onClick={() => onDelete(r.id)}>Remove</Button>
        </div>
      )}
      {r.notes && !isAdmin && <div className="text-xs text-muted-foreground italic">Note: {r.notes}</div>}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="tabular-nums">{value}</div>
    </div>
  );
}
