'use client';
/**
 * Syndication board — deals open for syndication, posted with full terms.
 * Reps put their name + company + the amount they want in. Every deal row can
 * be copied (terms + all entries) with one click for pasting anywhere.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  PageHeader, Card, CardContent, Button, Input, Textarea, Field, Badge, EmptyState,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-provider';
import { formatCurrency, cn } from '@/lib/utils';
import { Handshake, Copy, ChevronDown, ChevronRight, Plus, Trash2, Lock, Unlock } from 'lucide-react';

interface Entry {
  id: string;
  userId: string | null;
  repName: string;
  companyName: string | null;
  amount: string;
  createdAt: string;
}
interface SynDeal {
  id: string;
  dealName: string;
  fundingAmount: string | null;
  term: string | null;
  rate: string | null;
  commission: string | null;
  fee: string | null;
  hasEarlyPayoff: boolean;
  earlyPayoffDetails: string | null;
  funderName: string | null;
  positionNumber: string | null;
  notes: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
  entries: Entry[];
  committedTotal: number;
}

const BLANK_FORM = {
  dealName: '', fundingAmount: '', term: '', rate: '', commission: '', fee: '',
  hasEarlyPayoff: false, earlyPayoffDetails: '', funderName: '', positionNumber: '', notes: '',
};

/** Build the copy-paste text for a syndication deal: full capture + entries. */
function buildCopyText(d: SynDeal): string {
  const lines: string[] = [];
  lines.push(`DEAL: ${d.dealName}`);
  if (d.fundingAmount) lines.push(`Funding amount: ${formatCurrency(d.fundingAmount)}`);
  if (d.term) lines.push(`Term: ${d.term}`);
  if (d.rate) lines.push(`Rate: ${d.rate}`);
  if (d.commission) lines.push(`Commission: ${d.commission}`);
  if (d.fee) lines.push(`Fee: ${d.fee}`);
  lines.push(`Early payoff: ${d.hasEarlyPayoff ? (d.earlyPayoffDetails ? `Yes — ${d.earlyPayoffDetails}` : 'Yes') : 'No'}`);
  if (d.funderName) lines.push(`Funder: ${d.funderName}`);
  if (d.positionNumber) lines.push(`Position: ${d.positionNumber}`);
  if (d.notes) lines.push(`Notes: ${d.notes}`);
  if (d.entries.length) {
    lines.push('');
    lines.push('SYNDICATION:');
    for (const e of d.entries) {
      lines.push(`  ${e.repName}${e.companyName ? ` — ${e.companyName}` : ''} — ${formatCurrency(e.amount)}`);
    }
    lines.push(`Total committed: ${formatCurrency(d.committedTotal)}${d.fundingAmount ? ` of ${formatCurrency(d.fundingAmount)}` : ''}`);
  }
  return lines.join('\n');
}

