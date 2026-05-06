'use client';

import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, Button, Input, Textarea, Badge, PageHeader, EmptyState } from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { formatDate } from '@/lib/utils';
import { Plus, Trash2, Briefcase, Search, X, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Deal {
  id: string;
  name: string;
  merchantFirstName: string | null;
  merchantLastName: string | null;
  merchantEmail: string | null;
  merchantPhone: string | null;
  offerNotes: string | null;
  assignedRepId: string | null;
  status: 'shopping' | 'submitted' | 'active' | 'funded' | 'dead';
  createdAt: string;
  updatedAt: string;
}

const STATUS_OPTIONS: { value: Deal['status']; label: string; tone: 'success' | 'warning' | 'destructive' | 'default' | 'outline' }[] = [
  { value: 'shopping',  label: 'Shopping',  tone: 'outline' },
  { value: 'submitted', label: 'Submitted', tone: 'warning' },
  { value: 'active',    label: 'Active',    tone: 'default' },
  { value: 'funded',    label: 'Funded',    tone: 'success' },
  { value: 'dead',      label: 'Dead',      tone: 'destructive' },
];

const blankDeal = (): Deal => ({
  id: '', name: '', merchantFirstName: '', merchantLastName: '',
  merchantEmail: '', merchantPhone: '', offerNotes: '',
  assignedRepId: null, status: 'shopping', createdAt: '', updatedAt: '',
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
    for (const s of STATUS_OPTIONS) c[s.value] = deals.filter((d) => d.status === s.value).length;
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
        <FilterChip
          label="All"
          count={counts.all}
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
        />
        {STATUS_OPTIONS.map((s) => (
          <FilterChip
            key={s.value}
            label={s.label}
            count={counts[s.value] ?? 0}
            active={statusFilter === s.value}
            onClick={() => setStatusFilter(s.value)}
            tone={s.tone}
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
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2 w-8"></th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Deal</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Merchant</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Status</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Rep</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Updated</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((d) => {
                const isExpanded = expandedId === d.id;
                const merchant = `${d.merchantFirstName ?? ''} ${d.merchantLastName ?? ''}`.trim();
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
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </td>
                      <td className="px-3 py-2.5 font-medium">{d.name}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {merchant || '—'}
                        {d.merchantEmail && (
                          <div className="text-[10px] font-mono">{d.merchantEmail}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={d.status}
                          onChange={(e) => quickStatusChange(d, e.target.value as Deal['status'])}
                          disabled={savingId === d.id}
                          className="h-8 rounded-md border border-input bg-card px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>
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
                      <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums">
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
                        <td colSpan={7} className="px-4 py-4">
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
  tone?: 'success' | 'warning' | 'destructive' | 'default' | 'outline';
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
