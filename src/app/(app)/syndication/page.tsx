'use client';
/**
 * Syndication board — deals open for syndication, posted with full terms.
 *
 * Layout: one CARD per deal with every term visible (no expanding rows).
 * Reps pick their name from the saved rep↔company directory (company
 * auto-fills), type the amount (commas as they type), and hit "Add me in".
 * Copy on a deal copies ONLY the syndication lines: each rep's company and
 * how much they're putting in.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  PageHeader, Card, CardContent, Button, Input, Textarea, Field, Badge, EmptyState,
  CurrencyInput, Select,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-provider';
import { formatCurrency, cn } from '@/lib/utils';
import { Handshake, Copy, Plus, Trash2, Lock, Unlock } from 'lucide-react';

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
interface DirectoryRep {
  id: string;
  repName: string;
  repCompanyName: string | null;
}

const BLANK_FORM = {
  dealName: '', fundingAmount: '', term: '', rate: '', commission: '', fee: '',
  hasEarlyPayoff: false, earlyPayoffDetails: '', funderName: '', positionNumber: '', notes: '',
};

/** Copy text = ONLY the syndication lines: rep's company + amount. */
function buildCopyText(d: SynDeal): string {
  return d.entries
    .map((e) => `${e.companyName || e.repName} — ${formatCurrency(e.amount)}`)
    .join('\n');
}

