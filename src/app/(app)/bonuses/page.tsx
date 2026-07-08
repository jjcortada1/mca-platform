'use client';
/**
 * Funder bonuses — which funders are paying extra right now, over what window
 * (or ongoing), and what the conditions are. Everyone can see the board;
 * admins add/edit/remove.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  PageHeader, Card, CardContent, Button, Input, Textarea, Field, Badge, EmptyState, TableSkeleton } from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-provider';
import { cn } from '@/lib/utils';
import { Gift, Plus, Pencil, Trash2 } from 'lucide-react';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import { toDateInput } from '@/lib/dates';

interface Bonus {
  id: string;
  funderName: string;
  bonus: string;
  conditions: string | null;
  startDate: string | null;
  endDate: string | null;
  isRunning: boolean;
  createdAt: string;
}

const BLANK = { funderName: '', bonus: '', conditions: '', startDate: '', endDate: '', isRunning: false };

type BonusState = 'running' | 'active' | 'upcoming' | 'ended';

function bonusState(b: Bonus): BonusState {
  if (b.isRunning) return 'running';
  const now = Date.now();
  const start = b.startDate ? new Date(b.startDate).getTime() : null;
  const end = b.endDate ? new Date(b.endDate).getTime() : null;
  if (start && now < start) return 'upcoming';
  // End of day on the end date so "ends July 31" still counts on the 31st.
  if (end && now > end + 24 * 3600 * 1000) return 'ended';
  return 'active';
}

const STATE_META: Record<BonusState, { label: string; cls: string }> = {
  running:  { label: 'Running',  cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  active:   { label: 'Active',   cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  upcoming: { label: 'Upcoming', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  ended:    { label: 'Ended',    cls: 'bg-gray-100 text-gray-600 border-gray-200' },
};

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

export default function BonusesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Bonus[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showEnded, setShowEnded] = useState(false);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [bRes, meRes] = await Promise.all([
        fetch('/api/bonuses', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/auth/me', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      ]);
      setRows(bRes.data ?? []);
      const role = meRes?.user?.role;
      setIsAdmin(role === 'company_admin' || role === 'master_admin');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // Background sync — bonus updates from admins appear without a reload.
  // Paused while the add/edit form is open.
  useAutoRefresh(() => { load(); }, { enabled: editing === null });

  const visible = useMemo(() => {
    const list = rows.map((b) => ({ b, state: bonusState(b) }));
    // Live first (running/active/upcoming), then ended (only when toggled on).
    const order: Record<BonusState, number> = { running: 0, active: 0, upcoming: 1, ended: 2 };
    return list
      .filter(({ state }) => showEnded || state !== 'ended')
      .sort((x, y) => order[x.state] - order[y.state] || x.b.funderName.localeCompare(y.b.funderName));
  }, [rows, showEnded]);

  function startEdit(b: Bonus | null) {
    if (!b) {
      setEditing('new');
      setForm({ ...BLANK });
      return;
    }
    setEditing(b.id);
    setForm({
      funderName: b.funderName,
      bonus: b.bonus,
      conditions: b.conditions ?? '',
      startDate: b.startDate ? toDateInput(b.startDate) : '',
      endDate: b.endDate ? toDateInput(b.endDate) : '',
      isRunning: b.isRunning,
    });
  }

  async function save() {
    if (!form.funderName.trim()) { toast.error('Funder name is required.'); return; }
    if (!form.bonus.trim()) { toast.error('Describe the bonus.'); return; }
    setSaving(true);
    try {
      const payload = {
        funderName: form.funderName,
        bonus: form.bonus,
        conditions: form.conditions || null,
        isRunning: form.isRunning,
        startDate: form.isRunning ? null : form.startDate || null,
        endDate: form.isRunning ? null : form.endDate || null,
      };
      const res = editing === 'new'
        ? await fetch('/api/bonuses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch(`/api/bonuses/${editing}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || 'Could not save.'); return; }
      toast.success('Bonus saved.');
      setEditing(null);
      setForm({ ...BLANK });
      load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(b: Bonus) {
    const ok = await confirm({
      title: 'Remove this bonus?',
      description: `${b.funderName} — ${b.bonus.slice(0, 80)}`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/bonuses/${b.id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Bonus removed.'); load(); }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bonuses"
        description="Which funders are paying bonuses right now, the window they run for, and the conditions to qualify."
        actions={isAdmin ? (
          <Button onClick={() => startEdit(null)}><Plus className="h-4 w-4" /> Add bonus</Button>
        ) : undefined}
      />

      {editing !== null && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="text-sm font-semibold">{editing === 'new' ? 'Add a bonus' : 'Edit bonus'}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Funder" required>
                <Input value={form.funderName} onChange={(e) => setForm({ ...form, funderName: e.target.value })} placeholder="Funder name" />
              </Field>
              <Field label="Schedule">
                <label className="flex items-center gap-2 h-10 cursor-pointer">
                  <input type="checkbox" className="h-4 w-4" checked={form.isRunning} onChange={(e) => setForm({ ...form, isRunning: e.target.checked })} />
                  <span className="text-sm">{form.isRunning ? 'Running bonus (no end date)' : 'Fixed window (set dates below)'}</span>
                </label>
              </Field>
              {!form.isRunning && (
                <>
                  <Field label="Start date">
                    <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                  </Field>
                  <Field label="End date">
                    <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                  </Field>
                </>
              )}
            </div>
            <Field label="The bonus" required>
              <Input value={form.bonus} onChange={(e) => setForm({ ...form, bonus: e.target.value })} placeholder="e.g. Extra 2 points on all deals over $100K" />
            </Field>
            <Field label="Conditions">
              <Textarea rows={2} value={form.conditions} onChange={(e) => setForm({ ...form, conditions: e.target.value })} placeholder="What it takes to qualify — minimum volume, deal size, first-position only, etc." />
            </Field>
            <div className="flex items-center gap-2">
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save bonus'}</Button>
              <Button variant="ghost" onClick={() => { setEditing(null); setForm({ ...BLANK }); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input type="checkbox" className="h-4 w-4" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} />
          Show ended bonuses
        </label>
      </div>

      {loading ? (
        <TableSkeleton />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Gift}
          title="No bonuses posted"
          description={isAdmin ? 'Add a funder bonus so the team knows where the extra money is.' : 'When funders run bonuses, they’ll show up here.'}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {visible.map(({ b, state }) => {
            const meta = STATE_META[state];
            return (
              <Card key={b.id} className={cn(state === 'ended' && 'opacity-60')}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="font-semibold text-[15px] leading-tight">{b.funderName}</div>
                    <Badge className={meta.cls}>{meta.label}</Badge>
                  </div>
                  <div className="text-sm font-medium text-emerald-700 dark:text-emerald-400 mb-1.5">{b.bonus}</div>
                  {b.conditions && (
                    <p className="text-[13px] text-muted-foreground leading-snug whitespace-pre-wrap mb-2">{b.conditions}</p>
                  )}
                  <div className="flex items-center justify-between mt-2">
                    <div className="text-[11px] text-muted-foreground">
                      {b.isRunning
                        ? 'Ongoing — no end date'
                        : [fmtDate(b.startDate), fmtDate(b.endDate)].filter(Boolean).join(' → ') || 'No dates set'}
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => startEdit(b)} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground" title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => remove(b)} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-rose-500" title="Remove">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
