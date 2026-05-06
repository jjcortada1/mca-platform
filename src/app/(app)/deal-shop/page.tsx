'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, Badge, PageHeader, Field, MoneyInput } from '@/components/ui/primitives';
import { US_STATES } from '@/lib/constants';
import { Send, ChevronDown, ChevronRight, Mail, Phone, MapPin, Ban, FileText, Zap, Search } from 'lucide-react';
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

interface MatchOption {
  id: string;
  value: string;
  label: string;
  meta: Record<string, unknown> | null;
}

export default function DealShopPage() {
  const router = useRouter();

  // Editable options loaded from server
  const [creditRanges, setCreditRanges] = useState<MatchOption[]>([]);
  const [revenueRanges, setRevenueRanges] = useState<MatchOption[]>([]);
  const [industries, setIndustries] = useState<MatchOption[]>([]);
  const [dealTypes, setDealTypes] = useState<MatchOption[]>([]);
  const [positionOptions, setPositionOptions] = useState<MatchOption[]>([]);

  // Form state
  const [revenueOption, setRevenueOption] = useState('');
  const [exactRevenue, setExactRevenue] = useState<number | ''>('');
  const [creditOption, setCreditOption] = useState('unknown');
  const [position, setPosition] = useState('');
  const [industry, setIndustry] = useState('other');
  const [state, setState] = useState('other');
  const [dealType, setDealType] = useState('standard_mca');

  const [results, setResults] = useState<MatchResponse | null>(null);
  const [funderMap, setFunderMap] = useState<Map<string, FunderDetail>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTier, setActiveTier] = useState<string>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Load match options + funder details once
  useEffect(() => {
    fetch('/api/settings/match-options')
      .then((r) => r.json())
      .then((j) => {
        const grouped = j.data ?? {};
        setCreditRanges(grouped.credit_range ?? []);
        setRevenueRanges(grouped.revenue_range ?? []);
        setIndustries(grouped.industry ?? []);
        setDealTypes(grouped.deal_type ?? []);
        setPositionOptions(grouped.position_option ?? []);
      })
      .catch(() => {});

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

  function getRevenueValue(): number {
    // Prefer exact entered amount; else mid of selected range
    if (exactRevenue !== '' && exactRevenue > 0) return exactRevenue;
    if (!revenueOption) return 0;
    const opt = revenueRanges.find((r) => r.value === revenueOption);
    if (!opt) return 0;
    const min = Number((opt.meta as any)?.minRevenue ?? 0);
    const max = Number((opt.meta as any)?.maxRevenue ?? min * 2);
    return max ? Math.floor((min + max) / 2) : min;
  }

  function getCreditScoreValue(): number | null {
    const opt = creditRanges.find((r) => r.value === creditOption);
    if (!opt) return null;
    const v = (opt.meta as any)?.minScore;
    return v === undefined || v === null ? null : Number(v);
  }

  async function runMatch() {
    setError(null);
    if (!revenueOption && !exactRevenue) {
      setError('Pick a revenue range or enter exact monthly revenue.');
      return;
    }
    if (!position) {
      setError('Pick number of positions.');
      return;
    }

    const monthlyRevenue = getRevenueValue();
    const creditScoreValue = getCreditScoreValue();

    setLoading(true);
    try {
      const res = await fetch('/api/deal-shop/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monthlyRevenue,
          creditScoreValue,
          positions: parseInt(position) || 0,
          industry,
          state,
          dealType,
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
    router.push('/submit?shop=1');
  }

  // Group results by tier
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
    return Array.from(map.entries()).map(([tier, v]) => ({ tier, ...v })).sort((a, b) => a.tier.localeCompare(b.tier));
  }, [results, funderMap]);

  const filteredGroups = activeTier === 'all' ? tierGroups : tierGroups.filter((g) => g.tier === activeTier);
  const totalMatched = results?.matched.length ?? 0;
  const totalExcluded = results?.excluded.length ?? 0;

  function toggleExpand(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

  function clearForm() {
    setRevenueOption('');
    setExactRevenue('');
    setCreditOption('unknown');
    setPosition('');
    setIndustry('other');
    setState('other');
    setDealType('standard_mca');
    setResults(null);
    setError(null);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Shop Deals"
        description="Match a deal profile to qualifying funders, then submit."
        actions={
          results && totalMatched > 0 ? (
            <Button onClick={toSubmit} className="gap-2">
              <Send className="h-4 w-4" />
              Submit deal →
            </Button>
          ) : undefined
        }
      />

      {/* Centered intake card */}
      <div className="max-w-3xl mx-auto w-full">
        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="text-center pb-3 border-b border-border">
              <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-primary/10 mb-2">
                <Search className="h-5 w-5 text-primary" />
              </div>
              <h2 className="text-base font-semibold">Deal Profile</h2>
              <p className="text-xs text-muted-foreground mt-0.5">All fields shape which funders qualify.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Revenue */}
              <Field label="Monthly Revenue (range)" required>
                <Select value={revenueOption} onChange={setRevenueOption} options={[
                  { value: '', label: '— Pick a range —' },
                  ...revenueRanges.map((r) => ({ value: r.value, label: r.label })),
                ]} />
              </Field>

              <Field label="Or exact amount" hint="If exact > 0, used instead of range">
                <MoneyInput value={exactRevenue} onValueChange={setExactRevenue} placeholder="50,000" />
              </Field>

              {/* Credit */}
              <Field label="Credit">
                <Select value={creditOption} onChange={setCreditOption} options={
                  creditRanges.map((c) => ({ value: c.value, label: c.label }))
                } />
              </Field>

              {/* Position */}
              <Field label="Number of Positions" required>
                <Select value={position} onChange={setPosition} options={[
                  { value: '', label: '— Pick —' },
                  ...positionOptions.map((p) => ({ value: p.value, label: p.label })),
                ]} />
              </Field>

              {/* Industry */}
              <Field label="Industry" hint='Pick "Other" to skip industry filtering'>
                <Select value={industry} onChange={setIndustry} options={[
                  ...industries.map((i) => ({ value: i.value, label: i.label })),
                ]} />
              </Field>

              {/* State */}
              <Field label="State" hint='Pick "Other" to skip state filtering'>
                <Select value={state} onChange={setState} options={[
                  { value: 'other', label: 'Other / N/A' },
                  ...US_STATES.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` })),
                ]} />
              </Field>

              {/* Deal type */}
              <Field label="Deal Type" className="sm:col-span-2">
                <div className="grid grid-cols-2 gap-2">
                  {dealTypes.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => setDealType(d.value)}
                      className={cn(
                        'px-4 py-2.5 rounded border-2 text-sm font-medium transition',
                        dealType === d.value
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
                      )}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            {error && (
              <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-border">
              <Button variant="ghost" onClick={clearForm} type="button">Clear</Button>
              <Button onClick={runMatch} loading={loading} className="gap-1.5 px-6">
                <Zap className="h-4 w-4" />
                Find Funders
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Results section */}
      {results && (
        totalMatched === 0 && totalExcluded === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-sm text-muted-foreground">
              No funders configured yet. Add some in the <a href="/funders" className="text-primary hover:underline">Funders</a> tab.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground/80 px-1">
              Results — {totalMatched} qualifying, {totalExcluded} excluded
            </div>

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
                                  <tr key={m.funderId} className="hover:bg-muted/30 cursor-pointer" onClick={() => toggleExpand(m.funderId)}>
                                    <td className="px-4 py-2.5">
                                      <div className="flex items-center gap-2">
                                        <div className="h-2 w-2 rounded-full bg-emerald-500" />
                                        <span className="font-medium">{m.funderName}</span>
                                      </div>
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <Badge variant="outline" className="text-[10px]">{f?.submissionMethod ?? 'email'}</Badge>
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
                                  {e.reasons.find((r) => !r.includes('OK')) ?? e.reasons[0]}
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
      className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
            {emails.map((c, i) => <div key={i} className="font-mono text-foreground">{c.email}</div>)}
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
      {((funder.restrictedStates?.length ?? 0) > 0 || (funder.restrictedIndustries?.length ?? 0) > 0 || funder.notes) && (
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
