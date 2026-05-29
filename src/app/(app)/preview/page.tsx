'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, Button, PageHeader, Badge } from '@/components/ui/primitives';
import { formatCurrency } from '@/lib/utils';
import { computePaydown } from '@/lib/deals/paydown';

interface Rep { id: string; name: string; role: string }
interface LeadSourceOpt { id: string; name: string }
interface Commission {
  id: string; dealName: string; repId: string | null;
  fundedAmount: string | null; rate: string | null; termMode: string | null; termCount: string | null;
  fundingDate: string | null; amountCollected: string | null;
  grossCommission: string; repSplitPct: string; repCommissionAmount: string;
  paidAmount: string; owedAmount: number; pendingAmount: number;
  status: 'pending' | 'cleared' | 'clawed_back';
  earlyPayoffDiscount: string | null; notes: string | null;
}
interface LSCommission {
  id: string; leadSourceId: string; leadSourceName: string;
  commissionAmount: string; paidAmount: string; owedAmount: number;
  status: 'pending' | 'cleared' | 'clawed_back';
  earlyPayoffDiscount: string | null; notes: string | null;
  fundingDate: string | null;
}

export default function PreviewPage() {
  const [mode, setMode] = useState<'rep' | 'lead_source'>('rep');
  const [reps, setReps] = useState<Rep[]>([]);
  const [leadSources, setLeadSources] = useState<LeadSourceOpt[]>([]);
  const [pickedRepId, setPickedRepId] = useState('');
  const [pickedLSId, setPickedLSId] = useState('');
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [lsCommissions, setLsCommissions] = useState<LSCommission[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [uRes, lsRes] = await Promise.all([fetch('/api/users'), fetch('/api/lead-sources')]);
        const uJ = await uRes.json();
        const lsJ = await lsRes.json();
        setReps((uJ.data ?? []).filter((u: Rep) => u.role === 'rep' || u.role === 'company_admin'));
        setLeadSources(lsJ.leadSources ?? []);
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        if (mode === 'rep') {
          const j = await (await fetch('/api/commissions')).json();
          setCommissions(j.commissions ?? []);
        } else {
          const j = await (await fetch('/api/lead-source-commissions')).json();
          setLsCommissions(j.data ?? j.leadSourceCommissions ?? []);
        }
      } finally { setLoading(false); }
    })();
  }, [mode]);

  // Filter to picked user only.
  const repCommissions = useMemo(() => commissions.filter((c) => pickedRepId && c.repId === pickedRepId), [commissions, pickedRepId]);
  const repStats = useMemo(() => {
    let total = 0, paid = 0, pending = 0, owed = 0;
    for (const r of repCommissions) {
      if (r.status === 'clawed_back') continue;
      const amt = Number(r.repCommissionAmount);
      total += amt; paid += Number(r.paidAmount); owed += r.owedAmount; pending += r.pendingAmount;
    }
    return { total, paid, pending, owed };
  }, [repCommissions]);

  const lsRows = useMemo(() => lsCommissions.filter((c) => pickedLSId && c.leadSourceId === pickedLSId), [lsCommissions, pickedLSId]);
  const lsStats = useMemo(() => {
    let total = 0, paid = 0, pending = 0, owed = 0, clawed = 0;
    for (const r of lsRows) {
      const amt = Number(r.commissionAmount);
      if (r.status === 'clawed_back') { clawed += amt; continue; }
      total += amt; paid += Number(r.paidAmount); owed += r.owedAmount;
      if (r.status === 'pending') pending += Math.max(0, amt - Number(r.paidAmount));
    }
    return { total, paid, pending, owed, clawed };
  }, [lsRows]);

  return (
    <div className="space-y-5">
      <PageHeader title="View as…" description="Preview what a rep or lead source sees when they log in. Read-only — selections here don't change anything." />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border border-border bg-card p-1">
          {(['rep', 'lead_source'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {m === 'rep' ? 'View as Rep' : 'View as Lead Source'}
            </button>
          ))}
        </div>
        {mode === 'rep' ? (
          <select value={pickedRepId} onChange={(e) => setPickedRepId(e.target.value)}
            className="h-9 rounded-full border border-input bg-card px-3 text-xs">
            <option value="">— Pick a rep —</option>
            {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        ) : (
          <select value={pickedLSId} onChange={(e) => setPickedLSId(e.target.value)}
            className="h-9 rounded-full border border-input bg-card px-3 text-xs">
            <option value="">— Pick a lead source —</option>
            {leadSources.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : mode === 'rep' && pickedRepId ? (
        <RepPreview commissions={repCommissions} stats={repStats} />
      ) : mode === 'lead_source' && pickedLSId ? (
        <LSPreview rows={lsRows} stats={lsStats} />
      ) : (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Pick {mode === 'rep' ? 'a rep' : 'a lead source'} above to preview their dashboard.</CardContent></Card>
      )}
    </div>
  );
}

function RepPreview({ commissions, stats }: { commissions: Commission[]; stats: { total: number; paid: number; pending: number; owed: number } }) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
        👁 Preview mode — this is what the rep sees on /commissions
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Total" value={formatCurrency(stats.total)} />
        <Tile label="Paid" value={formatCurrency(stats.paid)} tone="emerald" />
        <Tile label="Pending" value={formatCurrency(stats.pending)} tone="amber" />
        <Tile label="Owed" value={formatCurrency(stats.owed)} />
      </div>
      {commissions.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">This rep has no commissions.</CardContent></Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2">Deal</th><th className="px-3 py-2 text-right">Gross</th>
              <th className="px-3 py-2 text-right">Split</th><th className="px-3 py-2 text-right">Rep comm.</th>
              <th className="px-3 py-2 text-right">Paid</th><th className="px-3 py-2 text-right">Owed</th>
              <th className="px-3 py-2">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-border/60">
              {commissions.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 font-medium">{r.dealName}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(Number(r.grossCommission))}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{Number(r.repSplitPct)}%</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium">{formatCurrency(Number(r.repCommissionAmount))}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{formatCurrency(Number(r.paidAmount))}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(r.owedAmount)}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant={r.status === 'cleared' ? 'success' : r.status === 'clawed_back' ? 'destructive' : 'warning'} className="text-[10px]">
                      {r.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function LSPreview({ rows, stats }: { rows: LSCommission[]; stats: { total: number; paid: number; pending: number; owed: number; clawed: number } }) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
        👁 Preview mode — this is what the lead source sees on /lead-source-portal (no deal names, no merchant info)
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Tile label="Total earned" value={formatCurrency(stats.total)} />
        <Tile label="Paid" value={formatCurrency(stats.paid)} tone="emerald" />
        <Tile label="Pending" value={formatCurrency(stats.pending)} tone="amber" />
        <Tile label="Still owed" value={formatCurrency(stats.owed)} />
        <Tile label="Clawed back" value={formatCurrency(stats.clawed)} tone="rose" />
      </div>
      {rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">This lead source has no commissions.</CardContent></Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2">Funded</th>
              <th className="px-3 py-2 text-right">Owed</th>
              <th className="px-3 py-2 text-right">Paid</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Notes</th>
            </tr></thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{r.fundingDate ? new Date(r.fundingDate).toLocaleDateString() : '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(Number(r.commissionAmount))}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{formatCurrency(Number(r.paidAmount))}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant={r.status === 'cleared' ? 'success' : r.status === 'clawed_back' ? 'destructive' : 'warning'} className="text-[10px]">
                      {r.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground max-w-[260px] truncate">{r.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' | 'rose' }) {
  const color = tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : tone === 'rose' ? 'text-rose-700' : 'text-foreground';
  return (
    <Card><CardContent className="p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`text-xl font-semibold tabular-nums mt-1 ${color}`}>{value}</div>
    </CardContent></Card>
  );
}
