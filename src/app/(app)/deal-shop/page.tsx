'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, Badge, PageHeader } from '@/components/ui/primitives';
import { US_STATES, COMMON_INDUSTRIES, CREDIT_TIER_OPTIONS } from '@/lib/constants';
import { Send, ChevronDown, ChevronRight, Mail, Phone, MapPin, Ban, FileText, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MatchResult } from '@/lib/matching/engine';

interface MatchResponse { matched: MatchResult[]; excluded: MatchResult[]; }

interface FunderDetail {
  id: string;
  name: string;
  tiers?: { id: string; name: string }[];
  contacts?: { name: string; email?: string | null; phone?: string | null }[];
  restrictedStates?: string[];
  restrictedIndustries?: string[];
  notes?: string | null;
  submissionMethod?: string;
}

const REVENUE_OPTIONS = [
  { value: '', label: '— Revenue —' },
  { value: '0-15000', label: '$0 – $15K' },
  { value: '15000-25000', label: '$15K – $25K' },
  { value: '25000-50000', label: '$25K – $50K' },
  { value: '50000-100000', label: '$50K – $100K' },
  { value: '100000-250000', label: '$100K – $250K' },
  { value: '250000-500000', label: '$250K – $500K' },
  { value: '500000-1000000', label: '$500K – $1M' },
  { value: '1000000+', label: '$1M+' },
];

const POSITION_OPTIONS = [
  { value: '', label: '— Position —' },
  { value: '0', label: 'Position 0 (no stack)' },
  { value: '1', label: 'Position 1' },
  { value: '2', label: 'Position 2' },
  { value: '3', label: 'Position 3' },
  { value: '4', label: 'Position 4' },
  { value: '5+', label: '5+ positions' },
];

const NSF_OPTIONS = [
  { value: '', label: '— NSFs —' },
  { value: '0', label: '0 NSFs' },
  { value: '1', label: '1 NSF' },
  { value: '2', label: '2 NSFs' },
  { value: '3', label: '3 NSFs' },
  { value: '4', label: '4 NSFs' },
  { value: '5+', label: '5+ NSFs' },
];

function revenueMid(range: string): number {
  if (!range) return 0;
  if (range.endsWith('+')) return parseInt(range);
  const [a, b] = range.split('-').map((n) => parseInt(n));
  return Math.floor((a + b) / 2);
}