export default function SyndicationPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [me, setMe] = useState<{ id?: string; name?: string; role?: string } | undefined>(undefined);
  const isAdmin = me?.role === 'company_admin' || me?.role === 'master_admin';

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setMe(j?.user ?? undefined))
      .catch(() => {});
  }, []);

  const [dealsList, setDealsList] = useState<SynDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClosed, setShowClosed] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showPost, setShowPost] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [posting, setPosting] = useState(false);
  // Per-deal "my entry" drafts
  const [entryDrafts, setEntryDrafts] = useState<Record<string, { repName: string; companyName: string; amount: string }>>({});

  async function load() {
    try {
      const res = await fetch('/api/syndication', { cache: 'no-store' });
      const j = await res.json();
      if (res.ok) setDealsList(j.data ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const visible = useMemo(
    () => dealsList.filter((d) => showClosed || d.status === 'open'),
    [dealsList, showClosed]
  );

  function toggle(id: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function postDeal() {
    if (!form.dealName.trim()) { toast.error('Deal name is required.'); return; }
    setPosting(true);
    try {
      const res = await fetch('/api/syndication', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          fundingAmount: form.fundingAmount ? Number(form.fundingAmount.replace(/[^0-9.]/g, '')) : null,
        }),
      });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || 'Could not post the deal.'); return; }
      toast.success('Deal posted for syndication.');
      setForm({ ...BLANK_FORM });
      setShowPost(false);
      load();
    } finally {
      setPosting(false);
    }
  }

  async function addEntry(deal: SynDeal) {
    const draft = entryDrafts[deal.id] ?? { repName: me?.name ?? '', companyName: '', amount: '' };
    const amount = Number(draft.amount.replace(/[^0-9.]/g, ''));
    if (!draft.repName.trim()) { toast.error('Your name is required.'); return; }
    if (!amount || amount <= 0) { toast.error('Enter the amount you want to syndicate.'); return; }
    const res = await fetch(`/api/syndication/${deal.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repName: draft.repName, companyName: draft.companyName || null, amount }),
    });
    const j = await res.json();
    if (!res.ok) { toast.error(j.error || 'Could not add your entry.'); return; }
    toast.success('You’re in — entry added.');
    setEntryDrafts((m) => ({ ...m, [deal.id]: { repName: draft.repName, companyName: draft.companyName, amount: '' } }));
    load();
  }

  async function removeEntry(entry: Entry) {
    const ok = await confirm({
      title: 'Remove this entry?',
      description: `${entry.repName} — ${formatCurrency(entry.amount)}`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/syndication/entries/${entry.id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Entry removed.'); load(); }
    else { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Could not remove.'); }
  }

  async function setStatus(deal: SynDeal, status: 'open' | 'closed') {
    const res = await fetch(`/api/syndication/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) { toast.success(status === 'closed' ? 'Syndication closed.' : 'Reopened.'); load(); }
  }

  async function removeDeal(deal: SynDeal) {
    const ok = await confirm({
      title: 'Remove this deal from the board?',
      description: `"${deal.dealName}" and its ${deal.entries.length} entr${deal.entries.length === 1 ? 'y' : 'ies'} will be removed from the syndication board. Your CRM deals are not affected.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/syndication/${deal.id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Removed from the board.'); load(); }
    else { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Could not remove.'); }
  }

  async function copyDeal(d: SynDeal) {
    try {
      await navigator.clipboard.writeText(buildCopyText(d));
      toast.success('Copied — deal terms + all syndication entries.');
    } catch {
      toast.error('Could not copy to clipboard.');
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Syndication"
        description="Deals open for syndication. Review the terms, put your name and amount in, and copy the full capture with one click."
        actions={
          <Button onClick={() => setShowPost((v) => !v)}>
            <Plus className="h-4 w-4" /> Post a deal
          </Button>
        }
      />

      {showPost && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="text-sm font-semibold">Post a deal for syndication</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="Deal name" required>
                <Input value={form.dealName} onChange={(e) => setForm({ ...form, dealName: e.target.value })} placeholder="Merchant / deal name" />
              </Field>
              <Field label="Funding amount">
                <Input value={form.fundingAmount} onChange={(e) => setForm({ ...form, fundingAmount: e.target.value })} placeholder="$150,000" inputMode="decimal" />
              </Field>
              <Field label="Term">
                <Input value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} placeholder="e.g. 120 business days" />
              </Field>
              <Field label="Rate">
                <Input value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="e.g. 1.45" />
              </Field>
              <Field label="Commission">
                <Input value={form.commission} onChange={(e) => setForm({ ...form, commission: e.target.value })} placeholder="e.g. 10 points" />
              </Field>
              <Field label="Fee">
                <Input value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} placeholder="e.g. 3% origination" />
              </Field>
              <Field label="Funder">
                <Input value={form.funderName} onChange={(e) => setForm({ ...form, funderName: e.target.value })} placeholder="Funding with" />
              </Field>
              <Field label="Position #">
                <Input value={form.positionNumber} onChange={(e) => setForm({ ...form, positionNumber: e.target.value })} placeholder="e.g. 2nd" />
              </Field>
              <Field label="Early payoff?">
                <label className="flex items-center gap-2 h-10 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={form.hasEarlyPayoff}
                    onChange={(e) => setForm({ ...form, hasEarlyPayoff: e.target.checked })}
                  />
                  <span className="text-sm">{form.hasEarlyPayoff ? 'Yes — describe below' : 'No early payoff'}</span>
                </label>
              </Field>
            </div>
            {form.hasEarlyPayoff && (
              <Field label="Early payoff details">
                <Input value={form.earlyPayoffDetails} onChange={(e) => setForm({ ...form, earlyPayoffDetails: e.target.value })} placeholder="e.g. 20% discount if paid within 30 days" />
              </Field>
            )}
            <Field label="Additional notes">
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Anything else syndicators should know" />
            </Field>
            <div className="flex items-center gap-2">
              <Button onClick={postDeal} disabled={posting}>{posting ? 'Posting…' : 'Post to board'}</Button>
              <Button variant="ghost" onClick={() => { setShowPost(false); setForm({ ...BLANK_FORM }); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input type="checkbox" className="h-4 w-4" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Show closed
        </label>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="No deals on the board"
          description="Post a deal to open it up for syndication — reps can then put in the amount they want."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[880px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2.5 w-8"></th>
                    <th className="px-3 py-2.5 font-medium">Deal</th>
                    <th className="px-3 py-2.5 font-medium text-right">Funding</th>
                    <th className="px-3 py-2.5 font-medium">Term</th>
                    <th className="px-3 py-2.5 font-medium">Rate</th>
                    <th className="px-3 py-2.5 font-medium">Funder</th>
                    <th className="px-3 py-2.5 font-medium">Pos.</th>
                    <th className="px-3 py-2.5 font-medium text-right">Committed</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((d) => {
                    const isOpen = expanded.has(d.id);
                    const target = Number(d.fundingAmount || 0);
                    const pct = target > 0 ? Math.min(100, Math.round((d.committedTotal / target) * 100)) : null;
                    const canManage = isAdmin || d.createdBy === me?.id;
                    return (
                      <FragmentRow key={d.id}>
                        <tr
                          className={cn('border-b border-border/60 hover:bg-muted/40 cursor-pointer transition-colors', isOpen && 'bg-muted/30')}
                          onClick={() => toggle(d.id)}
                        >
                          <td className="px-3 py-2.5 text-muted-foreground">
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </td>
                          <td className="px-3 py-2.5 font-medium">{d.dealName}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">{d.fundingAmount ? formatCurrency(d.fundingAmount) : '—'}</td>
                          <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{d.term || '—'}</td>
                          <td className="px-3 py-2.5 tabular-nums">{d.rate || '—'}</td>
                          <td className="px-3 py-2.5">{d.funderName || '—'}</td>
                          <td className="px-3 py-2.5">{d.positionNumber || '—'}</td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            <span className="tabular-nums font-medium">{formatCurrency(d.committedTotal)}</span>
                            {pct !== null && <span className="ml-1.5 text-[11px] text-muted-foreground">({pct}%)</span>}
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge className={cn(d.status === 'open' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-gray-100 text-gray-600 border-gray-200')}>
                              {d.status === 'open' ? 'Open' : 'Closed'}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => copyDeal(d)}
                              title="Copy deal + syndication entries"
                              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Copy className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-border bg-muted/20">
                            <td colSpan={10} className="px-5 py-4">
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                {/* Terms */}
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Deal terms</div>
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
                                    <Term k="Commission" v={d.commission} />
                                    <Term k="Fee" v={d.fee} />
                                    <Term k="Early payoff" v={d.hasEarlyPayoff ? (d.earlyPayoffDetails || 'Yes') : 'No'} />
                                    <Term k="Funder" v={d.funderName} />
                                    <Term k="Position" v={d.positionNumber} />
                                    <Term k="Term" v={d.term} />
                                  </div>
                                  {d.notes && <p className="text-[13px] text-muted-foreground mt-2.5 whitespace-pre-wrap">{d.notes}</p>}
                                  <div className="flex items-center gap-2 mt-3">
                                    <Button size="sm" variant="outline" onClick={() => copyDeal(d)}>
                                      <Copy className="h-3.5 w-3.5" /> Copy all
                                    </Button>
                                    {canManage && (
                                      d.status === 'open' ? (
                                        <Button size="sm" variant="outline" onClick={() => setStatus(d, 'closed')}><Lock className="h-3.5 w-3.5" /> Close</Button>
                                      ) : (
                                        <Button size="sm" variant="outline" onClick={() => setStatus(d, 'open')}><Unlock className="h-3.5 w-3.5" /> Reopen</Button>
                                      )
                                    )}
                                    {canManage && (
                                      <Button size="sm" variant="ghost" onClick={() => removeDeal(d)}>
                                        <Trash2 className="h-3.5 w-3.5" /> Remove
                                      </Button>
                                    )}
                                  </div>
                                </div>

                                {/* Entries */}
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                                    Syndication entries {d.entries.length > 0 && `(${d.entries.length})`}
                                  </div>
                                  {d.entries.length === 0 ? (
                                    <div className="text-[13px] text-muted-foreground mb-2">No one has put in yet — be first.</div>
                                  ) : (
                                    <div className="rounded-lg border border-border overflow-hidden mb-3">
                                      <table className="w-full text-[13px]">
                                        <thead>
                                          <tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                                            <th className="px-3 py-1.5 font-medium">Rep</th>
                                            <th className="px-3 py-1.5 font-medium">Company</th>
                                            <th className="px-3 py-1.5 font-medium text-right">Amount</th>
                                            <th className="w-8"></th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {d.entries.map((e) => (
                                            <tr key={e.id} className="border-t border-border/60">
                                              <td className="px-3 py-1.5 font-medium">{e.repName}</td>
                                              <td className="px-3 py-1.5 text-muted-foreground">{e.companyName || '—'}</td>
                                              <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatCurrency(e.amount)}</td>
                                              <td className="px-1 py-1.5">
                                                {(isAdmin || e.userId === me?.id) && (
                                                  <button onClick={() => removeEntry(e)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-rose-500" title="Remove entry">
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                  </button>
                                                )}
                                              </td>
                                            </tr>
                                          ))}
                                          <tr className="border-t border-border bg-muted/30">
                                            <td className="px-3 py-1.5 font-semibold" colSpan={2}>Total committed</td>
                                            <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{formatCurrency(d.committedTotal)}</td>
                                            <td></td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  )}

                                  {d.status === 'open' && (
                                    <div className="flex flex-wrap items-end gap-2">
                                      <Field label="Your name" className="flex-1 min-w-[140px]">
                                        <Input
                                          value={entryDrafts[d.id]?.repName ?? me?.name ?? ''}
                                          onChange={(e) => setEntryDrafts((m) => ({ ...m, [d.id]: { repName: e.target.value, companyName: m[d.id]?.companyName ?? '', amount: m[d.id]?.amount ?? '' } }))}
                                          className="h-9"
                                        />
                                      </Field>
                                      <Field label="Company" className="flex-1 min-w-[140px]">
                                        <Input
                                          value={entryDrafts[d.id]?.companyName ?? ''}
                                          onChange={(e) => setEntryDrafts((m) => ({ ...m, [d.id]: { repName: m[d.id]?.repName ?? me?.name ?? '', companyName: e.target.value, amount: m[d.id]?.amount ?? '' } }))}
                                          placeholder="Your company"
                                          className="h-9"
                                        />
                                      </Field>
                                      <Field label="Amount" className="w-[130px]">
                                        <Input
                                          value={entryDrafts[d.id]?.amount ?? ''}
                                          onChange={(e) => setEntryDrafts((m) => ({ ...m, [d.id]: { repName: m[d.id]?.repName ?? me?.name ?? '', companyName: m[d.id]?.companyName ?? '', amount: e.target.value } }))}
                                          placeholder="$25,000"
                                          inputMode="decimal"
                                          className="h-9"
                                        />
                                      </Field>
                                      <Button size="sm" onClick={() => addEntry(d)} className="h-9">
                                        <Plus className="h-3.5 w-3.5" /> Put me in
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </FragmentRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Term({ k, v }: { k: string; v: string | null }) {
  if (!v) return null;
  return (
    <>
      <div className="text-muted-foreground">{k}</div>
      <div className="font-medium">{v}</div>
    </>
  );
}

/** Plain fragment wrapper so the two <tr>s stay valid table children. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
