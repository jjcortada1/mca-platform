'use client';

import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, Button, Input, Textarea, Badge, PageHeader, EmptyState } from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { formatDate, formatCurrency } from '@/lib/utils';
import { Plus, Trash2, Briefcase, Search, X, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { computePaydown, buildPaymentSchedule, DEAL_STATUS_META, DEAL_STATUS_OPTIONS } from '@/lib/deals/paydown';

interface Deal {
  id: string;
  name: string;
  merchantFirstName: string | null;
  merchantLastName: string | null;
  merchantEmail: string | null;
  merchantPhone: string | null;
  offerNotes: string | null;
  offerAmount: string | null;
  assignedRepId: string | null;
  status: string;
  // paydown
  fundedAmount: string | null;
  netAmount: string | null;
  factorRate: string | null;
  termMode: string | null;
  termCount: string | null;
  fundingDate: string | null;
  amountCollected: string | null;
  renewalNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

// Tailwind classes per status tone (color-coded badges).
const TONE_CLASS: Record<string, string> = {
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  blue: 'bg-blue-100 text-blue-800 border-blue-200',
  gray: 'bg-gray-100 text-gray-700 border-gray-200',
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  violet: 'bg-violet-100 text-violet-800 border-violet-200',
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  rose: 'bg-rose-100 text-rose-800 border-rose-200',
  red: 'bg-red-100 text-red-800 border-red-200',
  orange: 'bg-orange-100 text-orange-800 border-orange-200',
  teal: 'bg-teal-100 text-teal-800 border-teal-200',
  cyan: 'bg-cyan-100 text-cyan-800 border-cyan-200',
};

function statusMeta(status: string): { label: string; tone: string } {
  return DEAL_STATUS_META[status] ?? { label: status, tone: 'gray' };
}

function StatusBadge({ status }: { status: string }) {
  const m = statusMeta(status);
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border', TONE_CLASS[m.tone] ?? TONE_CLASS.gray)}>
      {m.label}
    </span>
  );
}

const STATUS_OPTIONS = DEAL_STATUS_OPTIONS;

const blankDeal = (): Deal => ({
  id: '', name: '', merchantFirstName: '', merchantLastName: '',
  merchantEmail: '', merchantPhone: '', offerNotes: '', offerAmount: '',
  assignedRepId: null, status: 'submitted',
  fundedAmount: '', netAmount: '', factorRate: '', termMode: 'weekly', termCount: '',
  fundingDate: '', amountCollected: '', renewalNotes: '',
  createdAt: '', updatedAt: '',
});

export default function ActiveDealsPage() {
  const toast = useToast();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [reps, setReps] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  // Inline edit state — what's being edited and pending changes
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Deal>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  // New deal form
  const [creating, setCreating] = useState<Deal | null>(null);

  async function load() {
    setLoading(true);
    const [dRes, uRes] = await Promise.all([
      fetch('/api/deals').then((r) => r.json()),
      fetch('/api/users').then((r) => r.json()).catch(() => ({ data: [] })),
    ]);
    setDeals(dRes.data ?? dRes ?? []);
    setReps((uRes.data ?? []).filter((u: { role: string }) => u.role !== 'master_admin'));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function startEdit(d: Deal) {
    setExpandedId(d.id);
    setDraft({});
  }
  function cancelEdit() {
    setExpandedId(null);
    setDraft({});
  }
  function patchDraft(field: keyof Deal, value: any) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  async function persist(deal: Deal, patch: Partial<Deal>) {
    if (Object.keys(patch).length === 0) return true;
    setSavingId(deal.id);
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    setSavingId(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || 'Save failed.');
      return false;
    }
    return true;
  }

  // Inline status change — saves immediately
  async function quickStatusChange(deal: Deal, status: Deal['status']) {
    const ok = await persist(deal, { status });
    if (ok) {
      toast.success(`Marked as ${status}.`);
      setDeals((arr) => arr.map((x) => (x.id === deal.id ? { ...x, status } : x)));
    }
  }

  // Inline rep change — saves immediately
  async function quickRepChange(deal: Deal, repId: string | null) {
    const ok = await persist(deal, { assignedRepId: repId });
    if (ok) {
      toast.success('Rep updated.');
      setDeals((arr) => arr.map((x) => (x.id === deal.id ? { ...x, assignedRepId: repId } : x)));
    }
  }

  // Save draft (from expanded row)
  async function saveDraft(deal: Deal) {
    const patch = { ...draft };
    delete (patch as any).id;
    const ok = await persist(deal, patch);
    if (ok) {
      toast.success('Deal updated.');
      setDeals((arr) => arr.map((x) => (x.id === deal.id ? { ...x, ...patch } as Deal : x)));
      cancelEdit();
    }
  }

  async function del(deal: Deal) {
    if (!confirm(`Delete "${deal.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/deals/${deal.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Deal deleted.');
      setDeals((arr) => arr.filter((x) => x.id !== deal.id));
    } else {
      toast.error('Delete failed.');
    }
  }

  async function createDeal() {
    if (!creating) return;
    const res = await fetch('/api/deals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: creating.name,
        merchantFirstName: creating.merchantFirstName,
        merchantLastName: creating.merchantLastName,
        merchantEmail: creating.merchantEmail,
        merchantPhone: creating.merchantPhone,
        offerNotes: creating.offerNotes,
        assignedRepId: creating.assignedRepId,
        status: creating.status,
      }),
    });
    if (!res.ok) {
      const j = await res.json();
      toast.error(j.error || 'Create failed.');
      return;
    }
    toast.success('Deal created.');
    setCreating(null);
    load();
  }

  const filtered = useMemo(() => {
    let arr = deals;
    if (statusFilter !== 'all') arr = arr.filter((d) => d.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter((d) =>
        d.name.toLowerCase().includes(q) ||
        `${d.merchantFirstName ?? ''} ${d.merchantLastName ?? ''}`.toLowerCase().includes(q) ||
        (d.merchantEmail ?? '').toLowerCase().includes(q)
      );
    }
    return arr;
  }, [deals, statusFilter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: deals.length };
    for (const s of STATUS_OPTIONS) c[s] = deals.filter((d) => d.status === s).length;
    return c;
  }, [deals]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Active Deals"
        description="Edit deal details, statuses, and assignments inline. Click a row to expand."
        actions={
          <Button onClick={() => setCreating(blankDeal())} className="gap-1.5">
            <Plus className="h-4 w-4" /> New deal
          </Button>
        }
      />

      {/* Status filter chips + search */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip label="All" count={counts.all} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
        {STATUS_OPTIONS.map((s) => (
          <FilterChip
            key={s}
            label={statusMeta(s).label}
            count={counts[s] ?? 0}
            active={statusFilter === s}
            onClick={() => setStatusFilter(s)}
            tone={statusMeta(s).tone}
          />
        ))}
        <div className="ml-auto relative w-full sm:w-auto sm:min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search deals or merchants…"
            className="pl-9"
          />
        </div>
      </div>

      {/* Create form (overlay-ish above table) */}
      {creating && (
        <Card className="border-primary/40 bg-primary/[0.02]">
          <CardContent className="p-4 space-y-3">
            <div className="text-sm font-semibold flex items-center justify-between">
              <span>New deal</span>
              <button onClick={() => setCreating(null)} className="text-muted-foreground hover:text-foreground p-1">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                placeholder="Deal name"
                value={creating.name}
                onChange={(e) => setCreating({ ...creating, name: e.target.value })}
                autoFocus
              />
              <Input
                placeholder="Merchant first + last"
                value={`${creating.merchantFirstName ?? ''} ${creating.merchantLastName ?? ''}`.trim()}
                onChange={(e) => {
                  const [first = '', ...rest] = e.target.value.split(' ');
                  setCreating({ ...creating, merchantFirstName: first, merchantLastName: rest.join(' ') });
                }}
              />
              <Input
                placeholder="Merchant email"
                type="email"
                value={creating.merchantEmail ?? ''}
                onChange={(e) => setCreating({ ...creating, merchantEmail: e.target.value })}
              />
              <Input
                placeholder="Merchant phone"
                value={creating.merchantPhone ?? ''}
                onChange={(e) => setCreating({ ...creating, merchantPhone: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" size="sm" onClick={() => setCreating(null)}>Cancel</Button>
              <Button size="sm" onClick={createDeal} disabled={!creating.name.trim()}>Create</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {loading ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Briefcase}
              title="No deals yet"
              description={search || statusFilter !== 'all' ? 'Try changing your filters.' : 'Create your first deal to get started.'}
              action={!search && statusFilter === 'all' ? (
                <Button onClick={() => setCreating(blankDeal())}>Create a deal</Button>
              ) : undefined}
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-2 w-8"></th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Deal</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">First</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Last</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Phone</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Email</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Offer / Notes</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Status</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Rep</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Updated</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((d) => {
                const isExpanded = expandedId === d.id;
                return (
                  <>
                    <tr
                      key={d.id}
                      className={cn(
                        'transition-colors',
                        isExpanded ? 'bg-muted/40' : 'hover:bg-muted/30 cursor-pointer'
                      )}
                      onClick={() => isExpanded ? cancelEdit() : startEdit(d)}
                    >
                      <td className="px-2 py-2.5 text-muted-foreground">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </td>
                      <td className="px-3 py-2.5 font-medium whitespace-nowrap">{d.name}</td>
                      <td className="px-3 py-2.5 text-foreground/80">{d.merchantFirstName || '—'}</td>
                      <td className="px-3 py-2.5 text-foreground/80">{d.merchantLastName || '—'}</td>
                      <td className="px-3 py-2.5 text-muted-foreground tabular-nums whitespace-nowrap">{d.merchantPhone || '—'}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground truncate max-w-[200px]" title={d.merchantEmail ?? ''}>
                        {d.merchantEmail || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground text-xs max-w-[280px]">
                        <div className="line-clamp-2 whitespace-pre-wrap">{d.offerNotes || <span className="italic text-muted-foreground/60">none</span>}</div>
                      </td>
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={d.status} />
                          <select
                            value={STATUS_OPTIONS.includes(d.status as never) ? d.status : ''}
                            onChange={(e) => quickStatusChange(d, e.target.value)}
                            disabled={savingId === d.id}
                            className="h-7 rounded-md border border-input bg-card px-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                            title="Change status"
                          >
                            {!STATUS_OPTIONS.includes(d.status as never) && <option value="">{statusMeta(d.status).label}</option>}
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>{statusMeta(s).label}</option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={d.assignedRepId ?? ''}
                          onChange={(e) => quickRepChange(d, e.target.value || null)}
                          disabled={savingId === d.id}
                          className="h-8 rounded-md border border-input bg-card px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring max-w-[140px]"
                        >
                          <option value="">— unassigned —</option>
                          {reps.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {formatDate(d.updatedAt)}
                      </td>
                      <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => del(d)}
                          className="p-1.5 text-muted-foreground hover:text-destructive transition-colors rounded hover:bg-destructive/10"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-muted/20">
                        <td colSpan={11} className="px-4 py-4">
                          <div className="space-y-3 max-w-3xl">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <LabeledInline label="Deal name">
                                <Input
                                  defaultValue={d.name}
                                  onChange={(e) => patchDraft('name', e.target.value)}
                                />
                              </LabeledInline>
                              <LabeledInline label="Merchant first">
                                <Input
                                  defaultValue={d.merchantFirstName ?? ''}
                                  onChange={(e) => patchDraft('merchantFirstName', e.target.value)}
                                />
                              </LabeledInline>
                              <LabeledInline label="Merchant last">
                                <Input
                                  defaultValue={d.merchantLastName ?? ''}
                                  onChange={(e) => patchDraft('merchantLastName', e.target.value)}
                                />
                              </LabeledInline>
                              <LabeledInline label="Merchant email">
                                <Input
                                  type="email"
                                  defaultValue={d.merchantEmail ?? ''}
                                  onChange={(e) => patchDraft('merchantEmail', e.target.value)}
                                />
                              </LabeledInline>
                              <LabeledInline label="Merchant phone">
                                <Input
                                  defaultValue={d.merchantPhone ?? ''}
                                  onChange={(e) => patchDraft('merchantPhone', e.target.value)}
                                />
                              </LabeledInline>
                            </div>
                            <LabeledInline label="Offer amount ($)">
                              <Input
                                type="text"
                                inputMode="decimal"
                                defaultValue={d.offerAmount ?? ''}
                                placeholder="e.g. 50000"
                                onChange={(e) => patchDraft('offerAmount', e.target.value)}
                              />
                            </LabeledInline>

                            {/* Funding / paydown structure */}
                            <div className="pt-3 border-t border-border">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Funding & paydown</div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                <LabeledInline label="Funded amount ($)">
                                  <Input inputMode="decimal" defaultValue={d.fundedAmount ?? ''} placeholder="150000" onChange={(e) => patchDraft('fundedAmount', e.target.value)} />
                                </LabeledInline>
                                <LabeledInline label="Net to merchant ($)">
                                  <Input inputMode="decimal" defaultValue={d.netAmount ?? ''} placeholder="142500" onChange={(e) => patchDraft('netAmount', e.target.value)} />
                                </LabeledInline>
                                <LabeledInline label="Factor rate">
                                  <Input inputMode="decimal" defaultValue={d.factorRate ?? ''} placeholder="1.40" onChange={(e) => patchDraft('factorRate', e.target.value)} />
                                </LabeledInline>
                                <LabeledInline label="Term type">
                                  <select
                                    defaultValue={d.termMode ?? 'weekly'}
                                    onChange={(e) => patchDraft('termMode', e.target.value)}
                                    className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                                  >
                                    <option value="weekly">Weekly</option>
                                    <option value="daily">Daily</option>
                                  </select>
                                </LabeledInline>
                                <LabeledInline label="# of payments">
                                  <Input inputMode="decimal" defaultValue={d.termCount ?? ''} placeholder="26" onChange={(e) => patchDraft('termCount', e.target.value)} />
                                </LabeledInline>
                                <LabeledInline label="Funding date">
                                  <Input type="date" defaultValue={d.fundingDate ? String(d.fundingDate).slice(0, 10) : ''} onChange={(e) => patchDraft('fundingDate', e.target.value)} />
                                </LabeledInline>
                                <LabeledInline label="Amount collected ($)">
                                  <Input inputMode="decimal" defaultValue={d.amountCollected ?? ''} placeholder="auto from date if blank" onChange={(e) => patchDraft('amountCollected', e.target.value)} />
                                </LabeledInline>
                              </div>

                              {/* Live tracker */}
                              <PaydownTracker deal={{ ...d, ...draft }} />
                            </div>

                            <LabeledInline label="Offer notes">
                              <Textarea
                                rows={3}
                                defaultValue={d.offerNotes ?? ''}
                                onChange={(e) => patchDraft('offerNotes', e.target.value)}
                              />
                            </LabeledInline>
                            <div className="flex justify-end gap-2 pt-2 border-t border-border">
                              <Button variant="outline" size="sm" onClick={cancelEdit}>Cancel</Button>
                              <Button
                                size="sm"
                                onClick={() => saveDraft(d)}
                                loading={savingId === d.id}
                                disabled={Object.keys(draft).length === 0}
                              >
                                Save changes
                              </Button>
                            </div>
                          </div>
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
    </div>
  );
}

function FilterChip({
  label, count, active, onClick, tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
      )}
    >
      <span>{label}</span>
      <span className={cn(
        'tabular-nums px-1.5 py-0.5 rounded text-[10px]',
        active ? 'bg-primary-foreground/20' : 'bg-muted'
      )}>{count}</span>
    </button>
  );
}

function LabeledInline({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

/* ---------- Live paydown tracker ---------- */
function PaydownTracker({ deal }: { deal: Deal }) {
  const p = computePaydown({
    fundedAmount: deal.fundedAmount,
    factorRate: deal.factorRate,
    termMode: deal.termMode,
    termCount: deal.termCount,
    fundingDate: deal.fundingDate,
    amountCollected: deal.amountCollected,
  });

  if (!p.hasStructure) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
        Enter funded amount, factor rate, term type + count, and funding date to see the live paydown tracker.
      </div>
    );
  }

  const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString() : '—');

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/20 p-4 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <Metric label="Total payback" value={formatCurrency(p.totalPayback)} />
        <Metric label={p.termMode === 'daily' ? 'Daily payment' : 'Weekly payment'} value={formatCurrency(p.paymentAmount)} />
        <Metric label="Collected" value={formatCurrency(p.amountCollected)} />
        <Metric label="Remaining" value={formatCurrency(p.remainingBalance)} />
        <Metric label="Funding date" value={fmtDate(p.fundingDate)} />
        <Metric label="Est. payoff" value={fmtDate(p.payoffDate)} />
        <Metric label="Renewal (50%)" value={fmtDate(p.renewalDate)} />
        <Metric label="Payments" value={`${p.paymentsMade} / ${p.paymentsTotal}`} />
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">Paid in</span>
          <span className="font-medium tabular-nums">{p.pctPaidIn}%</span>
        </div>
        <div className="h-2.5 bg-muted rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', p.renewalEligible ? 'bg-teal-500' : 'bg-primary')}
            style={{ width: `${Math.min(100, p.pctPaidIn)}%` }}
          />
        </div>
        {p.renewalEligible && (
          <div className="mt-2 text-xs text-teal-700 font-medium">✓ Eligible for renewal (50%+ paid in)</div>
        )}
      </div>

      {/* Deal timeline */}
      {p.fundingDate && p.payoffDate && (
        <DealTimeline funding={p.fundingDate} renewal={p.renewalDate} payoff={p.payoffDate} pct={p.pctPaidIn} />
      )}

      {/* Payment schedule (calendar of estimated payments) */}
      <PaymentSchedule deal={deal} />
    </div>
  );
}

function PaymentSchedule({ deal }: { deal: Deal }) {
  const [open, setOpen] = useState(false);
  const schedule = useMemo(() => buildPaymentSchedule({
    fundedAmount: deal.fundedAmount, factorRate: deal.factorRate, termMode: deal.termMode,
    termCount: deal.termCount, fundingDate: deal.fundingDate, amountCollected: deal.amountCollected,
  }), [deal.fundedAmount, deal.factorRate, deal.termMode, deal.termCount, deal.fundingDate, deal.amountCollected]);

  if (!schedule.length) return null;
  const paidCount = schedule.filter((s) => s.isPast).length;

  return (
    <div className="pt-1">
      <button onClick={() => setOpen(!open)} className="text-xs text-primary hover:underline">
        {open ? '▲ Hide' : '▼ Show'} payment schedule ({paidCount}/{schedule.length} estimated paid)
      </button>
      {open && (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 sticky top-0">
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-1.5">#</th>
                <th className="px-3 py-1.5">Date</th>
                <th className="px-3 py-1.5 text-right">Payment</th>
                <th className="px-3 py-1.5 text-right">Cumulative</th>
                <th className="px-3 py-1.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {schedule.map((s) => (
                <tr key={s.index} className={s.isPast ? 'bg-emerald-50/40' : ''}>
                  <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{s.index}</td>
                  <td className="px-3 py-1.5 tabular-nums">{s.date.toLocaleDateString()}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(s.amount)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{formatCurrency(s.cumulative)}</td>
                  <td className="px-3 py-1.5">
                    {s.isPast ? <span className="text-emerald-700">✓ est. paid</span> : <span className="text-muted-foreground">upcoming</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Compact funding → renewal → payoff timeline with a "today" marker. */
function DealTimeline({ funding, renewal, payoff, pct }: { funding: Date; renewal: Date | null; payoff: Date; pct: number }) {
  const start = funding.getTime();
  const end = payoff.getTime();
  const span = Math.max(1, end - start);
  const now = Date.now();
  const nowPct = Math.max(0, Math.min(100, ((now - start) / span) * 100));
  const renewalPct = renewal ? Math.max(0, Math.min(100, ((renewal.getTime() - start) / span) * 100)) : null;
  const d = (x: Date) => x.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div className="pt-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Timeline</div>
      <div className="relative h-8">
        {/* track */}
        <div className="absolute top-3 left-0 right-0 h-1 bg-muted rounded-full" />
        {/* elapsed (paydown) */}
        <div className="absolute top-3 left-0 h-1 bg-primary rounded-full" style={{ width: `${pct}%` }} />
        {/* renewal marker */}
        {renewalPct != null && (
          <div className="absolute -top-0.5 flex flex-col items-center" style={{ left: `${renewalPct}%`, transform: 'translateX(-50%)' }}>
            <div className="h-3 w-3 rounded-full bg-teal-500 border-2 border-card" />
            <span className="text-[9px] text-teal-700 mt-0.5 whitespace-nowrap">Renewal</span>
          </div>
        )}
        {/* today marker */}
        <div className="absolute -top-1 flex flex-col items-center" style={{ left: `${nowPct}%`, transform: 'translateX(-50%)' }}>
          <div className="h-4 w-0.5 bg-foreground" />
          <span className="text-[9px] text-foreground mt-0.5 whitespace-nowrap">Today</span>
        </div>
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>Funded {d(funding)}</span>
        <span>Payoff {d(payoff)}</span>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="tabular-nums font-medium mt-0.5">{value}</div>
    </div>
  );
}