export default function DealShopPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    revenue: '',
    credit: 'unknown',
    nsfs: '',
    position: '',
    state: 'other',
    industry: 'other',
    reverseConsolidation: false,
  });
  const [results, setResults] = useState<MatchResponse | null>(null);
  const [funderMap, setFunderMap] = useState<Map<string, FunderDetail>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTier, setActiveTier] = useState<string>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/funders')
      .then((r) => r.json())
      .then((j) => {
        const list: FunderDetail[] = j.data ?? j.funders ?? [];
        const m = new Map<string, FunderDetail>();
        list.forEach((f) => m.set(f.id, f));
        setFunderMap(m);
      })
      .catch(() => {});
  }, []);

  async function runMatch() {
    const missing: string[] = [];
    if (!form.revenue) missing.push('Revenue');
    if (!form.position) missing.push('Position');
    if (form.nsfs === '') missing.push('NSF Count');
    if (missing.length) {
      setError('Required: ' + missing.join(', '));
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/deal-shop/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monthlyRevenue: revenueMid(form.revenue),
          creditScore: form.credit,
          positions: parseInt(form.position) || 0,
          industry: form.industry,
          state: form.state,
          dealType: form.reverseConsolidation ? 'reverse_consolidation' : 'standard_mca',
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Match failed');
        setResults(null);
        return;
      }
      setResults(json);
      setActiveTier('all');
      setExpanded(new Set());
    } finally {
      setLoading(false);
    }
  }

  function toSubmit() {
    const params = new URLSearchParams({ shop: '1' });
    router.push(`/submit?${params.toString()}`);
  }

  // Group matched + excluded by tier
  const tierGroups = useMemo(() => {
    if (!results) return [];
    const map = new Map<string, { matched: MatchResult[]; excluded: MatchResult[] }>();
    function tierFor(funderId: string): string {
      const f = funderMap.get(funderId);
      return f?.tiers && f.tiers.length > 0 ? f.tiers[0].name : 'Untiered';
    }
    for (const m of results.matched) {
      const t = tierFor(m.funderId);
      if (!map.has(t)) map.set(t, { matched: [], excluded: [] });
      map.get(t)!.matched.push(m);
    }
    for (const e of results.excluded) {
      const t = tierFor(e.funderId);
      if (!map.has(t)) map.set(t, { matched: [], excluded: [] });
      map.get(t)!.excluded.push(e);
    }
    return Array.from(map.entries())
      .map(([tier, v]) => ({ tier, ...v }))
      .sort((a, b) => a.tier.localeCompare(b.tier));
  }, [results, funderMap]);

  const filteredGroups = activeTier === 'all'
    ? tierGroups
    : tierGroups.filter((g) => g.tier === activeTier);

  const totalMatched = results?.matched.length ?? 0;
  const totalExcluded = results?.excluded.length ?? 0;

  function toggleExpand(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Shop Deals"
        description="Match a deal profile to qualifying funders. Then send via Submit Deal."
        actions={
          results && totalMatched > 0 ? (
            <Button onClick={toSubmit} className="gap-2">
              <Send className="h-4 w-4" />
              Submit deal →
            </Button>
          ) : undefined
        }
      />

      {/* Top filter bar */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <Select value={form.revenue} onChange={(v) => setForm({ ...form, revenue: v })} options={REVENUE_OPTIONS} />
            <Select
              value={form.credit}
              onChange={(v) => setForm({ ...form, credit: v })}
              options={[
                { value: 'unknown', label: '— Credit —' },
                ...CREDIT_TIER_OPTIONS.filter((o) => o.value !== 'unknown'),
              ]}
            />
            <Select value={form.nsfs} onChange={(v) => setForm({ ...form, nsfs: v })} options={NSF_OPTIONS} />
            <Select value={form.position} onChange={(v) => setForm({ ...form, position: v })} options={POSITION_OPTIONS} />
            <Select
              value={form.state}
              onChange={(v) => setForm({ ...form, state: v })}
              options={[
                { value: 'other', label: '— State —' },
                ...US_STATES.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` })),
              ]}
            />
            <Select
              value={form.industry}
              onChange={(v) => setForm({ ...form, industry: v })}
              options={[
                { value: 'other', label: '— Industry —' },
                ...COMMON_INDUSTRIES.map((i) => ({ value: i, label: i })),
              ]}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.reverseConsolidation}
                onChange={(e) => setForm({ ...form, reverseConsolidation: e.target.checked })}
                className="rounded"
              />
              <span>Reverse Consolidation</span>
            </label>
            <Button onClick={runMatch} loading={loading} className="gap-1.5 px-6">
              <Zap className="h-4 w-4" />
              Find Funders
            </Button>
          </div>

          {error && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {results && (
        totalMatched === 0 && totalExcluded === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-sm text-muted-foreground">
              No funders configured yet. Add some in the <a href="/funders" className="text-primary hover:underline">Funders</a> tab.
            </CardContent>
          </Card>
        ) : (
          <div className="grid lg:grid-cols-[200px_1fr] gap-4">
            {/* Tier rail */}
            <Card className="self-start lg:sticky lg:top-4">
              <CardContent className="p-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-3 py-2">
                  Filter by tier
                </div>
                <button
                  onClick={() => setActiveTier('all')}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 rounded text-sm transition-colors',
                    activeTier === 'all' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  <span>All tiers</span>
                  <Badge variant="outline" className="text-[10px]">{totalMatched + totalExcluded}</Badge>
                </button>
                {tierGroups.map((g) => (
                  <button
                    key={g.tier}
                    onClick={() => setActiveTier(g.tier)}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2 rounded text-sm transition-colors',
                      activeTier === g.tier ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted'
                    )}
                  >
                    <span className="truncate">{g.tier}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {g.matched.length > 0 && <Badge variant="success" className="text-[10px]">{g.matched.length}</Badge>}
                      {g.excluded.length > 0 && <Badge variant="default" className="text-[10px]">{g.excluded.length}</Badge>}
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* Results table */}
            <div className="space-y-4 min-w-0">
              {filteredGroups.map((g) => (
                <div key={g.tier}>
                  {activeTier === 'all' && (
                    <div className="flex items-baseline gap-3 mb-2 px-1">
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/80">{g.tier}</h3>
                      <span className="text-xs text-muted-foreground">
                        {g.matched.length} qualifying · {g.excluded.length} excluded
                      </span>
                    </div>
                  )}

                  {/* Qualifying funders */}
                  {g.matched.length > 0 && (
                    <Card className="overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/40 border-b border-border">
                            <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2">Funder</th>
                            <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Submission</th>
                            <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Primary email</th>
                            <th className="w-8"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {g.matched.map((m) => {
                            const f = funderMap.get(m.funderId);
                            const primary = f?.contacts?.find((c) => c.email);
                            const isExpanded = expanded.has(m.funderId);
                            return (
                              <>
                                <tr
                                  key={m.funderId}
                                  className="hover:bg-muted/30 cursor-pointer"
                                  onClick={() => toggleExpand(m.funderId)}
                                >
                                  <td className="px-4 py-2.5">
                                    <div className="flex items-center gap-2">
                                      <div className="h-2 w-2 rounded-full bg-emerald-500" />
                                      <span className="font-medium">{m.funderName}</span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <Badge variant="outline" className="text-[10px]">
                                      {f?.submissionMethod ?? 'email'}
                                    </Badge>
                                  </td>
                                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground truncate max-w-[200px]">
                                    {primary?.email ?? '—'}
                                  </td>
                                  <td className="px-2 py-2.5 text-muted-foreground">
                                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                  </td>
                                </tr>
                                {isExpanded && f && (
                                  <tr className="bg-muted/20">
                                    <td colSpan={4} className="px-4 py-3">
                                      <FunderDetailRow funder={f} />
                                    </td>
                                  </tr>
                                )}
                              </>
                            );
                          })}
                        </tbody>
                      </table>
                    </Card>
                  )}

                  {/* Excluded — collapsible compact list */}
                  {g.excluded.length > 0 && (
                    <details className="mt-2 group">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground py-1.5 px-2 flex items-center gap-1.5">
                        <ChevronRight className="h-3 w-3 group-open:rotate-90 transition-transform" />
                        {g.excluded.length} not qualifying
                      </summary>
                      <Card className="mt-1">
                        <CardContent className="p-0 divide-y divide-border/60">
                          {g.excluded.map((e) => (
                            <div key={e.funderId} className="px-4 py-2 flex items-center justify-between text-xs">
                              <span className="font-medium text-muted-foreground">{e.funderName}</span>
                              <span className="text-muted-foreground/80 text-right ml-3 truncate max-w-[60%]">
                                {e.reasons[0] ?? 'Excluded'}
                              </span>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function FunderDetailRow({ funder }: { funder: FunderDetail }) {
  const emails = (funder.contacts ?? []).filter((c) => c.email);
  const phones = (funder.contacts ?? []).filter((c) => c.phone);
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
      {emails.length > 0 && (
        <div>
          <div className="font-semibold uppercase tracking-wider text-[9px] text-muted-foreground mb-1.5 flex items-center gap-1">
            <Mail className="h-3 w-3" /> Submission emails
          </div>
          <div className="space-y-0.5">
            {emails.map((c, i) => (
              <div key={i} className="font-mono text-foreground">{c.email}</div>
            ))}
          </div>
        </div>
      )}
      {phones.length > 0 && (
        <div>
          <div className="font-semibold uppercase tracking-wider text-[9px] text-muted-foreground mb-1.5 flex items-center gap-1">
            <Phone className="h-3 w-3" /> Contacts
          </div>
          <div className="space-y-0.5">
            {phones.map((c, i) => (
              <div key={i}>
                <span className="font-medium">{c.name}</span> <span className="text-muted-foreground">{c.phone}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {((funder.restrictedStates?.length ?? 0) > 0 ||
        (funder.restrictedIndustries?.length ?? 0) > 0 ||
        funder.notes) && (
        <div className="bg-amber-50 border border-amber-200 rounded p-2.5 text-amber-900 space-y-1">
          {(funder.restrictedStates ?? []).length > 0 && (
            <div className="flex items-start gap-1">
              <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
              <span>Not in: {funder.restrictedStates!.join(', ')}</span>
            </div>
          )}
          {(funder.restrictedIndustries ?? []).length > 0 && (
            <div className="flex items-start gap-1">
              <Ban className="h-3 w-3 mt-0.5 shrink-0" />
              <span>No: {funder.restrictedIndustries!.join(', ')}</span>
            </div>
          )}
          {funder.notes && (
            <div className="flex items-start gap-1">
              <FileText className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{funder.notes}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
