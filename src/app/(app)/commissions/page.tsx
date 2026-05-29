'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, Button, Input, Field, PageHeader, Badge } from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { formatCurrency, formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { computePaydown } from '@/lib/deals/paydown';

/* ---------- comma formatting helpers ---------- */
// Display a numeric string with thousands separators while typing (keeps a
// trailing "." or decimals intact). Stored value stays comma-free.
function addCommas(raw: string): string {
  if (raw === '' || raw == null) return '';
  const neg = raw.trim().startsWith('-');
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (cleaned === '') return '';
  const [intPart, ...rest] = cleaned.split('.');
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = rest.length ? '.' + rest.join('').slice(0, 2) : (cleaned.endsWith('.') ? '.' : '');
  return (neg ? '-' : '') + withCommas + dec;
}
function stripCommas(v: string): string {
  return (v ?? '').replace(/,/g, '');
}

/** A dollar input that shows commas as you type and stores a plain number string. */
function MoneyField({ label, value, onChange, placeholder, hint }: {
  label: string; value: string; onChange: (plain: string) => void; placeholder?: string; hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <Input
        inputMode="decimal"
        value={addCommas(value)}
        onChange={(e) => onChange(stripCommas(e.target.value))}
        placeholder={placeholder}
      />
    </Field>
  );
}

/* ---------- types ---------- */
interface Commission {
  id: string;
  dealId: string;
  dealName: string;
  merchantName: string | null;
  merchantFirstName: string | null;
  merchantLastName: string | null;
  merchantPhone: string | null;
  merchantEmail: string | null;
  assignedRepId: string | null;
  repId: string | null;
  repName: string | null;
  fundedAmount: string | null;
  rate: string | null;
  termMonths: string | null;
  termMode: string | null;
  termCount: string | null;
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
interface Deal { id: string; name: string; assignedRepId: string | null; }
interface Rep { id: string; name: string; role: string; }
interface LeadSource { id: string; name: string; contactEmail: string | null; contactPhone: string | null; isActive: boolean; }
interface LSCommission {
  id: string; dealId: string; dealName: string; merchantName: string | null;
  merchantFirstName: string | null; merchantLastName: string | null;
  merchantPhone: string | null; merchantEmail: string | null;
  assignedRepId: string | null;
  leadSourceId: string; leadSourceName: string;
  grossCommission: string | null; brokerFee: string | null;
  splitPct: string | null; flatAmount: string | null;
  commissionAmount: string; paidAmount: string; owedAmount: number; pendingAmount: number;
  status: 'pending' | 'cleared' | 'clawed_back';
  fundingDate: string | null;
  earlyPayoffDiscount: string | null;
  notes: string | null;
}

const STATUS_TONE = { pending: 'warning', cleared: 'success', clawed_back: 'destructive' } as const;
const STATUS_LABEL = { pending: 'Pending', cleared: 'Cleared', clawed_back: 'Clawed Back' } as const;

type Tab = 'rep' | 'lead';

export default function CommissionsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('rep');
  const [isAdmin, setIsAdmin] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [adminViewAs, setAdminViewAs] = useState<'all' | 'mine'>('all');

