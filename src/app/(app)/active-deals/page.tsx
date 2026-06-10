'use client';

import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, Button, Input, Textarea, Badge, PageHeader, EmptyState, Field, CurrencyInput, PercentInput } from '@/components/ui/primitives';
import { RepPicker } from '@/components/ui/rep-picker';
import { exportCSV } from '@/lib/csv-export';
import { useToast } from '@/components/toast';
import { formatDate, formatCurrency } from '@/lib/utils';
import { Plus, Trash2, Briefcase, Search, X, ChevronDown, ChevronRight, Download } from 'lucide-react';
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
  feePct: string | null;
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
  fundedAmount: '', netAmount: '', feePct: '', factorRate: '', termMode: 'weekly', termCount: '',
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
  // Rep filter (admin-side narrowing). '' = all, 'mine' = current user,
  // 'unassigned' = no rep, else specific repId.
  const [repFilter, setRepFilter] = useState<string>('');
  // Sort key — 'recent' (default), 'oldest', or 'rep' (group by rep name).
  const [sortKey, setSortKey] = useState<'recent' | 'oldest' | 'rep'>('recent');
  // Current user identity for the "mine" filter shortcut.
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);
  const isAdmin = me?.role === 'master_admin' || me?.role === 'company_admin';

  // Inline edit state — what's being edited and pending changes
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Deal>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  // New deal form
  const [creating, setCreating] = useState<Deal | null>(null);

  async function load() {
    setLoading(true);
    const [dRes, uRes] = await Promise.all([
      fetch('/api/deals', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/users').then((r) => r.json()).catch(() => ({ data: [] })),
    ]);
    setDeals(dRes.data ?? dRes ?? []);
    // Reps only — exclude master admins and lead source accounts.
    setReps((uRes.data ?? []).filter((u: { role: string }) => u.role === 'rep' || u.role === 'company_admin'));
    setLoading(false);
  }

  useEffect(() => {
    load();
    // Fetch current user — used to drive the "My deals only" shortcut and
    // to hide the rep filter from non-admin users (server-side scoping
    // already restricts what they see, but we don't want the dropdown
    // visible to suggest there's something to filter).
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (j?.user) setMe({ id: j.user.id, role: j.user.role }); })
      .catch(() => {});
  }, []);

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

  // When the user marks a deal "funded" inline, we don't just flip the
  // status — we collect merchant contact + funding details so the deal
  // shows up correctly on /portfolio. Stores the in-progress deal until
  // the user saves or cancels.
  const [markingFunded, setMarkingFunded] = useState<Deal | null>(null);

  // Inline status change — saves immediately
  async function quickStatusChange(deal: Deal, status: Deal['status']) {
    // Moving to "funded" ALWAYS opens the modal so the user can review /
    // fill in merchant contact details, funding amount, fee, factor, term,
    // funding date. Even if the deal already has funding details set,
    // contact info often isn't collected until funding time — and the user
    // wants to be able to add it at this point.
    if (status === 'funded') {
      setMarkingFunded(deal);
      return;
    }
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

  // Active Deals = pre-funded pipeline only. Funded deals live in /portfolio (labeled "Funded Deals" in the UI).
  const HIDDEN_FROM_ACTIVE = new Set(['funded', 'paid_off', 'closed']);

  const filtered = useMemo(() => {
    let arr = deals.filter((d) => !HIDDEN_FROM_ACTIVE.has(d.status));
    if (statusFilter !== 'all') arr = arr.filter((d) => d.status === statusFilter);
    // Rep filter — '' = all reps (admin default); 'mine' = current user;
    // any other value = specific rep id. The /api/deals endpoint already
    // enforces server-side scoping for non-admin users; this client filter
    // is purely a UX convenience for admins narrowing the list.
    if (repFilter === 'mine') {
      if (me) arr = arr.filter((d) => d.assignedRepId === me.id);
    } else if (repFilter && repFilter !== 'unassigned') {
      arr = arr.filter((d) => d.assignedRepId === repFilter);
    } else if (repFilter === 'unassigned') {
      arr = arr.filter((d) => !d.assignedRepId);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter((d) =>
        d.name.toLowerCase().includes(q) ||
        `${d.merchantFirstName ?? ''} ${d.merchantLastName ?? ''}`.toLowerCase().includes(q) ||
        (d.merchantEmail ?? '').toLowerCase().includes(q)
      );
    }
    // Sort. Default = most-recent first. Sort-by-rep groups by rep name
    // (with unassigned last) for fast scanning of who owns what.
    if (sortKey === 'rep') {
      const repNameOf = (d: typeof arr[number]) => {
        if (!d.assignedRepId) return '\uffff'; // sort unassigned last
        return reps.find((r) => r.id === d.assignedRepId)?.name?.toLowerCase() ?? '\uffff';
      };
      arr = [...arr].sort((a, b) => {
        const cmp = repNameOf(a).localeCompare(repNameOf(b));
        if (cmp !== 0) return cmp;
        // Tie-break: most recently updated first within a rep
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    } else if (sortKey === 'oldest') {
      arr = [...arr].sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
    } else {
      arr = [...arr].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    return arr;
  }, [deals, statusFilter, search, repFilter, me, sortKey, reps]);

  const counts = useMemo(() => {
    const pipeline = deals.filter((d) => !HIDDEN_FROM_ACTIVE.has(d.status));
    const c: Record<string, number> = { all: pipeline.length };
    for (const s of STATUS_OPTIONS) c[s] = pipeline.filter((d) => d.status === s).length;
    return c;
  }, [deals]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Active Deals"
        description="Edit deal details, statuses, and assignments inline. Click a row to expand."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => exportCSV('active-deals', filtered, [
                { key: 'name', label: 'Deal Name' },
                { key: 'merchantFirstName', label: 'Merchant First' },
                { key: 'merchantLastName', label: 'Merchant Last' },
                { key: 'merchantPhone', label: 'Phone' },
                { key: 'merchantEmail', label: 'Email' },
                { key: 'status', label: 'Status' },
                { key: 'fundedWith', label: 'Funded With' },
                { key: 'fundedAmount', label: 'Funded Amount', format: (v) => (v ? Number(v) : '') },
                { key: 'factorRate', label: 'Factor Rate' },
                { key: 'termMode', label: 'Term Mode' },
                { key: 'termCount', label: 'Term Count' },
                { key: 'feePct', label: 'Fee %' },
                { key: 'amountCollected', label: 'Amount Collected', format: (v) => (v ? Number(v) : '') },
                { key: 'fundingDate', label: 'Funding Date', format: (v) => (v ? new Date(v as string).toISOString().slice(0, 10) : '') },
                { key: 'assignedRepName', label: 'Assigned Rep' },
                { key: 'notes', label: 'Notes' },
              ])}
              className="gap-1.5"
              disabled={filtered.length === 0}
            >
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button onClick={() => setCreating(blankDeal())} className="gap-1.5">
              <Plus className="h-4 w-4" /> New deal
            </Button>
          </div>
        }
      />

      {/* Status filter chips + search */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip label="All" count={counts.all} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
        {STATUS_OPTIONS.filter((s) => !HIDDEN_FROM_ACTIVE.has(s)).map((s) => (
          <FilterChip
            key={s}
            label={statusMeta(s).label}
            count={counts[s] ?? 0}
            active={statusFilter === s}
            onClick={() => setStatusFilter(s)}
            tone={statusMeta(s).tone}
          />
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Sort key — including by rep so admins can see who's working
              what at a glance. Default "recent" matches the prior behavior
              so the page doesn't feel different to existing users. */}
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as 'recent' | 'oldest' | 'rep')}
            className="h-9 rounded-md border border-input bg-card px-2 text-xs"
            title="Sort"
          >
            <option value="recent">Recent first</option>
            <option value="oldest">Oldest first</option>
            <option value="rep">By rep</option>
          </select>
          {/* Rep filter — admin-only (server-side scope already hides others'
              deals from reps; showing the dropdown to a rep would be
              misleading since they only see their own). */}
          {isAdmin && (
            <select
              value={repFilter}
              onChange={(e) => setRepFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-card px-2 text-xs max-w-[180px]"
              title="Filter by rep"
            >
              <option value="">All reps</option>
              <option value="mine">My deals only</option>
              <option value="unassigned">Unassigned</option>
              <option disabled>──────────</option>
              {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          <div className="relative w-full sm:w-auto sm:min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search deals or merchants…"
              className="pl-9"
            />
          </div>
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
              {/* Rep assignment at creation time — per spec, manually
                  created deals should be assignable immediately. The
                  selected rep flows through commissions, dashboards, and
                  deal views the same as any other assigned deal. */}
              <label className="space-y-1 sm:col-span-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Assign to rep</div>
                <RepPicker
                  value={creating.assignedRepId ?? ''}
                  onChange={(v) => setCreating({ ...creating, assignedRepId: v || null })}
                  reps={reps}
                />
              </label>
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
        // Compact responsive layout — fits a normal browser width without
        // horizontal scrolling. Columns removed vs previous:
        //   • First / Last → combined into a single "Merchant" column
        //   • Phone / Email → moved into the expanded row (still editable)
        //   • Live progress → removed (Active Deals is the PRE-funded
        //     pipeline; funded deals live in /portfolio where the paydown
        //     tracker lives). Keeping just Deal name, Merchant, Offers count,
        //     Status, Rep, Updated keeps every row under ~960px wide.
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-2 w-8"></th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Deal</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Merchant</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 w-20">Offers</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Status</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Rep</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 hidden md:table-cell">Updated</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((d) => {
                const isExpanded = expandedId === d.id;
                const fullName = [d.merchantFirstName, d.merchantLastName].filter(Boolean).join(' ') || '—';
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
                      <td className="px-3 py-2.5 font-medium truncate max-w-[200px]">{d.name}</td>
                      <td className="px-3 py-2.5 text-foreground/80 truncate max-w-[160px]">{fullName}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums" onClick={(e) => e.stopPropagation()}>
                        <OfferCountBadge dealId={d.id} />
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
                        <RepPicker
                          value={d.assignedRepId ?? ''}
                          onChange={(v) => quickRepChange(d, v || null)}
                          reps={reps}
                          size="sm"
                          disabled={savingId === d.id}
                          className="max-w-[150px]"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap hidden md:table-cell">
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
                        <td colSpan={8} className="px-4 py-4">
                          <div className="space-y-4 max-w-4xl">
                            {/* Merchant identity — phone/email moved here from the table */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <LabeledInline label="Deal name">
                                <Input defaultValue={d.name} onChange={(e) => patchDraft('name', e.target.value)} />
                              </LabeledInline>
                              <LabeledInline label="Merchant first">
                                <Input defaultValue={d.merchantFirstName ?? ''} onChange={(e) => patchDraft('merchantFirstName', e.target.value)} />
                              </LabeledInline>
                              <LabeledInline label="Merchant last">
                                <Input defaultValue={d.merchantLastName ?? ''} onChange={(e) => patchDraft('merchantLastName', e.target.value)} />
                              </LabeledInline>
                              <LabeledInline label="Merchant phone">
                                <Input defaultValue={d.merchantPhone ?? ''} onChange={(e) => patchDraft('merchantPhone', e.target.value)} />
                              </LabeledInline>
                              <LabeledInline label="Merchant email">
                                <Input type="email" defaultValue={d.merchantEmail ?? ''} onChange={(e) => patchDraft('merchantEmail', e.target.value)} />
                              </LabeledInline>
                            </div>

                            {/* Multi-offer manager — replaces the single
                                offerAmount + offerNotes inputs. Each offer
                                tracks funding amount, factor rate, term,
                                fees, payment amount, and notes. The rep can
                                mark one as accepted. Funding-detail entry
                                (fundedAmount, feePct, fundingDate, etc) has
                                been moved out of Active Deals — those only
                                live on Funded Deals now per the spec. */}
                            <OffersManager dealId={d.id} />

                            <div className="flex justify-between items-center gap-2 pt-2 border-t border-border">
                              {/* Quick path to the unified shop view with this
                                  deal's context — opens the matching engine
                                  pre-loaded with the deal's already-submitted
                                  bucket so the user can see who's already seen
                                  this file before picking new funders. */}
                              <a
                                href={`/deal-shop?dealId=${encodeURIComponent(d.id)}`}
                                className="text-xs font-medium text-primary hover:underline"
                              >
                                Shop this deal →
                              </a>
                              <div className="flex gap-2">
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

      {/* Mark-as-funded modal: collects merchant contact + funding details
          so the deal lands on the Funded Deals page complete. Cancel just
          closes — the status change isn't committed unless the user saves. */}
      {markingFunded && (
        <MarkFundedModal
          deal={markingFunded}
          onClose={() => setMarkingFunded(null)}
          onSaved={(updatedFields) => {
            setDeals((arr) => arr.map((x) =>
              x.id === markingFunded.id ? { ...x, ...updatedFields, status: 'funded' } : x
            ));
            setMarkingFunded(null);
            toast.success('Marked as funded.');
          }}
        />
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

/* ---------- Multi-offer tracking ---------- */

interface OfferRow {
  id: string;
  fundingAmount: string | null;
  factorRate: string | null;
  termCount: number | null;
  termMode: string | null;
  fees: string | null;
  paymentAmount: string | null;
  notes: string | null;
  funderId: string | null;
  isAccepted: boolean;
  createdAt: string;
}

/**
 * Tiny inline badge for the main table row — shows how many offers a deal has,
 * with a green ring if one is marked accepted. Fetches per deal but the data
 * is cached briefly so re-expanding doesn't refetch.
 */
const offerCountCache = new Map<string, { count: number; accepted: boolean }>();
function OfferCountBadge({ dealId }: { dealId: string }) {
  const [state, setState] = useState<{ count: number; accepted: boolean } | null>(
    () => offerCountCache.get(dealId) ?? null
  );
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deals/${dealId}/offers`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const rows = (j?.data ?? []) as OfferRow[];
        const next = { count: rows.length, accepted: rows.some((r) => r.isAccepted) };
        offerCountCache.set(dealId, next);
        setState(next);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dealId]);
  if (!state) return <span className="text-muted-foreground">·</span>;
  if (state.count === 0) return <span className="text-muted-foreground">0</span>;
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center min-w-[24px] h-5 px-1.5 rounded text-[11px] font-semibold border',
        state.accepted
          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
          : 'bg-blue-50 text-blue-700 border-blue-200'
      )}
      title={state.accepted ? `${state.count} offer(s), one accepted` : `${state.count} offer(s)`}
    >
      {state.count}
    </span>
  );
}

const blankOffer = (): Omit<OfferRow, 'id' | 'createdAt'> => ({
  fundingAmount: '',
  factorRate: '',
  termCount: null,
  termMode: 'weeks',
  fees: '',
  paymentAmount: '',
  notes: '',
  funderId: null,
  isAccepted: false,
});

/**
 * Multi-offer manager — lists all offers for a deal, lets the rep add new
 * ones, edit existing ones inline, mark one as accepted, and compare them
 * side-by-side. Replaces the old single-offerAmount / single-offerNotes
 * inputs that used to live on Active Deals.
 */
function OffersManager({ dealId }: { dealId: string }) {
  const toast = useToast();
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(blankOffer());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);

  async function load() {
    const r = await fetch(`/api/deals/${dealId}/offers`, { cache: 'no-store' });
    const j = await r.json();
    const rows = (j?.data ?? []) as OfferRow[];
    setOffers(rows);
    offerCountCache.set(dealId, { count: rows.length, accepted: rows.some((x) => x.isAccepted) });
    setLoaded(true);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dealId]);

  async function addOffer() {
    setSavingId('__new');
    const res = await fetch(`/api/deals/${dealId}/offers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    setSavingId(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || 'Could not save offer.');
      return;
    }
    setAdding(false);
    setDraft(blankOffer());
    load();
  }

  async function updateOffer(id: string, patch: Partial<OfferRow>) {
    // Optimistic local update — same pattern as submissions, keeps things snappy.
    setOffers((prev) => prev.map((o) => o.id === id ? { ...o, ...patch } : o));
    const res = await fetch(`/api/offers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || 'Save failed — reloading.');
      load();
    } else if ('isAccepted' in patch) {
      // Accepting an offer flips it on others — refetch to sync.
      load();
    }
  }

  async function deleteOffer(id: string) {
    if (!confirm('Delete this offer?')) return;
    await fetch(`/api/offers/${id}`, { method: 'DELETE' });
    load();
  }

  if (!loaded) {
    return (
      <div className="pt-3 border-t border-border text-xs text-muted-foreground">Loading offers…</div>
    );
  }

  return (
    <div className="pt-3 border-t border-border space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Offers {offers.length > 0 && <span className="text-foreground/60 normal-case font-normal">— {offers.length} on file</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {offers.length > 1 && (
            <Button size="sm" variant="outline" onClick={() => setCompareMode((v) => !v)}>
              {compareMode ? 'List view' : 'Compare'}
            </Button>
          )}
          {!adding && (
            <Button size="sm" onClick={() => setAdding(true)} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> Add offer
            </Button>
          )}
        </div>
      </div>

      {offers.length === 0 && !adding && (
        <div className="text-xs text-muted-foreground italic py-2">No offers yet. Add one as funders respond.</div>
      )}

      {/* Add-offer form */}
      {adding && (
        <div className="rounded-md border border-border bg-card p-3 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <OfferField label="Funding amount ($)">
              <Input inputMode="decimal" value={String(draft.fundingAmount ?? '')} onChange={(e) => setDraft({ ...draft, fundingAmount: e.target.value })} placeholder="50000" />
            </OfferField>
            <OfferField label="Factor rate">
              <Input inputMode="decimal" value={String(draft.factorRate ?? '')} onChange={(e) => setDraft({ ...draft, factorRate: e.target.value })} placeholder="1.40" />
            </OfferField>
            <OfferField label="Term">
              <div className="flex gap-1">
                <Input inputMode="numeric" className="flex-1" value={draft.termCount == null ? '' : String(draft.termCount)} onChange={(e) => setDraft({ ...draft, termCount: e.target.value === '' ? null : Number(e.target.value) })} placeholder="26" />
                <select className="h-9 rounded-md border border-input bg-card px-1 text-xs" value={draft.termMode ?? 'weeks'} onChange={(e) => setDraft({ ...draft, termMode: e.target.value })}>
                  <option value="days">days</option>
                  <option value="weeks">wks</option>
                  <option value="months">mos</option>
                </select>
              </div>
            </OfferField>
            <OfferField label="Fees ($)">
              <Input inputMode="decimal" value={String(draft.fees ?? '')} onChange={(e) => setDraft({ ...draft, fees: e.target.value })} placeholder="1500" />
            </OfferField>
            <OfferField label="Payment ($)">
              <Input inputMode="decimal" value={String(draft.paymentAmount ?? '')} onChange={(e) => setDraft({ ...draft, paymentAmount: e.target.value })} placeholder="2692" />
            </OfferField>
          </div>
          <OfferField label="Notes">
            <Input value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Funder name, conditions, etc." />
          </OfferField>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setDraft(blankOffer()); }}>Cancel</Button>
            <Button size="sm" onClick={addOffer} loading={savingId === '__new'}>Save offer</Button>
          </div>
        </div>
      )}

      {/* Compare view — side-by-side table for fast eyeballing */}
      {offers.length > 0 && compareMode && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/40">
                <th className="text-left px-2 py-1.5 font-semibold">Field</th>
                {offers.map((o, i) => (
                  <th key={o.id} className={cn('text-left px-2 py-1.5 font-semibold', o.isAccepted && 'text-emerald-700')}>
                    Offer {i + 1}{o.isAccepted && ' ★'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {[
                { k: 'fundingAmount', label: 'Funding', fmt: (v: string | null) => v ? formatCurrency(Number(v)) : '—' },
                { k: 'factorRate', label: 'Factor', fmt: (v: string | null) => v ?? '—' },
                { k: 'termCount', label: 'Term', fmt: (v: number | null, o: OfferRow) => v != null ? `${v} ${o.termMode ?? ''}` : '—' },
                { k: 'fees', label: 'Fees', fmt: (v: string | null) => v ? formatCurrency(Number(v)) : '—' },
                { k: 'paymentAmount', label: 'Payment', fmt: (v: string | null) => v ? formatCurrency(Number(v)) : '—' },
                { k: 'notes', label: 'Notes', fmt: (v: string | null) => v ?? '—' },
              ].map((row) => (
                <tr key={row.k}>
                  <td className="px-2 py-1.5 text-muted-foreground font-medium">{row.label}</td>
                  {offers.map((o) => (
                    <td key={o.id} className="px-2 py-1.5">
                      {/* @ts-expect-error — dynamic key lookup */}
                      {row.fmt(o[row.k], o)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* List view — each offer is editable inline */}
      {offers.length > 0 && !compareMode && (
        <div className="space-y-2">
          {offers.map((o, i) => (
            <div
              key={o.id}
              className={cn(
                'rounded-md border p-2.5 space-y-2',
                o.isAccepted ? 'border-emerald-300 bg-emerald-50/40' : 'border-border bg-card'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold flex items-center gap-2">
                  Offer {i + 1}
                  {o.isAccepted && <Badge variant="success">Accepted</Badge>}
                </div>
                <div className="flex items-center gap-1">
                  <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={o.isAccepted}
                      onChange={(e) => updateOffer(o.id, { isAccepted: e.target.checked })}
                    />
                    Accept
                  </label>
                  <button onClick={() => deleteOffer(o.id)} className="text-muted-foreground hover:text-destructive p-1" title="Delete offer">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <OfferField label="Funding ($)">
                  <Input inputMode="decimal" defaultValue={o.fundingAmount ?? ''} onBlur={(e) => updateOffer(o.id, { fundingAmount: e.target.value || null })} className="h-8 text-xs" />
                </OfferField>
                <OfferField label="Factor">
                  <Input inputMode="decimal" defaultValue={o.factorRate ?? ''} onBlur={(e) => updateOffer(o.id, { factorRate: e.target.value || null })} className="h-8 text-xs" />
                </OfferField>
                <OfferField label="Term">
                  <div className="flex gap-1">
                    <Input inputMode="numeric" defaultValue={o.termCount == null ? '' : String(o.termCount)} onBlur={(e) => updateOffer(o.id, { termCount: e.target.value === '' ? null : Number(e.target.value) })} className="h-8 text-xs flex-1" />
                    <select defaultValue={o.termMode ?? 'weeks'} onChange={(e) => updateOffer(o.id, { termMode: e.target.value })} className="h-8 rounded-md border border-input bg-card px-1 text-[11px]">
                      <option value="days">days</option>
                      <option value="weeks">wks</option>
                      <option value="months">mos</option>
                    </select>
                  </div>
                </OfferField>
                <OfferField label="Fees ($)">
                  <Input inputMode="decimal" defaultValue={o.fees ?? ''} onBlur={(e) => updateOffer(o.id, { fees: e.target.value || null })} className="h-8 text-xs" />
                </OfferField>
                <OfferField label="Payment ($)">
                  <Input inputMode="decimal" defaultValue={o.paymentAmount ?? ''} onBlur={(e) => updateOffer(o.id, { paymentAmount: e.target.value || null })} className="h-8 text-xs" />
                </OfferField>
              </div>
              <OfferField label="Notes">
                <Input defaultValue={o.notes ?? ''} onBlur={(e) => updateOffer(o.id, { notes: e.target.value || null })} className="h-8 text-xs" />
              </OfferField>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OfferField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}


/* ---------- Live paydown tracker ---------- */
function LiveProgressCell({ deal }: { deal: Deal }) {
  // Auto-estimate as of today: amountCollected left as-is so computePaydown
  // estimates payments made from elapsed business days/weeks when it's blank.
  const p = computePaydown({
    fundedAmount: deal.fundedAmount,
    factorRate: deal.factorRate,
    termMode: deal.termMode,
    termCount: deal.termCount,
    fundingDate: deal.fundingDate,
    amountCollected: deal.amountCollected,
  });

  if (!p.hasStructure) {
    return <span className="text-xs italic text-muted-foreground/60">add funding details</span>;
  }

  return (
    <div className="w-[170px]">
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="tabular-nums font-medium">{p.pctPaidIn}% paid</span>
        <span className="tabular-nums text-muted-foreground">{formatCurrency(p.remainingBalance)} left</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', p.renewalEligible ? 'bg-teal-500' : 'bg-primary')} style={{ width: `${Math.min(100, p.pctPaidIn)}%` }} />
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
        <span>{p.paymentsMade}/{p.paymentsTotal} pmts</span>
        {p.renewalEligible
          ? <span className="text-teal-700 font-medium">Refi ready</span>
          : <span>refi {p.renewalDate ? p.renewalDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</span>}
      </div>
    </div>
  );
}

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
        <Metric label="Funded" value={formatCurrency(p.fundedAmount)} />
        {deal.feePct && <Metric label={`Net (after ${Number(deal.feePct)}% fee)`} value={formatCurrency(p.fundedAmount * (1 - Number(deal.feePct) / 100))} />}
        <Metric label="Total payback" value={formatCurrency(p.totalPayback)} />
        <Metric label={p.termMode === 'daily' ? 'Daily payment' : 'Weekly payment'} value={formatCurrency(p.paymentAmount)} />
        <Metric label="Collected (est.)" value={formatCurrency(p.amountCollected)} />
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

/**
 * Modal that opens when an Active Deal is being moved to "funded" status.
 *
 * Collects the data needed for the Funded Deals page in one shot:
 *   - Merchant contact (first/last/phone/email) — frequently missing on
 *     deals that came through the system as cold criteria + funder shop.
 *   - Funded amount, fee%, factor, funding date, term type, # of payments —
 *     the paydown engine needs all of these to compute balance/payoff.
 *
 * Cancel closes without committing the status change. Save persists every
 * touched field PLUS sets status='funded' in one PATCH so the deal moves
 * to /portfolio fully populated.
 */
function MarkFundedModal({
  deal,
  onClose,
  onSaved,
}: {
  deal: Deal;
  onClose: () => void;
  onSaved: (patch: Partial<Deal>) => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    merchantFirstName: deal.merchantFirstName ?? '',
    merchantLastName: deal.merchantLastName ?? '',
    merchantPhone: deal.merchantPhone ?? '',
    merchantEmail: deal.merchantEmail ?? '',
    fundedAmount: deal.fundedAmount ?? '',
    feePct: deal.feePct ?? '',
    factorRate: deal.factorRate ?? '',
    termMode: deal.termMode ?? 'weekly',
    termCount: deal.termCount ?? '',
    fundingDate: deal.fundingDate ? String(deal.fundingDate).slice(0, 10) : '',
  });

  async function save() {
    if (!form.fundedAmount || !form.fundingDate) {
      toast.error('Funded amount and funding date are required.');
      return;
    }
    setSaving(true);
    const body: Record<string, unknown> = {
      status: 'funded',
      merchantFirstName: form.merchantFirstName.trim() || null,
      merchantLastName: form.merchantLastName.trim() || null,
      merchantPhone: form.merchantPhone.trim() || null,
      merchantEmail: form.merchantEmail.trim() || null,
      fundedAmount: form.fundedAmount || null,
      feePct: form.feePct || null,
      factorRate: form.factorRate || null,
      termMode: form.termMode,
      termCount: form.termCount || null,
      fundingDate: form.fundingDate || null,
    };
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || 'Could not save.');
      return;
    }
    onSaved(body as Partial<Deal>);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-background border-l border-border h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-semibold">Move to funded</h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{deal.name}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Mark funded'}</Button>
          </div>
        </div>
        <div className="p-6 space-y-5">
          <section>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/70 mb-2">Merchant contact</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name">
                <Input value={form.merchantFirstName} onChange={(e) => setForm({ ...form, merchantFirstName: e.target.value })} />
              </Field>
              <Field label="Last name">
                <Input value={form.merchantLastName} onChange={(e) => setForm({ ...form, merchantLastName: e.target.value })} />
              </Field>
              <Field label="Phone">
                <Input value={form.merchantPhone} onChange={(e) => setForm({ ...form, merchantPhone: e.target.value })} placeholder="(555) 555-5555" />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.merchantEmail} onChange={(e) => setForm({ ...form, merchantEmail: e.target.value })} placeholder="merchant@business.com" />
              </Field>
            </div>
          </section>

          <section>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/70 mb-2">Funding details</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Funded amount" required>
                <CurrencyInput value={form.fundedAmount} onChange={(v) => setForm({ ...form, fundedAmount: v })} placeholder="50,000" />
              </Field>
              <Field label="Fee">
                <PercentInput value={form.feePct} onChange={(v) => setForm({ ...form, feePct: v })} placeholder="5" />
              </Field>
              <Field label="Factor rate">
                <Input inputMode="decimal" value={form.factorRate} onChange={(e) => setForm({ ...form, factorRate: e.target.value })} placeholder="1.40" />
              </Field>
              <Field label="Funding date" required>
                <Input type="date" value={form.fundingDate} onChange={(e) => setForm({ ...form, fundingDate: e.target.value })} />
              </Field>
              <Field label="Term type">
                <select
                  value={form.termMode}
                  onChange={(e) => setForm({ ...form, termMode: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                >
                  <option value="weekly">Weekly</option>
                  <option value="daily">Daily</option>
                </select>
              </Field>
              <Field label="# of payments">
                <Input inputMode="numeric" value={form.termCount} onChange={(e) => setForm({ ...form, termCount: e.target.value })} placeholder="26" />
              </Field>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
