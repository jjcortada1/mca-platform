'use client';
/**
 * Pending funded-deal approvals — admin queue shown on the Funded Deals page.
 * Each item was auto-created when a rep sent a funded email. The admin can
 * modify any detail (deal, rep, amounts, commission) before approving; on
 * approve the deal is marked funded, the rep assigned, and the commission
 * created — all in one action. Non-admins see nothing.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent, Button, Input, Field, Select, Badge } from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { formatCurrency, cn } from '@/lib/utils';
import { BadgeCheck, ChevronDown, ChevronRight, X } from 'lucide-react';

interface Approval {
  id: string;
  dealId: string | null;
  dealName: string | null;
  repId: string | null;
  repName: string | null;
  fundedAmount: string | null;
  factorRate: string | null;
  termDetails: string | null;
  funderName: string | null;
  grossCommission: string | null;
  repSplitPct: string | null;
  notes: string | null;
  payload: { fields?: Record<string, string>; subject?: string | null } | null;
  status: string;
  createdAt: string;
}

interface RepOpt { id: string; name: string; role: string }

export function FundedApprovalsCard({ onApproved }: { onApproved?: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<Approval[]>([]);
  const [reps, setReps] = useState<RepOpt[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [meRes, aRes, uRes] = await Promise.all([
        fetch('/api/auth/me', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
        fetch('/api/funded-approvals', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/users', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      const role = meRes?.user?.role;
      const admin = role === 'company_admin' || role === 'master_admin';
      setIsAdmin(admin);
      if (admin && aRes) setItems((aRes.data ?? []).filter((a: Approval) => a.status === 'pending'));
      if (uRes) setReps(((uRes.data ?? uRes.users ?? []) as RepOpt[]).filter((u) => u.role === 'rep' || u.role === 'company_admin'));
    } catch { /* card just stays hidden */ }
  }
  useEffect(() => { load(); }, []);

  if (!isAdmin || items.length === 0) return null;

  function open(a: Approval) {
    setOpenId(a.id);
    setDraft({
      dealName: a.dealName ?? '',
      repId: a.repId ?? '',
      fundedAmount: a.fundedAmount ?? '',
      factorRate: a.factorRate ?? '',
      funderName: a.funderName ?? '',
      grossCommission: a.grossCommission ?? '',
      repSplitPct: a.repSplitPct ?? '',
      notes: a.notes ?? '',
    });
  }

  async function review(a: Approval, action: 'approve' | 'reject') {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { action };
      if (action === 'approve') {
        body.dealName = draft.dealName || null;
        body.repId = draft.repId || null;
        body.fundedAmount = draft.fundedAmount ? Number(String(draft.fundedAmount).replace(/[^0-9.]/g, '')) : null;
        body.factorRate = draft.factorRate ? Number(draft.factorRate) : null;
        body.funderName = draft.funderName || null;
        body.grossCommission = draft.grossCommission ? Number(String(draft.grossCommission).replace(/[^0-9.]/g, '')) : null;
        body.repSplitPct = draft.repSplitPct ? Number(draft.repSplitPct) : null;
        body.notes = draft.notes || null;
      }
      const res = await fetch(`/api/funded-approvals/${a.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || 'Could not save.'); return; }
      toast.success(action === 'approve' ? 'Approved — deal logged as funded.' : 'Rejected.');
      setItems((arr) => arr.filter((x) => x.id !== a.id));
      setOpenId(null);
      if (action === 'approve') onApproved?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-amber-300/60 dark:border-amber-500/30">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <BadgeCheck className="h-4 w-4 text-amber-600" />
          <span className="text-sm font-semibold">Funded deals awaiting your approval</span>
          <Badge className="bg-amber-100 text-amber-800 border-amber-200">{items.length}</Badge>
        </div>
        <div className="space-y-2">
          {items.map((a) => {
            const isOpen = openId === a.id;
            const fields = a.payload?.fields ?? {};
            return (
              <div key={a.id} className="rounded-lg border border-border overflow-hidden">
                <button
                  onClick={() => (isOpen ? setOpenId(null) : open(a))}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
                >
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <span className="font-medium text-sm flex-1 min-w-0 truncate">{a.dealName || 'Untitled deal'}</span>
                  {a.repName && <span className="text-xs text-muted-foreground">{a.repName}</span>}
                  {a.fundedAmount && <span className="text-sm tabular-nums font-medium">{formatCurrency(a.fundedAmount)}</span>}
                  <span className="text-[11px] text-muted-foreground">{new Date(a.createdAt).toLocaleDateString()}</span>
                </button>
                {isOpen && (
                  <div className="border-t border-border px-4 py-3 space-y-3 bg-muted/20">
                    {Object.keys(fields).length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">From the funded email: </span>
                        {Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')}
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                      <Field label="Deal name">
                        <Input className="h-9" value={draft.dealName} onChange={(e) => setDraft({ ...draft, dealName: e.target.value })} />
                      </Field>
                      <Field label="Rep">
                        <Select className="h-9" value={draft.repId} onChange={(e) => setDraft({ ...draft, repId: e.target.value })}>
                          <option value="">Unassigned</option>
                          {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </Select>
                      </Field>
                      <Field label="Funded amount">
                        <Input className="h-9" inputMode="decimal" value={draft.fundedAmount} onChange={(e) => setDraft({ ...draft, fundedAmount: e.target.value })} placeholder="$100,000" />
                      </Field>
                      <Field label="Factor rate">
                        <Input className="h-9" inputMode="decimal" value={draft.factorRate} onChange={(e) => setDraft({ ...draft, factorRate: e.target.value })} placeholder="1.45" />
                      </Field>
                      <Field label="Funder">
                        <Input className="h-9" value={draft.funderName} onChange={(e) => setDraft({ ...draft, funderName: e.target.value })} />
                      </Field>
                      <Field label="Gross commission">
                        <Input className="h-9" inputMode="decimal" value={draft.grossCommission} onChange={(e) => setDraft({ ...draft, grossCommission: e.target.value })} placeholder="$10,000" />
                      </Field>
                      <Field label="Rep split %">
                        <Input className="h-9" inputMode="decimal" value={draft.repSplitPct} onChange={(e) => setDraft({ ...draft, repSplitPct: e.target.value })} placeholder="50" />
                      </Field>
                      <Field label="Notes">
                        <Input className="h-9" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
                      </Field>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={() => review(a, 'approve')} disabled={busy}>
                        <BadgeCheck className="h-3.5 w-3.5" /> Approve & log funded
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => review(a, 'reject')} disabled={busy}>
                        <X className="h-3.5 w-3.5" /> Reject
                      </Button>
                      <span className="text-[11px] text-muted-foreground">Approving marks the deal funded, assigns the rep, and creates the commission.</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