  const [rows, setRows] = useState<Commission[]>([]);
  const [lsRows, setLsRows] = useState<LSCommission[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [leadSources, setLeadSources] = useState<LeadSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lsExpanded, setLsExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'refi' | 'funded' | 'declined' | 'pending' | 'paid'>('all');

  const [showAdd, setShowAdd] = useState(false);
  const [showLSAdd, setShowLSAdd] = useState(false);
  const [showNewLS, setShowNewLS] = useState(false);
  const [showDraw, setShowDraw] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const meRes = await fetch('/api/auth/me').catch(() => null);
      let admin = false;
      if (meRes && meRes.ok) {
        const me = await meRes.json();
        const role = me?.user?.role;
        admin = role === 'company_admin' || role === 'master_admin';
        setIsAdmin(admin);
        setMyUserId(me?.user?.id ?? null);
      }
      const cRes = await fetch('/api/commissions');
      setRows((await cRes.json()).commissions ?? []);

      if (admin) {
        const [dRes, uRes, lsRes, lscRes] = await Promise.all([
          fetch('/api/deals'),
          fetch('/api/users'),
          fetch('/api/lead-sources'),
          fetch('/api/lead-source-commissions'),
        ]);
        const dJson = await dRes.json();
        const dealList = (dJson.data ?? dJson.deals ?? []) as Deal[];
        // Dedupe by id so the Assign Deal dropdown never repeats a deal.
        const seen = new Set<string>();
        setDeals(dealList.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true))));
        const uJson = await uRes.json();
        setReps(((uJson.data ?? uJson.users ?? []) as Rep[]).filter((u) => u.role === 'rep' || u.role === 'company_admin'));
        setLeadSources((await lsRes.json()).leadSources ?? []);
        setLsRows((await lscRes.json()).leadSourceCommissions ?? []);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    let total = 0, paid = 0, pending = 0, owed = 0, clawed = 0;
    let fundedVolume = 0, grossTotal = 0;
    let countPending = 0, countCleared = 0, countClawed = 0;
    const now = new Date();
    const thisMonth = now.getMonth(), thisYear = now.getFullYear();
    let mtdFunded = 0, mtdCommission = 0;
    const byRep = new Map<string, { name: string; commission: number; funded: number; count: number }>();

    for (const r of rows) {
      const amt = Number(r.repCommissionAmount);
      const funded = Number(r.fundedAmount) || 0;
      const gross = Number(r.grossCommission) || 0;
      fundedVolume += funded; grossTotal += gross;

      if (r.status === 'clawed_back') { clawed += amt; countClawed++; }
      else {
        total += amt; paid += Number(r.paidAmount); owed += r.owedAmount; pending += r.pendingAmount;
        if (r.status === 'pending') countPending++; else countCleared++;
      }

      if (r.fundingDate) {
        const fd = new Date(r.fundingDate);
        if (fd.getMonth() === thisMonth && fd.getFullYear() === thisYear) {
          mtdFunded += funded; mtdCommission += amt;
        }
      }

      if (r.repId && r.status !== 'clawed_back') {
        const e = byRep.get(r.repId) ?? { name: r.repName ?? 'Unknown', commission: 0, funded: 0, count: 0 };
        e.commission += amt; e.funded += funded; e.count++;
        byRep.set(r.repId, e);
      }
    }
    const topReps = Array.from(byRep.values()).sort((a, b) => b.commission - a.commission).slice(0, 5);
    const paidPct = total > 0 ? Math.round((paid / total) * 100) : 0;
    return { total, paid, pending, owed, clawed, fundedVolume, grossTotal, countPending, countCleared, countClawed, mtdFunded, mtdCommission, topReps, paidPct, dealCount: rows.length };
  }, [rows]);

  // Filtered view for the rep/admin commission list. "Refi" = funded deal that
  // is 50%+ paid in (renewal-eligible). "Active" = funded + paying down but not
  // yet refi-eligible.
  const filteredRows = useMemo(() => {
    let base = rows;
    // Admin "My commissions" filter — show only commissions for deals JJ is assigned to.
    if (isAdmin && adminViewAs === 'mine' && myUserId) {
      base = base.filter((r) => r.repId === myUserId || r.assignedRepId === myUserId);
    }
    if (filter === 'all') return base;
    return base.filter((r) => {
      const pd = computePaydown({
        fundedAmount: r.fundedAmount, factorRate: r.rate, termMode: r.termMode,
        termCount: r.termCount, fundingDate: r.fundingDate, amountCollected: null,
      });
      switch (filter) {
        case 'refi': return pd.hasStructure && pd.renewalEligible;
        case 'active': return pd.hasStructure && !pd.renewalEligible;
        case 'funded': return !!r.fundingDate || pd.hasStructure;
        case 'declined': return false; // commissions aren't created for declines
        case 'pending': return r.status === 'pending';
        case 'paid': return Number(r.paidAmount) > 0;
        default: return true;
      }
    });
  }, [rows, filter, isAdmin, adminViewAs, myUserId]);

  // Lead source commission totals (mirrors rep stats).
  const lsStats = useMemo(() => {
    let total = 0, paid = 0, pending = 0, owed = 0, clawed = 0;
    for (const r of lsRows) {
      const amt = Number(r.commissionAmount);
      if (r.status === 'clawed_back') { clawed += amt; continue; }
      total += amt; paid += Number(r.paidAmount); owed += r.owedAmount; pending += r.pendingAmount;
    }
    return { total, paid, pending, owed, clawed };
  }, [lsRows]);

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/commissions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Update failed'); return; }
    toast.success('Updated.'); load();
  }

  async function lsPatch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/lead-source-commissions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Update failed'); return; }
    toast.success('Updated.'); load();
  }
  async function lsSoftDelete(id: string) {
    if (!confirm('Remove this lead source commission? It will be marked deleted (kept in the backup).')) return;
    const res = await fetch(`/api/lead-source-commissions/${id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Delete failed'); return; }
    toast.success('Removed.'); load();
  }
  async function softDelete(id: string) {
    if (!confirm('Remove this commission? It will be marked deleted (kept in the backup).')) return;
    const res = await fetch(`/api/commissions/${id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Delete failed'); return; }
    toast.success('Removed.'); load();
  }

  async function dealPatch(dealId: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Deal update failed'); return false; }
    toast.success('Deal updated.'); load(); return true;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Commissions"
        description={isAdmin ? 'Manage rep + lead source commissions, splits, statuses, and payouts.' : 'Your commission earnings and payout status.'}
        actions={isAdmin ? (
          tab === 'rep'
            ? <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowDraw(true)}>+ Log draw</Button>
                <Button onClick={() => setShowAdd(true)}>+ Add commission</Button>
              </div>
            : <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowNewLS(true)}>+ New lead source</Button>
                <Button onClick={() => setShowLSAdd(true)}>+ Assign to deal</Button>
              </div>
        ) : undefined}
      />

      {isAdmin && (
        <div className="inline-flex bg-muted rounded-lg p-1">
          {([['rep', 'Rep Commissions'], ['lead', 'Lead Source Commissions']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-1.5 rounded text-sm font-medium transition ${tab === k ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === 'rep' && (
        <>
          {/* Top-tier dashboard */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Hero: payout progress */}
            <Card className="lg:col-span-2">
              <CardContent className="p-5">
                <div className="flex items-start justify-between flex-wrap gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total commission</div>
                    <div className="text-3xl font-semibold tabular-nums mt-1">{formatCurrency(stats.total)}</div>
                    <div className="text-xs text-muted-foreground mt-1">{stats.dealCount} deal{stats.dealCount === 1 ? '' : 's'} · {formatCurrency(stats.fundedVolume)} funded volume</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">This month</div>
                    <div className="text-xl font-semibold tabular-nums mt-1 text-primary">{formatCurrency(stats.mtdCommission)}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{formatCurrency(stats.mtdFunded)} funded</div>
                  </div>
                </div>
                {/* Payout progress bar */}
                <div className="mt-4">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Paid {formatCurrency(stats.paid)} of {formatCurrency(stats.total)}</span>
                    <span className="font-medium tabular-nums">{stats.paidPct}%</span>
                  </div>
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden flex">
                    <div className="h-full bg-emerald-500" style={{ width: `${stats.paidPct}%` }} />
                    <div className="h-full bg-amber-400" style={{ width: `${stats.total > 0 ? Math.round((stats.pending / stats.total) * 100) : 0}%` }} />
                  </div>
                  <div className="flex gap-4 mt-2 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Paid {formatCurrency(stats.paid)}</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> Pending {formatCurrency(stats.pending)}</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/40" /> Owed {formatCurrency(stats.owed)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Status breakdown */}
            <Card>
              <CardContent className="p-5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Status breakdown</div>
                <div className="space-y-2.5">
                  <StatusRow label="Pending" count={stats.countPending} tone="warning" />
                  <StatusRow label="Cleared" count={stats.countCleared} tone="success" />
                  <StatusRow label="Clawed back" count={stats.countClawed} tone="destructive" amount={stats.clawed} />
                </div>
                <div className="mt-3 pt-3 border-t border-border flex justify-between text-xs">
                  <span className="text-muted-foreground">Gross (pre-split)</span>
                  <span className="font-medium tabular-nums">{formatCurrency(stats.grossTotal)}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top reps (admin only) */}
          {isAdmin && stats.topReps.length > 0 && (
            <Card>
              <CardContent className="p-5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Top reps by commission</div>
                <div className="space-y-2">
                  {stats.topReps.map((rep, i) => {
                    const maxC = stats.topReps[0].commission || 1;
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <div className="w-6 text-xs text-muted-foreground tabular-nums">#{i + 1}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between text-sm">
                            <span className="font-medium truncate">{rep.name}</span>
                            <span className="tabular-nums">{formatCurrency(rep.commission)}</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${Math.round((rep.commission / maxC) * 100)}%` }} />
                          </div>
                        </div>
                        <div className="text-[11px] text-muted-foreground tabular-nums w-16 text-right">{rep.count} deal{rep.count === 1 ? '' : 's'}</div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {loading ? <div className="text-sm text-muted-foreground">Loading…</div>
          : rows.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
              No commissions yet.{isAdmin ? ' Click “+ Add commission” to create one from a funded deal.' : ''}
            </CardContent></Card>
          ) : (
            <>
            {/* Filter bar — sort between active, refis, etc. */}
            <div className="flex flex-wrap gap-2 items-center">
              {isAdmin && (
                <div className="flex rounded-full border border-border bg-card p-1 mr-2">
                  {(['all', 'mine'] as const).map((v) => (
                    <button key={v} onClick={() => setAdminViewAs(v)}
                      className={cn('px-3 py-1 rounded-full text-xs font-medium transition',
                        adminViewAs === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                      {v === 'all' ? 'All commissions' : 'My commissions'}
                    </button>
                  ))}
                </div>
              )}
              {([
                ['all', 'All'], ['active', 'Active'], ['refi', 'Refi eligible'],
                ['pending', 'Pending'], ['paid', 'Paid'],
              ] as const).map(([k, label]) => (
                <button key={k} onClick={() => setFilter(k)}
                  className={cn('px-3 py-1.5 rounded-full border text-xs font-medium transition',
                    filter === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:text-foreground')}>
                  {label}
                </button>
              ))}
            </div>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[760px]">
                  <thead><tr className="bg-muted/40 border-b border-border text-left">
                    <th className="px-4 py-2 th">Deal</th>
                    {isAdmin && <th className="px-3 py-2 th">Rep</th>}
                    <th className="px-3 py-2 th text-right">Gross</th>
                    <th className="px-3 py-2 th text-right">Split %</th>
                    <th className="px-3 py-2 th text-right">Rep comm.</th>
                    <th className="px-3 py-2 th text-right">Paid</th>
                    <th className="px-3 py-2 th text-right">Owed</th>
                    <th className="px-3 py-2 th">Status</th>
                    <th className="w-16"></th>
                  </tr></thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredRows.map((r) => (
                      <>
                        <tr key={r.id} className="hover:bg-muted/20">
                          <td className="px-4 py-2.5 font-medium">{r.dealName}</td>
                          {isAdmin && <td className="px-3 py-2.5 text-muted-foreground">{r.repName ?? '—'}</td>}
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(Number(r.grossCommission))}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{Number(r.repSplitPct)}%</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-medium">{formatCurrency(Number(r.repCommissionAmount))}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{formatCurrency(Number(r.paidAmount))}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(r.owedAmount)}</td>
                          <td className="px-3 py-2.5"><Badge variant={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
                          <td className="px-3 py-2.5 text-right">
                            <button
                              onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              {expanded === r.id ? 'Close' : (isAdmin ? 'Edit' : 'Details')}
                            </button>
                          </td>
                        </tr>
                        {expanded === r.id && (
                          <tr className="bg-muted/10"><td colSpan={isAdmin ? 9 : 8} className="px-4 py-3">
                            <CommissionDetail r={r} isAdmin={isAdmin} reps={reps} onPatch={patch} onDelete={softDelete} onDealPatch={dealPatch} />
                          </td></tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            </>
          )}
        </>
      )}

      {tab === 'lead' && isAdmin && (
        <>
          {/* Lead source commission dashboard */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Tile label="Total" value={formatCurrency(lsStats.total)} />
            <Tile label="Paid" value={formatCurrency(lsStats.paid)} tone="emerald" />
            <Tile label="Pending" value={formatCurrency(lsStats.pending)} tone="amber" />
            <Tile label="Owed" value={formatCurrency(lsStats.owed)} />
            <Tile label="Clawed back" value={formatCurrency(lsStats.clawed)} tone="rose" />
          </div>

          <Card className="overflow-hidden">
            {lsRows.length === 0 ? (
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No lead source commissions yet. Add a lead source, then assign it to a deal.
              </CardContent>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[760px]">
                  <thead><tr className="bg-muted/40 border-b border-border text-left">
                    <th className="px-4 py-2 th">Lead source</th>
                    <th className="px-3 py-2 th">Deal</th>
                    <th className="px-3 py-2 th text-right">Split / Flat</th>
                    <th className="px-3 py-2 th text-right">Commission</th>
                    <th className="px-3 py-2 th text-right">Paid</th>
                    <th className="px-3 py-2 th text-right">Owed</th>
                    <th className="px-3 py-2 th">Status</th>
                    <th className="w-16"></th>
                  </tr></thead>
                  <tbody className="divide-y divide-border/60">
                    {lsRows.map((r) => (
                      <>
                        <tr key={r.id} className="hover:bg-muted/20">
                          <td className="px-4 py-2.5 font-medium">{r.leadSourceName}</td>
                          <td className="px-3 py-2.5 text-muted-foreground">{r.dealName}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{r.flatAmount ? formatCurrency(Number(r.flatAmount)) : r.splitPct ? `${Number(r.splitPct)}%` : '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-medium">{formatCurrency(Number(r.commissionAmount))}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{formatCurrency(Number(r.paidAmount))}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(r.owedAmount)}</td>
                          <td className="px-3 py-2.5"><Badge variant={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
                          <td className="px-3 py-2.5 text-right">
                            <button
                              onClick={() => setLsExpanded(lsExpanded === r.id ? null : r.id)}
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              {lsExpanded === r.id ? 'Close' : 'Edit'}
                            </button>
                          </td>
                        </tr>
                        {lsExpanded === r.id && (
                          <tr className="bg-muted/10">
                            <td colSpan={8} className="px-4 py-3">
                              <LSCommissionDetail r={r} reps={reps} onPatch={lsPatch} onDelete={lsSoftDelete} onDealPatch={dealPatch} />
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {showAdd && <AddCommissionModal deals={deals} reps={reps} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {showNewLS && <NewLeadSourceModal onClose={() => setShowNewLS(false)} onSaved={() => { setShowNewLS(false); load(); }} />}
      {showLSAdd && <AssignLeadSourceModal deals={deals} leadSources={leadSources} onClose={() => setShowLSAdd(false)} onSaved={() => { setShowLSAdd(false); load(); }} />}
      {showDraw && <LogDrawModal reps={reps} onClose={() => setShowDraw(false)} onSaved={() => { setShowDraw(false); load(); }} />}

      <style jsx>{`.th{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted-foreground,#6b7280)}`}</style>
    </div>
  );
}

/* ---------- Add Commission modal ---------- */
function AddCommissionModal({ deals, reps, onClose, onSaved }: { deals: Deal[]; reps: Rep[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [dealMode, setDealMode] = useState<'existing' | 'new'>(deals.length ? 'existing' : 'new');
  const [newDeal, setNewDeal] = useState({ name: '', merchantFirstName: '', merchantLastName: '', merchantPhone: '', merchantEmail: '' });
  const [f, setF] = useState({
    dealId: '', repId: '', fundedAmount: '', rate: '',
    termMode: 'weekly' as 'daily' | 'weekly', termCount: '',
    fees: '', brokerFee: '', grossCommission: '', repSplitPct: '',
    leadSourceMode: 'none' as 'none' | 'split' | 'flat', leadSourceSplitPct: '', leadSourceFlatAmount: '',
    fundingDate: new Date().toISOString().slice(0, 10),
    earlyPayoffDiscount: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  // Full live breakdown: gross + broker pool, rep owed, lead source owed, house remainder.
  const breakdown = useMemo(() => {
    const gross = parseFloat(f.grossCommission) || 0;
    const broker = parseFloat(f.brokerFee) || 0;
    const pool = gross + broker;
    const repPct = (parseFloat(f.repSplitPct) || 0) / 100;
    const repOwed = Math.round((gross + broker) * repPct * 100) / 100;
    let lsOwed = 0;
    if (f.leadSourceMode === 'flat') lsOwed = parseFloat(f.leadSourceFlatAmount) || 0;
    else if (f.leadSourceMode === 'split') lsOwed = Math.round(gross * ((parseFloat(f.leadSourceSplitPct) || 0) / 100) * 100) / 100;
    const houseOwed = Math.round((pool - repOwed - lsOwed) * 100) / 100;
    return { gross, broker, pool, repOwed, lsOwed, houseOwed };
  }, [f.grossCommission, f.brokerFee, f.repSplitPct, f.leadSourceMode, f.leadSourceSplitPct, f.leadSourceFlatAmount]);

  async function save() {
    let dealId = f.dealId;

    if (dealMode === 'new') {
      if (!newDeal.name.trim()) { toast.error('Enter a deal name.'); return; }
    } else if (!dealId) {
      toast.error('Pick a deal.'); return;
    }

    setSaving(true);
    try {
      // If logging a brand-new deal, create it first (status = funded, since we're
      // recording its commission), then attach the commission to it.
      if (dealMode === 'new') {
        const dRes = await fetch('/api/deals', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newDeal.name.trim(),
            merchantFirstName: newDeal.merchantFirstName || null,
            merchantLastName: newDeal.merchantLastName || null,
            merchantPhone: newDeal.merchantPhone || null,
            merchantEmail: newDeal.merchantEmail || null,
            assignedRepId: f.repId || null,
            status: 'funded',
          }),
        });
        const dJson = await dRes.json();
        if (!dRes.ok) { toast.error(dJson.error || 'Could not create deal'); return; }
        dealId = dJson.deal?.id;
        if (!dealId) { toast.error('Deal created but no ID returned'); return; }
      }

      const res = await fetch('/api/commissions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId, repId: f.repId || null,
          fundedAmount: f.fundedAmount || null, rate: f.rate || null,
          termMonths: null, termMode: f.termMode, termCount: f.termCount || null,
          fees: f.fees || null, brokerFee: f.brokerFee || null,
          grossCommission: f.grossCommission || 0, repSplitPct: f.repSplitPct || 0,
          fundingDate: f.fundingDate || null, earlyPayoffDiscount: f.earlyPayoffDiscount || null, notes: f.notes || null,
        }),
      });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || 'Save failed'); return; }
      toast.success(dealMode === 'new' ? 'Deal logged and commission saved.' : 'Commission saved.');
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <Modal title="Add / edit rep commission" onClose={onClose} onSave={save} saving={saving}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Deal">
            <div className="grid grid-cols-2 gap-2 mb-2">
              {(['existing', 'new'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setDealMode(m)}
                  className={`px-3 py-2 rounded border-2 text-sm font-medium ${dealMode === m ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}>
                  {m === 'existing' ? 'Pick existing deal' : 'Log new deal'}
                </button>
              ))}
            </div>
            {dealMode === 'existing' ? (
              <select value={f.dealId} onChange={(e) => setF({ ...f, dealId: e.target.value })} className="sel">
                <option value="">— Pick a deal —</option>
                {deals.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            ) : (
              <Input value={newDeal.name} onChange={(e) => setNewDeal({ ...newDeal, name: e.target.value })} placeholder="New deal name (e.g. ABC Plumbing)" />
            )}
          </Field>
        </div>

        {dealMode === 'new' && (
          <>
            <Field label="Merchant first name"><Input value={newDeal.merchantFirstName} onChange={(e) => setNewDeal({ ...newDeal, merchantFirstName: e.target.value })} /></Field>
            <Field label="Merchant last name"><Input value={newDeal.merchantLastName} onChange={(e) => setNewDeal({ ...newDeal, merchantLastName: e.target.value })} /></Field>
            <Field label="Merchant phone"><Input value={newDeal.merchantPhone} onChange={(e) => setNewDeal({ ...newDeal, merchantPhone: e.target.value })} /></Field>
            <Field label="Merchant email"><Input value={newDeal.merchantEmail} onChange={(e) => setNewDeal({ ...newDeal, merchantEmail: e.target.value })} /></Field>
          </>
        )}

        <Field label="Assign rep">
          <select value={f.repId} onChange={(e) => setF({ ...f, repId: e.target.value })} className="sel">
            <option value="">— Unassigned —</option>
            {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Funding date"><Input type="date" value={f.fundingDate} onChange={(e) => setF({ ...f, fundingDate: e.target.value })} /></Field>

        <MoneyField label="Funded amount ($)" value={f.fundedAmount} onChange={(v) => setF({ ...f, fundedAmount: v })} placeholder="100,000" />
        <Field label="Rate (factor)"><Input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="1.49" /></Field>

        {/* Term structure: daily/weekly + count */}
        <Field label="Term type">
          <div className="grid grid-cols-2 gap-2">
            {(['daily', 'weekly'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setF({ ...f, termMode: m })}
                className={`px-3 py-2 rounded border-2 text-sm font-medium ${f.termMode === m ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}>
                {m === 'daily' ? 'Daily' : 'Weekly'}
              </button>
            ))}
          </div>
        </Field>
        <Field label={f.termMode === 'daily' ? 'Number of days' : 'Number of weeks'}>
          <Input inputMode="decimal" value={f.termCount} onChange={(e) => setF({ ...f, termCount: e.target.value })} placeholder={f.termMode === 'daily' ? '120' : '24'} />
        </Field>

        <MoneyField label="Fees ($)" value={f.fees} onChange={(v) => setF({ ...f, fees: v })} placeholder="0" />
        <MoneyField label="Gross commission ($)" value={f.grossCommission} onChange={(v) => setF({ ...f, grossCommission: v })} placeholder="10,000" />
        <MoneyField label="Broker fee ($)" value={f.brokerFee} onChange={(v) => setF({ ...f, brokerFee: v })} placeholder="0" />
        <Field label="Rep split %"><Input inputMode="decimal" value={f.repSplitPct} onChange={(e) => setF({ ...f, repSplitPct: e.target.value })} placeholder="30" /></Field>

        {/* Lead source (optional) */}
        <Field label="Lead source commission">
          <select value={f.leadSourceMode} onChange={(e) => setF({ ...f, leadSourceMode: e.target.value as typeof f.leadSourceMode })} className="sel">
            <option value="none">None</option>
            <option value="split">Split % of gross</option>
            <option value="flat">Flat amount</option>
          </select>
        </Field>
        {f.leadSourceMode === 'split' && <Field label="Lead source split %"><Input inputMode="decimal" value={f.leadSourceSplitPct} onChange={(e) => setF({ ...f, leadSourceSplitPct: e.target.value })} placeholder="10" /></Field>}
        {f.leadSourceMode === 'flat' && <MoneyField label="Lead source flat ($)" value={f.leadSourceFlatAmount} onChange={(v) => setF({ ...f, leadSourceFlatAmount: v })} placeholder="500" />}

        <Field label="Early payoff discount"><Input value={f.earlyPayoffDiscount} onChange={(e) => setF({ ...f, earlyPayoffDiscount: e.target.value })} placeholder="optional" /></Field>
        <div className="col-span-2">
          <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      </div>

      {/* Full live breakdown */}
      <div className="mt-3 rounded-lg bg-muted/30 border border-border p-3 text-sm space-y-1.5">
        <BreakdownRow label="Gross + broker pool" value={breakdown.pool} />
        <BreakdownRow label="Rep owed (split of gross + broker fee)" value={breakdown.repOwed} tone="primary" />
        {f.leadSourceMode !== 'none' && <BreakdownRow label="Lead source owed" value={breakdown.lsOwed} />}
        <div className="border-t border-border pt-1.5">
          <BreakdownRow label="House keeps (remainder)" value={breakdown.houseOwed} tone={breakdown.houseOwed < 0 ? 'danger' : 'success'} bold />
        </div>
        {breakdown.houseOwed < 0 && <div className="text-xs text-rose-700">Rep + lead source exceed the pool — check the splits.</div>}
      </div>
    </Modal>
  );
}

function BreakdownRow({ label, value, tone, bold }: { label: string; value: number; tone?: 'primary' | 'success' | 'danger'; bold?: boolean }) {
  const color = tone === 'primary' ? 'text-primary' : tone === 'success' ? 'text-emerald-700' : tone === 'danger' ? 'text-rose-700' : 'text-foreground';
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${color} ${bold ? 'font-semibold' : ''}`}>{formatCurrency(value)}</span>
    </div>
  );
}

/* ---------- New Lead Source modal ---------- */
function NewLeadSourceModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', contactEmail: '', contactPhone: '', notes: '' });
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!f.name.trim()) { toast.error('Name required.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/lead-sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || 'Failed'); return; }
      toast.success('Lead source added.'); onSaved();
    } finally { setSaving(false); }
  }
  return (
    <Modal title="New lead source" onClose={onClose} onSave={save} saving={saving}>
      <div className="space-y-3">
        <Field label="Name *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. ABC Referrals" /></Field>
        <Field label="Contact email"><Input value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></Field>
        <Field label="Contact phone"><Input value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></Field>
        <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

/* ---------- Assign Lead Source to deal modal ---------- */
function AssignLeadSourceModal({ deals, leadSources, onClose, onSaved }: { deals: Deal[]; leadSources: LeadSource[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [dealMode, setDealMode] = useState<'existing' | 'new'>(deals.length ? 'existing' : 'new');
  const [newDeal, setNewDeal] = useState({ name: '', merchantFirstName: '', merchantLastName: '', merchantPhone: '', merchantEmail: '' });
  const [f, setF] = useState({
    dealId: '', leadSourceId: '',
    mode: 'split' as 'split' | 'flat',
    splitPct: '', flatAmount: '',
    grossCommission: '', brokerFee: '',
    fundingDate: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  // Live-computed lead-source owed amount: (gross + brokerFee) × split%
  const lsOwed = useMemo(() => {
    if (f.mode === 'flat') return Number(f.flatAmount) || 0;
    const gross = parseFloat(f.grossCommission) || 0;
    const brokerFee = parseFloat(f.brokerFee) || 0;
    const split = parseFloat(f.splitPct) || 0;
    return Math.round((gross + brokerFee) * (split / 100) * 100) / 100;
  }, [f.mode, f.grossCommission, f.brokerFee, f.splitPct, f.flatAmount]);

  async function save() {
    if (!f.leadSourceId) { toast.error('Pick a lead source.'); return; }
    let dealId = f.dealId;
    if (dealMode === 'new' && !newDeal.name.trim()) { toast.error('Enter a deal name.'); return; }
    if (dealMode === 'existing' && !dealId) { toast.error('Pick a deal.'); return; }

    setSaving(true);
    try {
      // Create deal first if new.
      if (dealMode === 'new') {
        const dRes = await fetch('/api/deals', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newDeal.name.trim(),
            merchantFirstName: newDeal.merchantFirstName || null,
            merchantLastName: newDeal.merchantLastName || null,
            merchantPhone: newDeal.merchantPhone || null,
            merchantEmail: newDeal.merchantEmail || null,
            status: 'funded',
            fundingDate: f.fundingDate || null,
          }),
        });
        const dJson = await dRes.json();
        if (!dRes.ok) { toast.error(dJson.error || 'Could not create deal'); return; }
        dealId = dJson.deal?.id;
        if (!dealId) { toast.error('Deal created but no ID returned'); return; }
      }
      // Note: selecting an EXISTING deal only links by ID. The original deal
      // record is NEVER modified by logging a commission against it.

      // Create the LS commission with full math.
      const res = await fetch('/api/lead-source-commissions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId, leadSourceId: f.leadSourceId,
          splitPct: f.mode === 'split' ? (f.splitPct || 0) : null,
          flatAmount: f.mode === 'flat' ? (f.flatAmount || 0) : null,
          grossCommission: f.grossCommission || null,
          brokerFee: f.brokerFee || null,
          fundingDate: f.fundingDate || null,
          notes: f.notes || null,
        }),
      });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || 'Failed'); return; }
      toast.success(dealMode === 'new' ? 'Deal logged and lead source assigned.' : 'Lead source assigned.');
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <Modal title="Assign lead source commission" onClose={onClose} onSave={save} saving={saving}>
      <div className="space-y-3">
        <Field label="Deal">
          <div className="grid grid-cols-2 gap-2 mb-2">
            {(['existing', 'new'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setDealMode(m)}
                className={`px-3 py-2 rounded border-2 text-sm font-medium ${dealMode === m ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}>
                {m === 'existing' ? 'Pick existing deal' : 'Log new deal'}
              </button>
            ))}
          </div>
          {dealMode === 'existing' ? (
            <select value={f.dealId} onChange={(e) => setF({ ...f, dealId: e.target.value })} className="sel">
              <option value="">— Pick a deal —</option>
              {deals.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          ) : (
            <Input value={newDeal.name} onChange={(e) => setNewDeal({ ...newDeal, name: e.target.value })} placeholder="New deal name (e.g. ABC Plumbing)" />
          )}
        </Field>

        {dealMode === 'new' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Merchant first name"><Input value={newDeal.merchantFirstName} onChange={(e) => setNewDeal({ ...newDeal, merchantFirstName: e.target.value })} /></Field>
            <Field label="Merchant last name"><Input value={newDeal.merchantLastName} onChange={(e) => setNewDeal({ ...newDeal, merchantLastName: e.target.value })} /></Field>
            <Field label="Merchant phone"><Input value={newDeal.merchantPhone} onChange={(e) => setNewDeal({ ...newDeal, merchantPhone: e.target.value })} /></Field>
            <Field label="Merchant email"><Input value={newDeal.merchantEmail} onChange={(e) => setNewDeal({ ...newDeal, merchantEmail: e.target.value })} /></Field>
          </div>
        )}

        <Field label="Lead source *">
          <select value={f.leadSourceId} onChange={(e) => setF({ ...f, leadSourceId: e.target.value })} className="sel">
            <option value="">— Pick a lead source —</option>
            {leadSources.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>

        <Field label="Funded date"><Input type="date" value={f.fundingDate} onChange={(e) => setF({ ...f, fundingDate: e.target.value })} /></Field>

        <Field label="Commission math">
          <div className="grid grid-cols-2 gap-2">
            <MoneyField label="Total commission ($)" value={f.grossCommission} onChange={(v) => setF({ ...f, grossCommission: v })} placeholder="10000" />
            <MoneyField label="Broker fee ($)" value={f.brokerFee} onChange={(v) => setF({ ...f, brokerFee: v })} placeholder="2000" />
          </div>
        </Field>

        <Field label="Lead source pays as">
          <div className="grid grid-cols-2 gap-2">
            {(['split', 'flat'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setF({ ...f, mode: m })}
                className={`px-3 py-2 rounded border-2 text-sm font-medium ${f.mode === m ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}>
                {m === 'split' ? 'Split % of (commission + broker fee)' : 'Flat amount'}
              </button>
            ))}
          </div>
        </Field>
        {f.mode === 'split'
          ? <Field label="Split %"><Input inputMode="decimal" value={f.splitPct} onChange={(e) => setF({ ...f, splitPct: e.target.value })} placeholder="10" /></Field>
          : <MoneyField label="Flat amount ($)" value={f.flatAmount} onChange={(v) => setF({ ...f, flatAmount: v })} placeholder="500" />}

        <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Lead source owed: </span>
          <span className="font-semibold tabular-nums">${lsOwed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          {f.mode === 'split' && <span className="text-xs text-muted-foreground ml-2">({f.splitPct || 0}% of ${((parseFloat(f.grossCommission) || 0) + (parseFloat(f.brokerFee) || 0)).toLocaleString()})</span>}
        </div>

        <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Visible to the lead source — payoff terms, etc." /></Field>
      </div>
    </Modal>
  );
}

/* ---------- Log draw (advance not tied to a deal) ---------- */
function LogDrawModal({ reps, onClose, onSaved }: { reps: Rep[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ repId: '', amount: '', drawDate: new Date().toISOString().slice(0, 10), notes: '' });
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!f.repId) { toast.error('Pick a rep.'); return; }
    if (!f.amount) { toast.error('Enter an amount.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/commission-draws', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repId: f.repId, amount: f.amount, drawDate: f.drawDate, notes: f.notes || null }),
      });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || 'Failed'); return; }
      toast.success('Draw logged.'); onSaved();
    } finally { setSaving(false); }
  }
  return (
    <Modal title="Log a draw / advance" onClose={onClose} onSave={save} saving={saving}>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">A draw is an advance paid to a rep, not tied to a specific deal. It's deducted from future commissions owed.</p>
        <Field label="Rep *">
          <select value={f.repId} onChange={(e) => setF({ ...f, repId: e.target.value })} className="sel">
            <option value="">— Pick a rep —</option>
            {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <MoneyField label="Draw amount ($) *" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} placeholder="2,000" />
        <Field label="Date"><Input type="date" value={f.drawDate} onChange={(e) => setF({ ...f, drawDate: e.target.value })} /></Field>
        <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="optional" /></Field>
      </div>
    </Modal>
  );
}

/* ---------- shared modal shell ---------- */
function Modal({ title, children, onClose, onSave, saving }: { title: string; children: React.ReactNode; onClose: () => void; onSave: () => void; saving: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl border border-border w-full max-w-xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border"><h2 className="text-base font-semibold">{title}</h2></div>
        <div className="p-6">{children}</div>
        <div className="px-6 py-3 border-t border-border flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={onSave} loading={saving}>Save</Button>
        </div>
      </div>
      <style jsx global>{`.sel{height:2.5rem;width:100%;border-radius:0.375rem;border:1px solid var(--input,#e5e7eb);background:var(--card,#fff);padding:0 0.5rem;font-size:0.875rem}`}</style>
    </div>
  );
}

/* ---------- bits ---------- */
function StatusRow({ label, count, tone, amount }: { label: string; count: number; tone: 'success' | 'warning' | 'destructive'; amount?: number }) {
  const dot = tone === 'success' ? 'bg-emerald-500' : tone === 'warning' ? 'bg-amber-400' : 'bg-rose-500';
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${dot}`} /> {label}</span>
      <span className="tabular-nums text-muted-foreground">{count}{amount ? ` · ${formatCurrency(amount)}` : ''}</span>
    </div>
  );
}

function CommissionDetail({ r, isAdmin, reps, onPatch, onDelete, onDealPatch }: {
  r: Commission; isAdmin: boolean;
  reps: Rep[];
  onPatch: (id: string, body: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onDealPatch: (dealId: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [paid, setPaid] = useState(r.paidAmount);
  const [status, setStatus] = useState(r.status);
  const [notes, setNotes] = useState(r.notes ?? '');
  // Editable math
  const [gross, setGross] = useState(r.grossCommission ?? '');
  const [brokerFee, setBrokerFee] = useState(r.brokerFee ?? '');
  const [splitPct, setSplitPct] = useState(r.repSplitPct ?? '');
  const [fundingDate, setFundingDate] = useState(r.fundingDate ? r.fundingDate.slice(0, 10) : '');
  const [earlyPayoffDiscount, setEarlyPayoffDiscount] = useState(r.earlyPayoffDiscount ?? '');
  // Editable deal fields (admin only — patches the parent deal record)
  const [dealName, setDealName] = useState(r.dealName);
  const [merchantFirstName, setMerchantFirstName] = useState(r.merchantFirstName ?? '');
  const [merchantLastName, setMerchantLastName] = useState(r.merchantLastName ?? '');
  const [merchantPhone, setMerchantPhone] = useState(r.merchantPhone ?? '');
  const [merchantEmail, setMerchantEmail] = useState(r.merchantEmail ?? '');
  const [assignedRepId, setAssignedRepId] = useState(r.assignedRepId ?? '');

  // Live preview of recomputed rep commission
  const computed = useMemo(() => {
    const g = parseFloat(gross) || 0; const b = parseFloat(brokerFee) || 0; const s = parseFloat(splitPct) || 0;
    return Math.round((g + b) * (s / 100) * 100) / 100;
  }, [gross, brokerFee, splitPct]);

  async function saveDeal() {
    const body: Record<string, unknown> = {};
    if (dealName !== r.dealName) body.name = dealName;
    if (merchantFirstName !== (r.merchantFirstName ?? '')) body.merchantFirstName = merchantFirstName || null;
    if (merchantLastName !== (r.merchantLastName ?? '')) body.merchantLastName = merchantLastName || null;
    if (merchantPhone !== (r.merchantPhone ?? '')) body.merchantPhone = merchantPhone || null;
    if (merchantEmail !== (r.merchantEmail ?? '')) body.merchantEmail = merchantEmail || null;
    if (assignedRepId !== (r.assignedRepId ?? '')) body.assignedRepId = assignedRepId || null;
    if (Object.keys(body).length === 0) return;
    await onDealPatch(r.dealId, body);
  }

  function saveCommission() {
    const body: Record<string, unknown> = { paidAmount: Number(paid), status, notes, earlyPayoffDiscount: earlyPayoffDiscount || null };
    if (gross !== (r.grossCommission ?? '')) body.grossCommission = Number(gross) || 0;
    if (brokerFee !== (r.brokerFee ?? '')) body.brokerFee = Number(brokerFee) || 0;
    if (splitPct !== (r.repSplitPct ?? '')) body.repSplitPct = Number(splitPct) || 0;
    if (fundingDate && fundingDate !== (r.fundingDate ?? '').slice(0, 10)) body.fundingDate = fundingDate;
    onPatch(r.id, body);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <Detail label="Funded amount" value={r.fundedAmount ? formatCurrency(Number(r.fundedAmount)) : '—'} />
        <Detail label="Rate" value={r.rate ?? '—'} />
        <Detail label="Term" value={r.termMode && r.termCount ? `${Number(r.termCount)} ${r.termMode === 'daily' ? 'days' : 'weeks'}` : (r.termMonths ? `${r.termMonths} mo` : '—')} />
        <Detail label="Fees" value={r.fees ? formatCurrency(Number(r.fees)) : '—'} />
        <Detail label="Pending" value={formatCurrency(r.pendingAmount)} />
        <Detail label="Cleared date" value={r.clearedDate ? formatDate(r.clearedDate) : '—'} />
      </div>

      {isAdmin && (
        <>
          {/* Editable deal details — patches the underlying deal record */}
          <div className="space-y-3 pt-3 border-t border-border">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Deal details (editable)</div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Deal name" className="w-56"><Input value={dealName} onChange={(e) => setDealName(e.target.value)} /></Field>
              <Field label="Assigned rep" className="w-48">
                <select value={assignedRepId} onChange={(e) => setAssignedRepId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-card px-2 text-sm">
                  <option value="">— Unassigned —</option>
                  {reps.map((rep) => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
                </select>
              </Field>
              <Field label="Merchant first name" className="w-44"><Input value={merchantFirstName} onChange={(e) => setMerchantFirstName(e.target.value)} /></Field>
              <Field label="Merchant last name" className="w-44"><Input value={merchantLastName} onChange={(e) => setMerchantLastName(e.target.value)} /></Field>
              <Field label="Merchant phone" className="w-40"><Input value={merchantPhone} onChange={(e) => setMerchantPhone(e.target.value)} /></Field>
              <Field label="Merchant email" className="w-56"><Input value={merchantEmail} onChange={(e) => setMerchantEmail(e.target.value)} /></Field>
              <Button size="sm" onClick={saveDeal}>Save deal details</Button>
            </div>
          </div>

          {/* Editable commission math */}
          <div className="space-y-3 pt-3 border-t border-border">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Commission math (editable)</div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Total commission ($)" className="w-40"><Input inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="10000" /></Field>
              <Field label="Broker fee ($)" className="w-32"><Input inputMode="decimal" value={brokerFee} onChange={(e) => setBrokerFee(e.target.value)} placeholder="2000" /></Field>
              <Field label="Rep split %" className="w-28"><Input inputMode="decimal" value={splitPct} onChange={(e) => setSplitPct(e.target.value)} placeholder="50" /></Field>
              <Field label="Funded date" className="w-40"><Input type="date" value={fundingDate} onChange={(e) => setFundingDate(e.target.value)} /></Field>
              <div className="px-3 py-2 rounded bg-muted/40 text-xs">
                <span className="text-muted-foreground">Rep gets: </span>
                <span className="font-semibold tabular-nums">{formatCurrency(computed)}</span>
              </div>
            </div>

            {/* Status / paid / notes / early payoff */}
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Paid amount" className="w-36"><Input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
              <Field label="Status" className="w-40">
                <select value={status} onChange={(e) => setStatus(e.target.value as Commission['status'])} className="h-10 w-full rounded-md border border-input bg-card px-2 text-sm">
                  <option value="pending">Pending</option><option value="cleared">Cleared</option><option value="clawed_back">Clawed Back</option>
                </select>
              </Field>
              <Field label="Early payoff discount" className="w-44"><Input value={earlyPayoffDiscount} onChange={(e) => setEarlyPayoffDiscount(e.target.value)} placeholder="e.g. 10% or $500" /></Field>
              <Field label="Notes" className="flex-1 min-w-[180px]"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
              <Button size="sm" onClick={saveCommission}>Save commission</Button>
              <Button size="sm" variant="outline" onClick={() => onDelete(r.id)}>Remove</Button>
            </div>
          </div>
        </>
      )}
      {isAdmin && <LogPaymentInline commissionId={r.id} repId={r.repId} onLogged={() => onPatch(r.id, {})} />}
      {r.notes && !isAdmin && <div className="text-xs text-muted-foreground italic">Note: {r.notes}</div>}
    </div>
  );
}

/** Inline "log a payment against this commission" row. */
function LogPaymentInline({ commissionId, repId, onLogged }: { commissionId: string; repId: string | null; onLogged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('ach');
  const [confirmationNumber, setConfirmationNumber] = useState('');
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [payments, setPayments] = useState<Array<{ id: string; amount: string; paidDate: string; method: string | null; confirmationNumber: string | null }>>([]);

  async function loadPayments() {
    try {
      const res = await fetch(`/api/commission-payments?dealCommissionId=${commissionId}`);
      const j = await res.json();
      setPayments(j.payments ?? []);
    } catch { /* ignore */ }
  }
  useEffect(() => { loadPayments(); }, [commissionId]);

  async function log() {
    if (!amount) { toast.error('Enter an amount.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/commission-payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealCommissionId: commissionId, repId, amount, method, confirmationNumber, paidDate }),
      });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || 'Failed'); return; }
      toast.success('Payment logged.');
      setOpen(false); setAmount(''); setConfirmationNumber('');
      loadPayments();
      onLogged();
    } finally { setSaving(false); }
  }

  async function deletePayment(id: string) {
    if (!confirm('Delete this payment? The paid amount on this commission will be reversed.')) return;
    const res = await fetch(`/api/commission-payments/${id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Delete failed'); return; }
    toast.success('Payment removed.');
    loadPayments();
    onLogged();
  }

  return (
    <div className="mt-2 pt-2 border-t border-dashed border-border">
      {payments.length > 0 && (
        <div className="mb-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Logged payments</div>
          <div className="space-y-1">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1.5">
                <div className="flex items-center gap-3 tabular-nums">
                  <span className="text-muted-foreground">{new Date(p.paidDate).toLocaleDateString()}</span>
                  <span className="font-medium text-emerald-700">{formatCurrency(Number(p.amount))}</span>
                  {p.method && <span className="uppercase text-[10px] text-muted-foreground">{p.method}</span>}
                  {p.confirmationNumber && <span className="text-muted-foreground">#{p.confirmationNumber}</span>}
                </div>
                <button onClick={() => deletePayment(p.id)} className="text-xs text-rose-600 hover:underline">Delete</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {!open ? (
        <button onClick={() => setOpen(true)} className="text-xs text-primary hover:underline">+ Log a payment</button>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Amount" className="w-28"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" /></Field>
          <Field label="Method" className="w-28">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-10 w-full rounded-md border border-input bg-card px-2 text-sm">
              {['ach', 'wire', 'check', 'cash', 'zelle', 'other'].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
            </select>
          </Field>
          <Field label="Confirmation #" className="w-36"><Input value={confirmationNumber} onChange={(e) => setConfirmationNumber(e.target.value)} /></Field>
          <Field label="Date" className="w-36"><Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} /></Field>
          <Button size="sm" onClick={log} loading={saving}>Log</Button>
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div><div className="tabular-nums">{value}</div></div>;
}

/* ---------- Dashboard tile (used by LS commissions header) ---------- */
function Tile({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' | 'rose' }) {
  const bar = tone === 'emerald' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : tone === 'rose' ? 'bg-rose-500' : 'bg-primary';
  const text = tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : tone === 'rose' ? 'text-rose-700' : 'text-foreground';
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className={`h-1 w-8 rounded-full ${bar} mb-2`} />
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold tracking-tight mt-1 tabular-nums ${text}`}>{value}</div>
    </div>
  );
}

/* ---------- Lead source commission detail (expanded row) ---------- */
function LSCommissionDetail({
  r,
  reps,
  onPatch,
  onDelete,
  onDealPatch,
}: {
  r: LSCommission;
  reps: Rep[];
  onPatch: (id: string, body: Record<string, unknown>) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onDealPatch: (dealId: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [paid, setPaid] = useState(String(r.paidAmount));
  const [status, setStatus] = useState<'pending' | 'cleared' | 'clawed_back'>(r.status);
  const [earlyPayoffDiscount, setEarlyPayoffDiscount] = useState(r.earlyPayoffDiscount ?? '');
  const [notes, setNotes] = useState(r.notes ?? '');
  // Editable math
  const [gross, setGross] = useState(r.grossCommission ?? '');
  const [brokerFee, setBrokerFee] = useState(r.brokerFee ?? '');
  const [splitPct, setSplitPct] = useState(r.splitPct ?? '');
  const [flatAmount, setFlatAmount] = useState(r.flatAmount ?? '');
  const [mode, setMode] = useState<'split' | 'flat'>(r.flatAmount && Number(r.flatAmount) > 0 ? 'flat' : 'split');
  const [fundingDate, setFundingDate] = useState(r.fundingDate ? r.fundingDate.slice(0, 10) : '');
  // Editable deal fields (admin patches the parent deal record)
  const [dealName, setDealName] = useState(r.dealName);
  const [merchantFirstName, setMerchantFirstName] = useState(r.merchantFirstName ?? '');
  const [merchantLastName, setMerchantLastName] = useState(r.merchantLastName ?? '');
  const [merchantPhone, setMerchantPhone] = useState(r.merchantPhone ?? '');
  const [merchantEmail, setMerchantEmail] = useState(r.merchantEmail ?? '');
  const [assignedRepId, setAssignedRepId] = useState(r.assignedRepId ?? '');

  async function saveDeal() {
    const body: Record<string, unknown> = {};
    if (dealName !== r.dealName) body.name = dealName;
    if (merchantFirstName !== (r.merchantFirstName ?? '')) body.merchantFirstName = merchantFirstName || null;
    if (merchantLastName !== (r.merchantLastName ?? '')) body.merchantLastName = merchantLastName || null;
    if (merchantPhone !== (r.merchantPhone ?? '')) body.merchantPhone = merchantPhone || null;
    if (merchantEmail !== (r.merchantEmail ?? '')) body.merchantEmail = merchantEmail || null;
    if (assignedRepId !== (r.assignedRepId ?? '')) body.assignedRepId = assignedRepId || null;
    if (Object.keys(body).length === 0) return;
    await onDealPatch(r.dealId, body);
  }

  // Live-compute owed amount preview.
  const computed = useMemo(() => {
    if (mode === 'flat') return parseFloat(flatAmount) || 0;
    const g = parseFloat(gross) || 0; const b = parseFloat(brokerFee) || 0; const s = parseFloat(splitPct) || 0;
    return Math.round((g + b) * (s / 100) * 100) / 100;
  }, [mode, gross, brokerFee, splitPct, flatAmount]);

  function saveAll() {
    const body: Record<string, unknown> = {
      paidAmount: Number(paid), status,
      earlyPayoffDiscount: earlyPayoffDiscount || null, notes,
    };
    if (gross !== (r.grossCommission ?? '')) body.grossCommission = Number(gross) || 0;
    if (brokerFee !== (r.brokerFee ?? '')) body.brokerFee = Number(brokerFee) || 0;
    if (mode === 'split' && splitPct !== (r.splitPct ?? '')) { body.splitPct = Number(splitPct) || 0; body.flatAmount = null; }
    if (mode === 'flat' && flatAmount !== (r.flatAmount ?? '')) { body.flatAmount = Number(flatAmount) || 0; body.splitPct = null; }
    if (fundingDate && fundingDate !== (r.fundingDate ?? '').slice(0, 10)) body.fundingDate = fundingDate;
    onPatch(r.id, body);
  }

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <Detail label="Lead source" value={r.leadSourceName} />
        <Detail label="Deal" value={r.dealName} />
        <Detail label="Owed (now)" value={formatCurrency(r.owedAmount)} />
        <Detail label="Funded" value={r.fundingDate ? formatDate(r.fundingDate) : '—'} />
      </div>

      {/* Editable deal details — patches the underlying deal record */}
      <div className="pt-2 border-t border-dashed border-border">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Deal details (editable)</div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Deal name" className="w-56"><Input value={dealName} onChange={(e) => setDealName(e.target.value)} /></Field>
          <Field label="Assigned rep" className="w-48">
            <select value={assignedRepId} onChange={(e) => setAssignedRepId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-card px-2 text-sm">
              <option value="">— Unassigned —</option>
              {reps.map((rep) => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
            </select>
          </Field>
          <Field label="Merchant first name" className="w-44"><Input value={merchantFirstName} onChange={(e) => setMerchantFirstName(e.target.value)} /></Field>
          <Field label="Merchant last name" className="w-44"><Input value={merchantLastName} onChange={(e) => setMerchantLastName(e.target.value)} /></Field>
          <Field label="Merchant phone" className="w-40"><Input value={merchantPhone} onChange={(e) => setMerchantPhone(e.target.value)} /></Field>
          <Field label="Merchant email" className="w-56"><Input value={merchantEmail} onChange={(e) => setMerchantEmail(e.target.value)} /></Field>
          <Button size="sm" onClick={saveDeal}>Save deal details</Button>
        </div>
      </div>

      {/* Editable commission math */}
      <div className="pt-2 border-t border-dashed border-border">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Commission math (editable)</div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Total commission ($)" className="w-40"><Input inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="10000" /></Field>
          <Field label="Broker fee ($)" className="w-32"><Input inputMode="decimal" value={brokerFee} onChange={(e) => setBrokerFee(e.target.value)} placeholder="2000" /></Field>
          <Field label="Funded date" className="w-40"><Input type="date" value={fundingDate} onChange={(e) => setFundingDate(e.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap items-end gap-2 mt-2">
          <Field label="LS pays as" className="w-44">
            <select value={mode} onChange={(e) => setMode(e.target.value as 'split' | 'flat')} className="h-10 w-full rounded-md border border-input bg-card px-2 text-sm">
              <option value="split">Split %</option>
              <option value="flat">Flat amount</option>
            </select>
          </Field>
          {mode === 'split'
            ? <Field label="Split %" className="w-28"><Input inputMode="decimal" value={splitPct} onChange={(e) => setSplitPct(e.target.value)} placeholder="10" /></Field>
            : <Field label="Flat amount" className="w-36"><Input inputMode="decimal" value={flatAmount} onChange={(e) => setFlatAmount(e.target.value)} placeholder="500" /></Field>}
          <div className="px-3 py-2 rounded bg-muted/40 text-xs">
            <span className="text-muted-foreground">LS gets: </span>
            <span className="font-semibold tabular-nums">{formatCurrency(computed)}</span>
          </div>
        </div>
      </div>

      {/* Status / paid / early payoff / notes */}
      <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-dashed border-border">
        <Field label="Paid amount" className="w-32"><Input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
        <Field label="Status" className="w-36">
          <select value={status} onChange={(e) => setStatus(e.target.value as 'pending' | 'cleared' | 'clawed_back')} className="h-10 w-full rounded-md border border-input bg-card px-2 text-sm">
            <option value="pending">Pending</option>
            <option value="cleared">Cleared (Paid)</option>
            <option value="clawed_back">Clawed Back</option>
          </select>
        </Field>
        <Field label="Early payoff discount" className="w-48"><Input value={earlyPayoffDiscount} onChange={(e) => setEarlyPayoffDiscount(e.target.value)} placeholder="e.g. 10% or $500" /></Field>
        <Field label="Notes" className="flex-1 min-w-[180px]"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Visible to the lead source" /></Field>
        <Button size="sm" onClick={saveAll}>Save</Button>
        <Button size="sm" variant="outline" onClick={() => onDelete(r.id)}>Remove</Button>
      </div>

      <LogLSPaymentInline lsCommissionId={r.id} onLogged={() => onPatch(r.id, {})} />
    </div>
  );
}

/* ---------- Inline "log a payment against this lead-source commission" ---------- */
function LogLSPaymentInline({ lsCommissionId, onLogged }: { lsCommissionId: string; onLogged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('ach');
  const [confirmationNumber, setConfirmationNumber] = useState('');
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [payments, setPayments] = useState<Array<{ id: string; amount: string; paidDate: string; method: string | null; confirmationNumber: string | null }>>([]);

  async function loadPayments() {
    try {
      const res = await fetch(`/api/commission-payments?leadSourceCommissionId=${lsCommissionId}`);
      const j = await res.json();
      setPayments(j.payments ?? []);
    } catch { /* ignore */ }
  }
  useEffect(() => { loadPayments(); }, [lsCommissionId]);

  async function log() {
    if (!amount) { toast.error('Enter an amount.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/commission-payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadSourceCommissionId: lsCommissionId, amount, method, confirmationNumber, paidDate }),
      });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || 'Failed'); return; }
      toast.success('Payment logged.');
      setOpen(false); setAmount(''); setConfirmationNumber('');
      loadPayments();
      onLogged();
    } finally { setSaving(false); }
  }

  async function deletePayment(id: string) {
    if (!confirm('Delete this payment? The lead source will no longer see it, and the paid amount will be reversed.')) return;
    const res = await fetch(`/api/commission-payments/${id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Delete failed'); return; }
    toast.success('Payment removed.');
    loadPayments();
    onLogged();
  }

  return (
    <div className="mt-2 pt-2 border-t border-dashed border-border">
      {payments.length > 0 && (
        <div className="mb-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Logged payments</div>
          <div className="space-y-1">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1.5">
                <div className="flex items-center gap-3 tabular-nums">
                  <span className="text-muted-foreground">{new Date(p.paidDate).toLocaleDateString()}</span>
                  <span className="font-medium text-emerald-700">{formatCurrency(Number(p.amount))}</span>
                  {p.method && <span className="uppercase text-[10px] text-muted-foreground">{p.method}</span>}
                  {p.confirmationNumber && <span className="text-muted-foreground">#{p.confirmationNumber}</span>}
                </div>
                <button onClick={() => deletePayment(p.id)} className="text-xs text-rose-600 hover:underline">Delete</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {!open ? (
        <button onClick={() => setOpen(true)} className="text-xs text-primary hover:underline">+ Log a payment</button>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Amount" className="w-28"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" /></Field>
          <Field label="Method" className="w-28">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-10 w-full rounded-md border border-input bg-card px-2 text-sm">
              {['ach', 'wire', 'check', 'cash', 'zelle', 'other'].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
            </select>
          </Field>
          <Field label="Confirmation #" className="w-36"><Input value={confirmationNumber} onChange={(e) => setConfirmationNumber(e.target.value)} /></Field>
          <Field label="Date" className="w-36"><Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} /></Field>
          <Button size="sm" onClick={log} loading={saving}>Log</Button>
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      )}
    </div>
  );
}
