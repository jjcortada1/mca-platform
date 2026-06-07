'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, Badge, PageHeader, Field } from '@/components/ui/primitives';
import { US_STATES } from '@/lib/constants';
import { Send, ChevronDown, ChevronRight, Mail, Phone, MapPin, Ban, FileText, Zap, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MatchResult } from '@/lib/matching/engine';

/**
 * Human labels for short-form exclusion codes. Used by the deal-shop UI to
 * render compact red badges next to each excluded funder so the reason is
 * scannable at a glance — instead of long sentences.
 *
 * The full detailed reason text from the engine is kept on the tooltip
 * (title attribute) so a user can hover for specifics like the exact
 * revenue or credit threshold that failed.
 */
const EXCLUSION_LABELS = {
  restricted_state: 'Restricted State',
  restricted_industry: 'Restricted Industry',
  credit_too_low: 'Credit Too Low',
  revenue_too_low: 'Revenue Too Low',
  positions_too_high: 'Position Count Too High',
  reverse_unsupported: 'No Reverse Consol.',
  inactive: 'Inactive',
} as const;

interface MatchResponse { matched: MatchResult[]; excluded: MatchResult[]; }

interface FunderDetail {
  id: string;
  name: string;
  tiers?: { id: string; name: string }[];
  emails?: string[] | null;
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
  const searchParams = useSearchParams();
  // If the user came from /active-deals → "Shop this deal", we get a deal id
  // in the URL. Used to pull existing submissions for the deal so we can
  // surface them as an "Already Submitted" bucket and mark recommended
  // funders that have already seen this file.
  const dealId = searchParams?.get('dealId') ?? null;

  // Editable options loaded from server
  const [creditRanges, setCreditRanges] = useState<MatchOption[]>([]);
  const [revenueRanges, setRevenueRanges] = useState<MatchOption[]>([]);
  const [industries, setIndustries] = useState<MatchOption[]>([]);
  const [dealTypes, setDealTypes] = useState<MatchOption[]>([]);
  const [positionOptions, setPositionOptions] = useState<MatchOption[]>([]);
  const [stateOptions, setStateOptions] = useState<MatchOption[]>([]);

  // Form state
  const [revenueOption, setRevenueOption] = useState('');
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
  const [selectedFunders, setSelectedFunders] = useState<Set<string>>(new Set());

  // Already-submitted funders for the current deal (loaded only if dealId present).
  // Map: funderId → { status, submittedAt } — keyed by funder so we can do O(1)
  // lookups while rendering the recommended/excluded buckets.
  const [alreadySubmitted, setAlreadySubmitted] = useState<Map<string, { funderName: string; status: string; submittedAt: string }>>(new Map());