export default function SyndicationPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [me, setMe] = useState<{ id?: string; name?: string; role?: string } | undefined>(undefined);
  const isAdmin = me?.role === 'company_admin' || me?.role === 'master_admin';

  const [dealsList, setDealsList] = useState<SynDeal[]>([]);
  const [directory, setDirectory] = useState<DirectoryRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClosed, setShowClosed] = useState(false);
  const [showPost, setShowPost] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [posting, setPosting] = useState(false);
  // Per-deal "my entry" drafts. repId '' = nothing picked; '__new' = typing a
  // new rep + company manually (which saves to the directory on submit).
  const [drafts, setDrafts] = useState<Record<string, { repId: string; newName: string; newCompany: string; amount: string }>>({});

  async function load() {
    try {
      const [sRes, dirRes, meRes] = await Promise.all([
        fetch('/api/syndication', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/syndication/reps', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
        fetch('/api/auth/me', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      ]);
      if (sRes?.data) setDealsList(sRes.data);
      if (dirRes?.data) setDirectory(dirRes.data);
      if (meRes?.user) setMe(meRes.user);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const visible = useMemo(
    () => dealsList.filter((d) => showClosed || d.status === 'open'),
    [dealsList, showClosed]
  );

  function draftFor(dealId: string) {
    return drafts[dealId] ?? { repId: '', newName: '', newCompany: '', amount: '' };
  }
  function setDraft(dealId: string, patch: Partial<{ repId: string; newName: string; newCompany: string; amount: string }>) {
    setDrafts((m) => ({ ...m, [dealId]: { ...draftFor(dealId), ...patch } }));
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
          fundingAmount: form.fundingAmount ? Number(form.fundingAmount) : null,
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
    const d = draftFor(deal.id);
    const isNew = d.repId === '__new';
    const dirRep = directory.find((r) => r.id === d.repId);
    const repName = isNew ? d.newName.trim() : (dirRep?.repName ?? '');
    const companyName = isNew ? d.newCompany.trim() : (dirRep?.repCompanyName ?? '');
    const amount = Number(d.amount);
    if (!repName) { toast.error(isNew ? 'Enter the rep name.' : 'Pick who you are first.'); return; }
    if (!amount || amount <= 0) { toast.error('Enter the amount you want to syndicate.'); return; }
    const res = await fetch(`/api/syndication/${deal.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repName, companyName: companyName || null, amount }),
    });
    const j = await res.json();
    if (!res.ok) { toast.error(j.error || 'Could not add your entry.'); return; }
    toast.success('You’re in.');
    setDraft(deal.id, { amount: '', ...(isNew ? { repId: '', newName: '', newCompany: '' } : {}) });
    load();
  }

  async function removeEntry(entry: Entry) {
    const ok = await confirm({
      title: 'Remove this entry?',
      description: `${entry.repName}${entry.companyName ? ` (${entry.companyName})` : ''} — ${formatCurrency(entry.amount)}`,
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
      description: `"${deal.dealName}" and its ${deal.entries.length} entr${deal.entries.length === 1 ? 'y' : 'ies'} will be removed. Your CRM deals are not affected.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/syndication/${deal.id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Removed from the board.'); load(); }
    else { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Could not remove.'); }
  }

  async function copyDeal(d: SynDeal) {
    if (!d.entries.length) { toast.error('No syndication entries to copy yet.'); return; }
    try {
      await navigator.clipboard.writeText(buildCopyText(d));
      toast.success('Copied — each company and their amount.');
    } catch {
      toast.error('Could not copy to clipboard.');
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Syndication"
        description="Deals open for syndication. Pick your name, put your amount in, done. Copy grabs each company + amount."
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
                <CurrencyInput value={form.fundingAmount} onChange={(v) => setForm({ ...form, fundingAmount: v })} placeholder="150,000" />
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
        <div className="space-y-4">
          {visible.map((d) => {
            const target = Number(d.fundingAmount || 0);
            const pct = target > 0 ? Math.min(100, Math.round((d.committedTotal / target) * 100)) : null;
            const canManage = isAdmin || d.createdBy === me?.id;
            const draft = draftFor(d.id);
            const isNewRep = draft.repId === '__new';
            return (
              <Card key={d.id} className={cn(d.status !== 'open' && 'opacity-70')}>
                <CardContent className="p-4 sm:p-5 space-y-4">
                  {/* Header: name + status + committed + actions */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="text-base font-semibold">{d.dealName}</div>
                    <Badge className={cn(d.status === 'open' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-gray-100 text-gray-600 border-gray-200')}>
                      {d.status === 'open' ? 'Open' : 'Closed'}
                    </Badge>
                    <div className="ml-auto flex items-center gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => copyDeal(d)} title="Copy each company + amount">
                        <Copy className="h-3.5 w-3.5" /> Copy
                      </Button>
                      {canManage && (
                        d.status === 'open'
                          ? <Button size="sm" variant="ghost" onClick={() => setStatus(d, 'closed')} title="Close syndication"><Lock className="h-3.5 w-3.5" /></Button>
                          : <Button size="sm" variant="ghost" onClick={() => setStatus(d, 'open')} title="Reopen"><Unlock className="h-3.5 w-3.5" /></Button>
                      )}
                      {canManage && (
                        <Button size="sm" variant="ghost" onClick={() => removeDeal(d)} title="Remove from board">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* All deal terms — visible up front, no expanding */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-2 rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <TermStat label="Funding" value={d.fundingAmount ? formatCurrency(d.fundingAmount) : null} strong />
                    <TermStat label="Term" value={d.term} />
                    <TermStat label="Rate" value={d.rate} />
                    <TermStat label="Commission" value={d.commission} />
                    <TermStat label="Fee" value={d.fee} />
                    <TermStat label="Funder" value={d.funderName} />
                    <TermStat label="Position" value={d.positionNumber} />
                    <TermStat label="Early payoff" value={d.hasEarlyPayoff ? (d.earlyPayoffDetails || 'Yes') : 'No'} />
                    {pct !== null && <TermStat label="Committed" value={`${formatCurrency(d.committedTotal)} (${pct}%)`} strong />}
                    {pct === null && d.committedTotal > 0 && <TermStat label="Committed" value={formatCurrency(d.committedTotal)} strong />}
                  </div>
                  {d.notes && <p className="text-[13px] text-muted-foreground whitespace-pre-wrap">{d.notes}</p>}

                  {/* Progress bar toward the funding amount */}
                  {pct !== null && (
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  )}

                  {/* Entries */}
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                      Syndication {d.entries.length > 0 && `(${d.entries.length})`}
                    </div>
                    {d.entries.length === 0 ? (
                      <div className="text-[13px] text-muted-foreground">No one has put in yet — be first.</div>
                    ) : (
                      <div className="rounded-lg border border-border overflow-hidden">
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
                  </div>

                  {/* Add my entry — directory-driven */}
                  {d.status === 'open' && (
                    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border px-3 py-2.5">
                      <Field label="I am" className="w-[190px]">
                        <Select
                          className="h-9"
                          value={draft.repId}
                          onChange={(e) => setDraft(d.id, { repId: e.target.value })}
                        >
                          <option value="">Select rep…</option>
                          {directory.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.repName}{r.repCompanyName ? ` — ${r.repCompanyName}` : ''}
                            </option>
                          ))}
                          <option value="__new">+ New rep…</option>
                        </Select>
                      </Field>
                      {isNewRep && (
                        <>
                          <Field label="Rep name" className="flex-1 min-w-[130px]">
                            <Input className="h-9" value={draft.newName} onChange={(e) => setDraft(d.id, { newName: e.target.value })} placeholder="Your name" />
                          </Field>
                          <Field label="Company" className="flex-1 min-w-[130px]">
                            <Input className="h-9" value={draft.newCompany} onChange={(e) => setDraft(d.id, { newCompany: e.target.value })} placeholder="Your company" />
                          </Field>
                        </>
                      )}
                      {!isNewRep && draft.repId && (
                        <div className="pb-2 text-[13px] text-muted-foreground">
                          {directory.find((r) => r.id === draft.repId)?.repCompanyName || 'No company on file'}
                        </div>
                      )}
                      <Field label="Amount" className="w-[150px]">
                        <CurrencyInput className="h-9" value={draft.amount} onChange={(v) => setDraft(d.id, { amount: v })} placeholder="25,000" />
                      </Field>
                      <Button size="sm" onClick={() => addEntry(d)} className="h-9">
                        <Plus className="h-3.5 w-3.5" /> Add me in
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TermStat({ label, value, strong }: { label: string; value: string | null; strong?: boolean }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('text-[13px] truncate', strong ? 'font-semibold tabular-nums' : 'font-medium')} title={value}>{value}</div>
    </div>
  );
}
