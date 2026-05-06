'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Card, CardContent,
  Button, Input, Field, PageHeader, EmptyState, MoneyInput,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { Plus, X, Trash2, TrendingUp, Trophy } from 'lucide-react';

interface FundedEntry {
  id: string;
  repId: string;
  repName: string;
  dealInitials: string;
  amountFunded: string;
  fundedDate: string;
  notes: string | null;
  createdAt: string;
}

type Range = 'mtd' | 'wtd' | 'all';

export default function FundedBoardPage() {
  const toast = useToast();
  const [entries, setEntries] = useState<FundedEntry[]>([]);
  const [reps, setReps] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>('mtd');
  const [showForm, setShowForm] = useState(false);
  const [newEntry, setNewEntry] = useState({
    repId: '',
    dealInitials: '',
    amountFunded: '',
    fundedDate: new Date().toISOString().slice(0, 10),
    notes: '',
  });

  async function load() {
    setLoading(true);
    const [eRes, uRes] = await Promise.all([
      fetch('/api/funded-entries').then((r) => r.json()),
      fetch('/api/users').then((r) => r.json()).catch(() => ({ data: [] })),
    ]);
    setEntries(eRes.data ?? []);
    setReps((uRes.data ?? []).filter((u: { role: string }) => u.role !== 'master_admin'));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function saveEntry() {
    if (!newEntry.repId || !newEntry.dealInitials || !newEntry.amountFunded) {
      toast.error('Rep, deal initials, and amount are required.');
      return;
    }
    const res = await fetch('/api/funded-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newEntry),
    });
    if (!res.ok) {
      const j = await res.json();
      toast.error(j.error || 'Save failed.');
      return;
    }
    toast.success('Funded entry logged.');
    setShowForm(false);
    setNewEntry({
      repId: '', dealInitials: '', amountFunded: '',
      fundedDate: new Date().toISOString().slice(0, 10), notes: '',
    });
    load();
  }

  async function delEntry(id: string) {
    if (!confirm('Delete this entry?')) return;
    const res = await fetch(`/api/funded-entries/${id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Entry deleted.');
      setEntries((arr) => arr.filter((x) => x.id !== id));
    } else {
      toast.error('Delete failed.');
    }
  }

  // Filter by date range
  const filteredEntries = useMemo(() => {
    if (range === 'all') return entries;
    const now = new Date();
    let start: Date;
    if (range === 'mtd') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
      const dow = now.getDay(); // Sun=0, Mon=1
      start = new Date(now);
      start.setDate(now.getDate() - dow);
      start.setHours(0, 0, 0, 0);
    }
    return entries.filter((e) => new Date(e.fundedDate) >= start);
  }, [entries, range]);

  // Group by rep
  const repBoards = useMemo(() => {
    const byRep = new Map<string, { repId: string; repName: string; entries: FundedEntry[]; total: number }>();
    for (const e of filteredEntries) {
      if (!byRep.has(e.repId)) {
        byRep.set(e.repId, { repId: e.repId, repName: e.repName, entries: [], total: 0 });
      }
      const row = byRep.get(e.repId)!;
      row.entries.push(e);
      row.total += parseFloat(e.amountFunded);
    }
    // Sort entries within each rep by date desc
    for (const row of byRep.values()) {
      row.entries.sort((a, b) => new Date(b.fundedDate).getTime() - new Date(a.fundedDate).getTime());
    }
    // Sort reps by total desc
    return Array.from(byRep.values()).sort((a, b) => b.total - a.total);
  }, [filteredEntries]);

  // KPIs
  const totalAmount = repBoards.reduce((s, r) => s + r.total, 0);
  const totalCount = filteredEntries.length;
  const topRep = repBoards[0];

  const rangeLabel: Record<Range, string> = {
    mtd: 'This Month',
    wtd: 'This Week',
    all: 'All Time',
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Funded Board"
        description="Production board — funded deals organized by rep."
        actions={
          <Button onClick={() => setShowForm(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Log funded
          </Button>
        }
      />

      {/* Range toggle */}
      <div className="flex flex-wrap items-center gap-2">
        {(['mtd', 'wtd', 'all'] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all',
              range === r
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
            )}
          >
            {rangeLabel[r]}
          </button>
        ))}
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="kpi-tile bg-primary/5 border-primary/20">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-medium text-muted-foreground">{rangeLabel[range]} Volume</div>
              <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mt-0.5">Total funded</div>
            </div>
            <div className="p-2 rounded-md bg-primary/10">
              <TrendingUp className="h-4 w-4 text-primary" />
            </div>
          </div>
          <div className="text-3xl font-semibold tracking-tight mt-3 tabular-nums text-primary">
            {formatCurrency(totalAmount, { compact: true })}
          </div>
        </div>

        <div className="kpi-tile">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Funded Deals</div>
              <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mt-0.5">{rangeLabel[range]}</div>
            </div>
            <div className="p-2 rounded-md bg-emerald-50">
              <span className="block h-4 w-4 rounded-full bg-emerald-600" />
            </div>
          </div>
          <div className="text-3xl font-semibold tracking-tight mt-3 tabular-nums">{totalCount}</div>
        </div>

        <div className="kpi-tile">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Top Rep</div>
              <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mt-0.5">{rangeLabel[range]}</div>
            </div>
            <div className="p-2 rounded-md bg-amber-50">
              <Trophy className="h-4 w-4 text-amber-600" />
            </div>
          </div>
          {topRep ? (
            <div className="mt-3">
              <div className="text-base font-semibold truncate">{topRep.repName}</div>
              <div className="text-sm text-muted-foreground tabular-nums">{formatCurrency(topRep.total)} · {topRep.entries.length} deals</div>
            </div>
          ) : (
            <div className="text-3xl font-semibold tracking-tight mt-3 text-muted-foreground/40">—</div>
          )}
        </div>
      </div>

      {/* New entry form */}
      {showForm && (
        <Card className="border-primary/40 bg-primary/[0.02]">
          <CardContent className="p-4 space-y-3">
            <div className="text-sm font-semibold flex items-center justify-between">
              <span>Log a funded deal</span>
              <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground p-1">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Rep" required>
                <select
                  value={newEntry.repId}
                  onChange={(e) => setNewEntry({ ...newEntry, repId: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
                >
                  <option value="">— select —</option>
                  {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
              <Field label="Deal initials" required>
                <Input
                  placeholder="ACME"
                  value={newEntry.dealInitials}
                  onChange={(e) => setNewEntry({ ...newEntry, dealInitials: e.target.value.toUpperCase() })}
                  maxLength={8}
                />
              </Field>
              <Field label="Amount funded" required>
                <MoneyInput
                  value={newEntry.amountFunded === '' ? '' : Number(newEntry.amountFunded)}
                  onValueChange={(v) => setNewEntry({ ...newEntry, amountFunded: v === '' ? '' : String(v) })}
                  placeholder="50,000"
                />
              </Field>
              <Field label="Funded date">
                <Input
                  type="date"
                  value={newEntry.fundedDate}
                  onChange={(e) => setNewEntry({ ...newEntry, fundedDate: e.target.value })}
                />
              </Field>
              <div className="col-span-2 sm:col-span-4">
                <Field label="Notes (optional)">
                  <Input
                    value={newEntry.notes}
                    onChange={(e) => setNewEntry({ ...newEntry, notes: e.target.value })}
                    placeholder="Optional internal note"
                  />
                </Field>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={saveEntry}>Save entry</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Production rows — one per rep */}
      {loading ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : repBoards.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={TrendingUp}
              title={range === 'all' ? 'No funded deals yet' : `Nothing funded ${range === 'mtd' ? 'this month' : 'this week'} yet`}
              description="Log your first funded deal to start tracking rep production."
              action={<Button onClick={() => setShowForm(true)}>Log a deal</Button>}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {repBoards.map((rep, i) => (
            <RepRow
              key={rep.repId}
              rank={i + 1}
              rep={rep}
              maxTotal={Math.max(...repBoards.map((r) => r.total))}
              onDelete={delEntry}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RepRow({
  rank, rep, maxTotal, onDelete,
}: {
  rank: number;
  rep: { repId: string; repName: string; entries: FundedEntry[]; total: number };
  maxTotal: number;
  onDelete: (id: string) => void;
}) {
  const initial = (rep.repName || 'U').charAt(0).toUpperCase();
  const widthPct = maxTotal > 0 ? (rep.total / maxTotal) * 100 : 0;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="grid grid-cols-[180px_1fr] sm:grid-cols-[220px_1fr]">
          {/* Left: rep summary */}
          <div className="border-r border-border bg-muted/30 p-4 flex flex-col justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                'h-10 w-10 rounded-full flex items-center justify-center shrink-0 font-semibold',
                rank === 1 ? 'bg-amber-100 text-amber-800 ring-2 ring-amber-300' :
                rank === 2 ? 'bg-slate-100 text-slate-700 ring-2 ring-slate-300' :
                rank === 3 ? 'bg-orange-100 text-orange-700 ring-2 ring-orange-300' :
                'bg-muted text-foreground/70 ring-1 ring-border'
              )}>
                {initial}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{rep.repName}</div>
                <div className="text-xs text-muted-foreground">{rep.entries.length} {rep.entries.length === 1 ? 'deal' : 'deals'}</div>
              </div>
            </div>
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Total</div>
              <div className="text-xl font-semibold tracking-tight tabular-nums text-primary">
                {formatCurrency(rep.total)}
              </div>
              {/* progress bar relative to top performer */}
              <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
          </div>

          {/* Right: deal chips, horizontal scrollable */}
          <div className="overflow-x-auto p-4">
            <div className="flex items-stretch gap-2 min-w-max">
              {rep.entries.map((e) => (
                <DealChip key={e.id} entry={e} onDelete={() => onDelete(e.id)} />
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DealChip({ entry, onDelete }: { entry: FundedEntry; onDelete: () => void }) {
  const amt = parseFloat(entry.amountFunded);
  return (
    <div className="group relative rounded-lg border border-border bg-card p-3 min-w-[140px] hover:border-primary/30 hover:shadow-sm transition-all">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-sm font-semibold tracking-tight font-mono">{entry.dealInitials}</span>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-0.5"
          title="Delete entry"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <div className="text-base font-semibold tabular-nums text-emerald-700">
        {formatCurrency(amt, { compact: true })}
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums mt-1">
        {formatDate(entry.fundedDate)}
      </div>
      {entry.notes && (
        <div className="text-[10px] text-muted-foreground mt-1 line-clamp-2 italic" title={entry.notes}>
          {entry.notes}
        </div>
      )}
    </div>
  );
}
