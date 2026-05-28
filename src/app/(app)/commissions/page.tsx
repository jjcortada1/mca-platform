'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, Button, Input, Field, PageHeader, Badge } from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { formatCurrency, formatDate } from '@/lib/utils';

/* ---------- types ---------- */
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
interface Deal { id: string; name: string; assignedRepId: string | null; }
interface Rep { id: string; name: string; role: string; }
interface LeadSource { id: string; name: string; contactEmail: string | null; contactPhone: string | null; isActive: boolean; }
interface LSCommission {
  id: string; dealId: string; dealName: string; merchantName: string | null;
  leadSourceId: string; leadSourceName: string;
  grossCommission: string | null; splitPct: string | null; flatAmount: string | null;
  commissionAmount: string; paidAmount: string; owedAmount: number;
  status: 'pending' | 'cleared' | 'clawed_back'; notes: string | null;
}

const STATUS_TONE = { pending: 'warning', cleared: 'success', clawed_back: 'destructive' } as const;
const STATUS_LABEL = { pending: 'Pending', cleared: 'Cleared', clawed_back: 'Clawed Back' } as const;

type Tab = 'rep' | 'lead';

export default function CommissionsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('rep');
  const [isAdmin, setIsAdmin] = useState(false);

  const [rows, setRows] = useState<Commission[]>([]);
  const [lsRows, setLsRows] = useState<LSCommission[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [leadSources, setLeadSources] = useState<LeadSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [showLSAdd, setShowLSAdd] = useState(false);
  const [showNewLS, setShowNewLS] = useState(false);

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
        setDeals(((await dRes.json()).data ?? (await dRes.clone?.().json?.())?.deals ?? []) as Deal[]);
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

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/commissions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Update failed'); return; }
    toast.success('Updated.'); load();
  }
  async function softDelete(id: string) {
    if (!confirm('Remove this commission? It will be marked deleted (kept in the backup).')) return;
    const res = await fetch(`/api/commissions/${id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Delete failed'); return; }
    toast.success('Removed.'); load();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Commissions"
        description={isAdmin ? 'Manage rep + lead source commissions, splits, statuses, and payouts.' : 'Your commission earnings and payout status.'}
        actions={isAdmin ? (
          tab === 'rep'
            ? <Button onClick={() => setShowAdd(true)}>+ Add commission</Button>
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
                    <th className="w-8"></th>
                  </tr></thead>
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
                          <tr className="bg-muted/10"><td colSpan={isAdmin ? 9 : 8} className="px-4 py-3">
                            <CommissionDetail r={r} isAdmin={isAdmin} onPatch={patch} onDelete={softDelete} />
                          </td></tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {tab === 'lead' && isAdmin && (
        <Card className="overflow-hidden">
          {lsRows.length === 0 ? (
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No lead source commissions yet. Add a lead source, then assign it to a deal.
            </CardContent>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead><tr className="bg-muted/40 border-b border-border text-left">
                  <th className="px-4 py-2 th">Lead source</th>
                  <th className="px-3 py-2 th">Deal</th>
                  <th className="px-3 py-2 th text-right">Split / Flat</th>
                  <th className="px-3 py-2 th text-right">Commission</th>
                  <th className="px-3 py-2 th text-right">Paid</th>
                  <th className="px-3 py-2 th text-right">Owed</th>
                  <th className="px-3 py-2 th">Status</th>
                </tr></thead>
                <tbody className="divide-y divide-border/60">
                  {lsRows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium">{r.leadSourceName}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{r.dealName}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{r.flatAmount ? `$${Number(r.flatAmount).toLocaleString()}` : r.splitPct ? `${Number(r.splitPct)}%` : '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium">{formatCurrency(Number(r.commissionAmount))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{formatCurrency(Number(r.paidAmount))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(r.owedAmount)}</td>
                      <td className="px-3 py-2.5"><Badge variant={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {showAdd && <AddCommissionModal deals={deals} reps={reps} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {showNewLS && <NewLeadSourceModal onClose={() => setShowNewLS(false)} onSaved={() => { setShowNewLS(false); load(); }} />}
      {showLSAdd && <AssignLeadSourceModal deals={deals} leadSources={leadSources} onClose={() => setShowLSAdd(false)} onSaved={() => { setShowLSAdd(false); load(); }} />}

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
    dealId: '', repId: '', fundedAmount: '', rate: '', termMonths: '', fees: '',
    brokerFee: '', grossCommission: '', repSplitPct: '', fundingDate: new Date().toISOString().slice(0, 10),
    earlyPayoffDiscount: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  const repShare = useMemo(() => {
    const gross = parseFloat(f.grossCommission) || 0;
    const broker = parseFloat(f.brokerFee) || 0;
    const pct = (parseFloat(f.repSplitPct) || 0) / 100;
    return Math.round((gross + broker) * pct * 100) / 100;
  }, [f.grossCommission, f.brokerFee, f.repSplitPct]);

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
          fundedAmount: f.fundedAmount || null, rate: f.rate || null, termMonths: f.termMonths || null,
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
        <Field label="Funded amount ($)"><Input inputMode="decimal" value={f.fundedAmount} onChange={(e) => setF({ ...f, fundedAmount: e.target.value })} placeholder="100000" /></Field>
        <Field label="Rate (factor)"><Input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="1.49" /></Field>
        <Field label="Term (months)"><Input inputMode="decimal" value={f.termMonths} onChange={(e) => setF({ ...f, termMonths: e.target.value })} placeholder="6" /></Field>
        <Field label="Fees ($)"><Input inputMode="decimal" value={f.fees} onChange={(e) => setF({ ...f, fees: e.target.value })} placeholder="0" /></Field>
        <Field label="Gross commission ($)"><Input inputMode="decimal" value={f.grossCommission} onChange={(e) => setF({ ...f, grossCommission: e.target.value })} placeholder="10000" /></Field>
        <Field label="Broker fee ($)"><Input inputMode="decimal" value={f.brokerFee} onChange={(e) => setF({ ...f, brokerFee: e.target.value })} placeholder="0" /></Field>
        <Field label="Rep split %"><Input inputMode="decimal" value={f.repSplitPct} onChange={(e) => setF({ ...f, repSplitPct: e.target.value })} placeholder="30" /></Field>
        <Field label="Early payoff discount"><Input value={f.earlyPayoffDiscount} onChange={(e) => setF({ ...f, earlyPayoffDiscount: e.target.value })} placeholder="optional" /></Field>
        <div className="col-span-2">
          <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      </div>
      <div className="mt-3 rounded-lg bg-primary/5 border border-primary/20 p-3 text-sm">
        Rep commission (split of gross + same split of broker fee):{' '}
        <span className="font-semibold tabular-nums">{formatCurrency(repShare)}</span>
      </div>
    </Modal>
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
  const [f, setF] = useState({ dealId: '', leadSourceId: '', mode: 'split' as 'split' | 'flat', splitPct: '', flatAmount: '', notes: '' });
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!f.dealId || !f.leadSourceId) { toast.error('Pick a deal and a lead source.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/lead-source-commissions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId: f.dealId, leadSourceId: f.leadSourceId,
          splitPct: f.mode === 'split' ? (f.splitPct || 0) : null,
          flatAmount: f.mode === 'flat' ? (f.flatAmount || 0) : null,
          notes: f.notes || null,
        }),
      });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || 'Failed'); return; }
      toast.success('Lead source assigned.'); onSaved();
    } finally { setSaving(false); }
  }
  return (
    <Modal title="Assign lead source to a deal" onClose={onClose} onSave={save} saving={saving}>
      <div className="space-y-3">
        <Field label="Deal *">
          <select value={f.dealId} onChange={(e) => setF({ ...f, dealId: e.target.value })} className="sel">
            <option value="">— Pick a deal —</option>
            {deals.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Lead source *">
          <select value={f.leadSourceId} onChange={(e) => setF({ ...f, leadSourceId: e.target.value })} className="sel">
            <option value="">— Pick a lead source —</option>
            {leadSources.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Commission type">
          <div className="grid grid-cols-2 gap-2">
            {(['split', 'flat'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setF({ ...f, mode: m })}
                className={`px-3 py-2 rounded border-2 text-sm font-medium ${f.mode === m ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}>
                {m === 'split' ? 'Split % of gross' : 'Flat amount'}
              </button>
            ))}
          </div>
        </Field>
        {f.mode === 'split'
          ? <Field label="Split %"><Input inputMode="decimal" value={f.splitPct} onChange={(e) => setF({ ...f, splitPct: e.target.value })} placeholder="10" /></Field>
          : <Field label="Flat amount ($)"><Input inputMode="decimal" value={f.flatAmount} onChange={(e) => setF({ ...f, flatAmount: e.target.value })} placeholder="500" /></Field>}
        <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
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
          <Field label="Paid amount" className="w-36"><Input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
          <Field label="Status" className="w-40">
            <select value={status} onChange={(e) => setStatus(e.target.value as Commission['status'])} className="h-10 w-full rounded-md border border-input bg-card px-2 text-sm">
              <option value="pending">Pending</option><option value="cleared">Cleared</option><option value="clawed_back">Clawed Back</option>
            </select>
          </Field>
          <Field label="Notes" className="flex-1 min-w-[180px]"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <Button size="sm" onClick={() => onPatch(r.id, { paidAmount: Number(paid), status, notes })}>Save</Button>
          <Button size="sm" variant="outline" onClick={() => onDelete(r.id)}>Remove</Button>
        </div>
      )}
      {r.notes && !isAdmin && <div className="text-xs text-muted-foreground italic">Note: {r.notes}</div>}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div><div className="tabular-nums">{value}</div></div>;
}
