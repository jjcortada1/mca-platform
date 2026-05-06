'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, Badge, Field } from '@/components/ui/primitives';
import { US_STATES, COMMON_INDUSTRIES, CREDIT_TIER_OPTIONS } from '@/lib/constants';
import { ChevronDown, ChevronUp, Send } from 'lucide-react';
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
  { value: '', label: 'Revenue ▾' },
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
  { value: '', label: 'Position ▾' },
  { value: '0', label: 'Position 0 (no stack)' },
  { value: '1', label: 'Position 1' },
  { value: '2', label: 'Position 2' },
  { value: '3', label: 'Position 3' },
  { value: '4', label: 'Position 4' },
  { value: '5+', label: '5+ positions' },
];

const NSF_OPTIONS = [
  { value: '', label: 'NSFs ▾' },
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
  const [openFunders, setOpenFunders] = useState<Set<string>>(new Set());
  const [activeTier, setActiveTier] = useState<string | null>(null);

  // Load full funder details once for showing emails/contacts on cards
  useEffect(() => {
    fetch('/api/funders')
      .then((r) => r.json())
      .then((j) => {
        const list = j.data ?? j.funders ?? [];
        const m = new Map<string, FunderDetail>();
        list.forEach((f: FunderDetail) => m.set(f.id, f));
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
      setError('Please select: ' + missing.join(', '));
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
      setOpenFunders(new Set()); // reset

      // Auto-select first tier
      const matched = (json.matched ?? []) as MatchResult[];
      const tiers = collectTiers(matched, funderMap);
      setActiveTier(tiers[0]?.tier ?? null);
    } finally {
      setLoading(false);
    }
  }

  function toFundFromShop() {
    const params = new URLSearchParams({
      shop: '1',
      revenue: form.revenue,
      credit: form.credit,
      nsfs: form.nsfs,
      position: form.position,
      state: form.state,
      industry: form.industry,
      reverse: form.reverseConsolidation ? '1' : '0',
    });
    router.push(`/submit?${params.toString()}`);
  }

  // Group matched funders by tier
  const groupedByTier = results
    ? collectTiers(results.matched, funderMap)
    : [];

  const activeGroup = groupedByTier.find((g) => g.tier === activeTier);
  const matchedFunderIds = new Set((results?.matched ?? []).map((m) => m.funderId));
  const excludedInActiveTier = activeGroup
    ? results?.excluded.filter((e) => {
      const f = funderMap.get(e.funderId);
      const tName = f?.tiers?.[0]?.name ?? 'Untiered';
      return tName === activeTier;
    }) ?? []
    : [];

  return (
    <div className="space-y-6 max-w-5xl">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">🛒 Deal Shopping</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Find qualifying funders for a deal. Once you have a list, head to <strong>Submit Deal</strong> to send it.
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <SelectField
              value={form.revenue}
              onChange={(v) => setForm({ ...form, revenue: v })}
              options={REVENUE_OPTIONS}
            />
            <SelectField
              value={form.credit}
              onChange={(v) => setForm({ ...form, credit: v })}
              options={[
                { value: 'unknown', label: 'Credit ▾' },
                ...CREDIT_TIER_OPTIONS.filter((o) => o.value !== 'unknown'),
              ]}
            />
            <SelectField
              value={form.nsfs}
              onChange={(v) => setForm({ ...form, nsfs: v })}
              options={NSF_OPTIONS}
            />
            <SelectField
              value={form.position}
              onChange={(v) => setForm({ ...form, position: v })}
              options={POSITION_OPTIONS}
            />
            <SelectField
              value={form.state}
              onChange={(v) => setForm({ ...form, state: v })}
              options={[
                { value: 'other', label: 'State ▾' },
                ...US_STATES.map((s) => ({ value: s.code, label: s.code + ' — ' + s.name })),
              ]}
            />
            <SelectField
              value={form.industry}
              onChange={(v) => setForm({ ...form, industry: v })}
              options={[
                { value: 'other', label: 'Industry ▾' },
                ...COMMON_INDUSTRIES.map((i) => ({ value: i, label: i })),
              ]}
            />
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <Button onClick={runMatch} disabled={loading} className="px-6">
              {loading ? 'Searching…' : 'Find Funders →'}
            </Button>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.reverseConsolidation}
                onChange={(e) => setForm({ ...form, reverseConsolidation: e.target.checked })}
              />
              Reverse Consolidation
            </label>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
        </CardContent>
      </Card>

      {results && (
        <>
          {groupedByTier.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No qualifying funders found for this deal profile.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {/* Tier tabs */}
              <div className="flex flex-wrap gap-1 border-b border-border">
                {groupedByTier.map((g) => (
                  <button
                    key={g.tier}
                    onClick={() => setActiveTier(g.tier)}
                    className={cn(
                      'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition',
                      activeTier === g.tier
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {g.tier}
                    <span className="ml-2 text-xs text-muted-foreground">({g.funders.length})</span>
                  </button>
                ))}
              </div>

              {/* Active tier funders */}
              {activeGroup && (
                <div className="space-y-3">
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {activeGroup.funders.map((m) => {
                      const f = funderMap.get(m.funderId);
                      const isOpen = openFunders.has(m.funderId);
                      return (
                        <Card key={m.funderId} className="hover:shadow-sm transition">
                          <button
                            onClick={() => {
                              const next = new Set(openFunders);
                              if (next.has(m.funderId)) next.delete(m.funderId);
                              else next.add(m.funderId);
                              setOpenFunders(next);
                            }}
                            className="w-full text-left p-4 flex items-center justify-between"
                          >
                            <div className="font-semibold text-sm">{m.funderName}</div>
                            {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                          </button>
                          {isOpen && f && (
                            <div className="px-4 pb-4 space-y-3 text-xs border-t border-border pt-3">
                              {(f.contacts ?? []).filter((c) => c.email).length > 0 && (
                                <div>
                                  <div className="font-medium text-muted-foreground uppercase tracking-wide text-[10px] mb-1">Submission Emails</div>
                                  <div className="space-y-1">
                                    {(f.contacts ?? []).filter((c) => c.email).map((c, i) => (
                                      <div key={i} className="font-mono text-foreground">✉ {c.email}</div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {(f.contacts ?? []).filter((c) => c.phone).length > 0 && (
                                <div>
                                  <div className="font-medium text-muted-foreground uppercase tracking-wide text-[10px] mb-1">Contacts</div>
                                  <div className="space-y-1">
                                    {(f.contacts ?? []).filter((c) => c.phone).map((c, i) => (
                                      <div key={i}>📞 <span className="font-medium">{c.name}</span> <span className="text-muted-foreground">{c.phone}</span></div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {((f.restrictedStates ?? []).length > 0 || (f.restrictedIndustries ?? []).length > 0 || f.notes) && (
                                <div className="bg-amber-50 border border-amber-200 rounded p-2">
                                  {(f.restrictedStates ?? []).length > 0 && (
                                    <div>🚫 Not in: {f.restrictedStates!.join(', ')}</div>
                                  )}
                                  {(f.restrictedIndustries ?? []).length > 0 && (
                                    <div>⛔ No: {f.restrictedIndustries!.join(', ')}</div>
                                  )}
                                  {f.notes && <div className="mt-1">ℹ️ {f.notes}</div>}
                                </div>
                              )}
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>

                  {/* Excluded in this tier */}
                  {excludedInActiveTier.length > 0 && (
                    <Card>
                      <CardContent className="p-4">
                        <div className="text-xs font-bold uppercase text-muted-foreground tracking-wide mb-2">
                          Not Qualifying in This Tier
                        </div>
                        <div className="space-y-1">
                          {excludedInActiveTier.map((e) => (
                            <div key={e.funderId} className="flex justify-between text-xs py-1 border-b border-border last:border-0">
                              <span className="font-medium text-muted-foreground">{e.funderName}</span>
                              <span className="text-muted-foreground">{e.reasons[0] ?? 'Excluded'}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {/* Action: bring to Submit */}
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="font-medium text-sm">Ready to send?</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Carry these criteria over to the Submit Deal page to pick funders and send emails.
                    </div>
                  </div>
                  <Button onClick={toFundFromShop} className="gap-1">
                    <Send className="h-4 w-4" />
                    Submit Deal →
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SelectField({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function collectTiers(matched: MatchResult[], funderMap: Map<string, FunderDetail>): { tier: string; funders: MatchResult[] }[] {
  const groups = new Map<string, MatchResult[]>();
  for (const m of matched) {
    const f = funderMap.get(m.funderId);
    const tName = (f?.tiers && f.tiers.length > 0) ? f.tiers[0].name : 'Untiered';
    const arr = groups.get(tName) ?? [];
    arr.push(m);
    groups.set(tName, arr);
  }
  return Array.from(groups.entries())
    .map(([tier, funders]) => ({ tier, funders }))
    .sort((a, b) => a.tier.localeCompare(b.tier));
}