  // Pull this deal's existing submissions when dealId param is present.
  // No-op (empty map) when the user navigates to /deal-shop directly without
  // a deal context — the "Already Submitted" bucket simply doesn't render.
  useEffect(() => {
    if (!dealId) {
      setAlreadySubmitted(new Map());
      return;
    }
    fetch(`/api/deals/${dealId}/submissions`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        const m = new Map<string, { funderName: string; status: string; submittedAt: string }>();
        for (const s of (j.data ?? [])) {
          m.set(s.funderId, { funderName: s.funderName, status: s.status, submittedAt: s.submittedAt });
        }
        setAlreadySubmitted(m);
      })
      .catch(() => setAlreadySubmitted(new Map()));
  }, [dealId]);

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
        setStateOptions(grouped.state ?? []);
      })
      .catch(() => {});

    fetch('/api/funders', { cache: 'no-store' })
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
    if (!revenueOption) {
      setError('Pick a revenue range.');
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
      setSelectedFunders(new Set());
    } finally {
      setLoading(false);
    }
  }

  function toSubmit() {
    // Carry the selected funders to the submit page so they're pre-selected.
    // If none are explicitly ticked, default to ALL matched funders.
    const ids = selectedFunders.size > 0
      ? Array.from(selectedFunders)
      : (results?.matched.map((m) => m.funderId) ?? []);
    try {
      sessionStorage.setItem('shopSelectedFunderIds', JSON.stringify(ids));
    } catch {
      // ignore
    }
    router.push('/submit?shop=1');
  }

  function toggleFunderSel(id: string) {
    setSelectedFunders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllMatched() {
    const all = results?.matched.map((m) => m.funderId) ?? [];
    setSelectedFunders(new Set(all));
  }

  function clearSelection() {
    setSelectedFunders(new Set());
  }

  // Group results by tier. Each result is already a (funder, tier) pair —
  // matched independently per tier — so a funder can show up under both
  // "A-Paper" (with one verdict) and "Subprime" (with a different verdict).
  const tierGroups = useMemo(() => {
    if (!results) return [];
    const map = new Map<string, { matched: MatchResult[]; excluded: MatchResult[] }>();
    function tierFor(r: MatchResult): string {
      return r.tierName ?? 'Untiered';
    }
    for (const m of results.matched) {
      const t = tierFor(m);
      if (!map.has(t)) map.set(t, { matched: [], excluded: [] });
      map.get(t)!.matched.push(m);
    }
    for (const e of results.excluded) {
      const t = tierFor(e);
      if (!map.has(t)) map.set(t, { matched: [], excluded: [] });
      map.get(t)!.excluded.push(e);
    }
    return Array.from(map.entries()).map(([tier, v]) => ({ tier, ...v })).sort((a, b) => a.tier.localeCompare(b.tier));
  }, [results]);

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
              {selectedFunders.size > 0
                ? `Shop ${selectedFunders.size} selected →`
                : 'Submit deal →'}
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
              <Field label="Monthly Revenue" required>
                <Select value={revenueOption} onChange={setRevenueOption} options={[
                  { value: '', label: '— Pick a range —' },
                  ...revenueRanges.map((r) => ({ value: r.value, label: r.label })),
                ]} />
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
                  ...(stateOptions.length > 0
                    ? stateOptions.map((s) => ({ value: s.value, label: s.label }))
                    : US_STATES.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` }))
                  ),
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
            <div className="flex items-center justify-between px-1 gap-3 flex-wrap">
              <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground/80">
                Results — {totalMatched} qualifying, {totalExcluded} excluded
              </div>
              {totalMatched > 0 && (
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">
                    {selectedFunders.size > 0 ? `${selectedFunders.size} selected` : 'None selected'}
                  </span>
                  <button onClick={selectAllMatched} className="text-primary hover:underline font-medium">
                    Select all
                  </button>
                  {selectedFunders.size > 0 && (
                    <button onClick={clearSelection} className="text-muted-foreground hover:text-foreground">
                      Clear
                    </button>
                  )}
                </div>
              )}
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
                {/* Already-submitted bucket — only when the user navigated
                    here with a deal context (?dealId=). Shows EVERY funder
                    this deal has already been sent to so the user doesn't
                    accidentally re-shop the same funder. Server-side dedupe
                    still applies as a backstop. */}
                {dealId && alreadySubmitted.size > 0 && (
                  <Card className="border-blue-200 bg-blue-50/30">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Send className="h-3.5 w-3.5 text-blue-700" />
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-900">
                          Already submitted ({alreadySubmitted.size})
                        </h3>
                      </div>
                      <div className="space-y-1">
                        {Array.from(alreadySubmitted.values())
                          .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
                          .map((s) => {
                            // Match the per-funder status look to the rest of the app.
                            const statusLabel =
                              s.status === 'approved' ? 'Approved' :
                              s.status === 'declined' ? 'Declined' :
                              'Pending';
                            const statusTone =
                              s.status === 'approved' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
                              s.status === 'declined' ? 'bg-rose-100 text-rose-800 border-rose-200' :
                              'bg-amber-100 text-amber-800 border-amber-200';
                            return (
                              <div key={s.funderName + s.submittedAt} className="flex items-center justify-between gap-2 text-xs py-1">
                                <span className="font-medium text-foreground truncate flex-1">{s.funderName}</span>
                                <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium border', statusTone)}>
                                  {statusLabel}
                                </span>
                                <span className="text-muted-foreground tabular-nums text-[10px] w-20 text-right shrink-0">
                                  {new Date(s.submittedAt).toLocaleDateString()}
                                </span>
                              </div>
                            );
                          })}
                      </div>
                    </CardContent>
                  </Card>
                )}

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
                              <th className="w-10 px-3 py-2"></th>
                              <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-2">Funder</th>
                              <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Submission</th>
                              <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Primary email</th>
                              <th className="w-8"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {g.matched.map((m) => {
                              const f = funderMap.get(m.funderId);
                              const shoppingEmails: string[] = (f?.emails ?? []).filter(Boolean);
                              const primary = f?.contacts?.find((c) => c.email);
                              const displayEmail = shoppingEmails[0] ?? primary?.email ?? null;
                              const extraCount = shoppingEmails.length > 1 ? shoppingEmails.length - 1 : 0;
                              const isExpanded = expanded.has(m.funderId);
                              const isSelected = selectedFunders.has(m.funderId);
                              // Cross-reference against already-submitted list for THIS deal.
                              // If found, render a small "Already submitted" pill and gray
                              // the row so the user is much less likely to re-select it.
                              const sub = alreadySubmitted.get(m.funderId);
                              return (
                                <>
                                  <tr key={m.funderId} className={cn('hover:bg-muted/30', isSelected && 'bg-primary/5', sub && 'opacity-60')}>
                                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => toggleFunderSel(m.funderId)}
                                        className="h-4 w-4 rounded border-border cursor-pointer accent-[var(--primary,#2563eb)]"
                                        title={sub ? 'Already submitted to this funder — selecting will be blocked server-side' : 'Select to shop this funder'}
                                      />
                                    </td>
                                    <td className="px-2 py-2.5 cursor-pointer" onClick={() => toggleExpand(m.funderId)}>
                                      <div className="flex items-center gap-2">
                                        <div className="h-2 w-2 rounded-full bg-emerald-500" />
                                        <span className="font-medium">{m.funderName}</span>
                                        {sub && (
                                          <span
                                            className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200"
                                            title={`Submitted ${new Date(sub.submittedAt).toLocaleDateString()} — status: ${sub.status}`}
                                          >
                                            Already sent
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2.5 cursor-pointer" onClick={() => toggleExpand(m.funderId)}>
                                      <Badge variant="outline" className="text-[10px]">{f?.submissionMethod ?? 'email'}</Badge>
                                    </td>
                                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground truncate max-w-[220px] cursor-pointer" onClick={() => toggleExpand(m.funderId)}>
                                      {displayEmail ?? '—'}
                                      {extraCount > 0 && (
                                        <span className="ml-1.5 text-[10px] not-italic font-sans px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                          +{extraCount}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-2 py-2.5 text-muted-foreground cursor-pointer" onClick={() => toggleExpand(m.funderId)}>
                                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </td>
                                  </tr>
                                  {isExpanded && f && (
                                    <tr className="bg-muted/20">
                                      <td colSpan={5} className="px-4 py-3">
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
                              <div key={e.funderId} className="px-4 py-2 flex items-center justify-between gap-2 text-xs">
                                <span className="font-medium text-muted-foreground truncate">{e.funderName}</span>
                                {/* Compact short-form reason badges. The full
                                    sentence-form text from the engine is kept
                                    in the title attribute so a user can hover
                                    to see e.g. "Min revenue $50,000, deal has
                                    $42,000" instead of just "Revenue Too Low". */}
                                <div className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[70%]">
                                  {(e.reasonCodes && e.reasonCodes.length > 0
                                    ? e.reasonCodes
                                    : ['restricted_state'] // never empty for an excluded row
                                  ).map((code) => {
                                    const label = EXCLUSION_LABELS[code as keyof typeof EXCLUSION_LABELS] ?? 'Restricted';
                                    // Pull the matching detailed reason for the tooltip
                                    const detail = e.reasons.find((r) => !r.includes('OK')) ?? '';
                                    return (
                                      <span
                                        key={code}
                                        title={detail}
                                        className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200"
                                      >
                                        {label}
                                      </span>
                                    );
                                  })}
                                </div>
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
  const submissionEmails = (funder.emails ?? []).filter((e) => e && e.includes('@'));
  const contacts = funder.contacts ?? [];
  const phoneContacts = contacts.filter((c) => c.phone || c.name);
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
      {submissionEmails.length > 0 && (
        <div>
          <div className="font-semibold uppercase tracking-wider text-[9px] text-muted-foreground mb-1.5 flex items-center gap-1">
            <Mail className="h-3 w-3" /> Submission emails ({submissionEmails.length})
          </div>
          <div className="space-y-0.5">
            {submissionEmails.map((e, i) => <div key={i} className="font-mono text-foreground">{e}</div>)}
          </div>
        </div>
      )}
      {phoneContacts.length > 0 && (
        <div>
          <div className="font-semibold uppercase tracking-wider text-[9px] text-muted-foreground mb-1.5 flex items-center gap-1">
            <Phone className="h-3 w-3" /> Contact
          </div>
          <div className="space-y-0.5">
            {phoneContacts.map((c, i) => (
              <div key={i}>
                <span className="font-medium">{c.name}</span>{' '}
                {c.phone && <span className="text-muted-foreground">{c.phone}</span>}
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
