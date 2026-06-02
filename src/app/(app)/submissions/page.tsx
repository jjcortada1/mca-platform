'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Card, CardContent,
  Button, Badge, Textarea,
} from '@/components/ui/primitives';
import { formatDate, cn } from '@/lib/utils';
import { Download, Send, PlusCircle } from 'lucide-react';
import { exportCSV } from '@/lib/csv-export';

interface SubmissionFunder {
  id: string;
  funderName: string;
  status: 'no_response' | 'approved' | 'declined';
  notes: string | null;
  submittedAt: string;
}

interface SubmissionRow {
  submissionId: string;
  dealId: string;
  dealName: string;
  dealStatus: string;
  merchantName: string;
  assignedRepId: string | null;
  assignedRepName: string | null;
  createdAt: string;
  updatedAt: string;
  funders: SubmissionFunder[];
}

export default function SubmissionsPage() {
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Record<string, { status: string; notes: string }>>({});
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [funderList, setFunderList] = useState<{ id: string; name: string }[]>([]);
  const [manualForm, setManualForm] = useState({
    dealName: '',
    dealId: '',         // when set, attach to this existing deal instead of name-matching
    funderId: '',
    manualFunderName: '',
    status: 'no_response' as 'no_response' | 'approved' | 'declined',
    notes: '',
  });
  const [manualSaving, setManualSaving] = useState(false);
  // Rep filter: 'all' (default) | 'unassigned' | <user-id>. Lets a manager see
  // only one rep's submissions, or just the ones with no assignee.
  const [repFilter, setRepFilter] = useState<string>('all');
  // Sort: 'recent' (default), 'rep' alphabetical by rep name.
  const [sortBy, setSortBy] = useState<'recent' | 'rep'>('recent');
  // Search across deal name / merchant name / funder names.
  const [search, setSearch] = useState('');

  /** Open the manual-add modal pre-filled for a specific existing deal. */
  function openManualForDeal(dealId: string, dealName: string) {
    setManualForm({
      dealName,
      dealId,
      funderId: '',
      manualFunderName: '',
      status: 'no_response',
      notes: '',
    });
    setShowManualAdd(true);
  }

  async function load() {
    setLoading(true);
    const res = await fetch('/api/submissions');
    const json = await res.json();
    setRows(json.submissions ?? []);
    setLoading(false);
  }

  async function loadFunders() {
    try {
      const res = await fetch('/api/funders');
      const json = await res.json();
      const list = (json.data ?? json.funders ?? []).map((f: { id: string; name: string }) => ({ id: f.id, name: f.name }));
      setFunderList(list);
    } catch {
      // ignore — manual name field still works
    }
  }

  async function deleteSubmission(submissionId: string, dealName: string) {
    if (!confirm(`Delete submission for "${dealName}"? This removes all funder rows for it. The deal itself is NOT deleted.`)) return;
    const res = await fetch(`/api/submissions/${submissionId}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || 'Delete failed.');
      return;
    }
    load();
  }

  async function submitManual() {
    if (!manualForm.dealId && !manualForm.dealName.trim()) { alert('Deal name is required.'); return; }
    if (!manualForm.funderId && !manualForm.manualFunderName.trim()) {
      alert('Pick a funder OR type a funder name.'); return;
    }
    setManualSaving(true);
    try {
      const body: Record<string, unknown> = {
        status: manualForm.status,
      };
      // When attaching to an existing deal, send dealId so the server reuses
      // the deal (and existing submission row); otherwise send dealName.
      if (manualForm.dealId) body.dealId = manualForm.dealId;
      else body.dealName = manualForm.dealName.trim();
      if (manualForm.funderId) body.funderId = manualForm.funderId;
      else body.manualFunderName = manualForm.manualFunderName.trim();
      if (manualForm.notes.trim()) body.notes = manualForm.notes.trim();

      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) { alert(j.error || 'Failed.'); return; }
      setShowManualAdd(false);
      setManualForm({ dealName: '', dealId: '', funderId: '', manualFunderName: '', status: 'no_response', notes: '' });
      load();
    } finally {
      setManualSaving(false);
    }
  }

  useEffect(() => { load(); loadFunders(); }, []);

  // Track per-row notes locally (controlled inputs) — autosaved on blur.
  const [localNotes, setLocalNotes] = useState<Record<string, string>>({});

  async function updateFunder(sfId: string, patch: { status?: string; notes?: string }) {
    await fetch(`/api/submission-funders/${sfId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    load();
  }

  async function saveFunder(sfId: string) {
    const e = editing[sfId];
    if (!e) return;
    await fetch(`/api/submission-funders/${sfId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: e.status, notes: e.notes }),
    });
    setEditing((prev) => {
      const next = { ...prev };
      delete next[sfId];
      return next;
    });
    load();
  }

  async function removeFunder(sfId: string) {
    if (!confirm('Remove this funder from the submission?')) return;
    await fetch(`/api/submission-funders/${sfId}`, { method: 'DELETE' });
    load();
  }

  function startEdit(sf: SubmissionFunder) {
    setEditing((prev) => ({
      ...prev,
      [sf.id]: { status: sf.status, notes: sf.notes ?? '' },
    }));
  }

  // Unique list of reps that appear across the loaded submissions, plus an
  // "Unassigned" slot if any submission has no rep.
  const repOptions = useMemo(() => {
    const m = new Map<string, string>();
    let hasUnassigned = false;
    for (const r of rows) {
      if (!r.assignedRepId) hasUnassigned = true;
      else if (r.assignedRepName) m.set(r.assignedRepId, r.assignedRepName);
    }
    const list = Array.from(m.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { reps: list, hasUnassigned };
  }, [rows]);

  // Apply rep filter, then text search, then sort.
  const filteredRows = useMemo(() => {
    let out = rows;
    if (repFilter === 'unassigned') {
      out = out.filter((r) => !r.assignedRepId);
    } else if (repFilter !== 'all') {
      out = out.filter((r) => r.assignedRepId === repFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((r) =>
        r.dealName.toLowerCase().includes(q) ||
        r.merchantName.toLowerCase().includes(q) ||
        r.funders.some((f) => f.funderName.toLowerCase().includes(q))
      );
    }
    if (sortBy === 'rep') {
      // Group by rep name alpha, then most recent first within each group.
      out = [...out].sort((a, b) => {
        const an = (a.assignedRepName ?? 'zzz_unassigned').toLowerCase();
        const bn = (b.assignedRepName ?? 'zzz_unassigned').toLowerCase();
        if (an !== bn) return an.localeCompare(bn);
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    }
    return out;
  }, [rows, repFilter, sortBy, search]);

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Submissions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track funder responses across all your shopped deals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              // One row per (deal, funder) pair so spreadsheets can pivot/filter easily.
              const flat = rows.flatMap((r) =>
                r.funders.map((f) => ({
                  dealName: r.dealName,
                  merchantName: r.merchantName,
                  dealStatus: r.dealStatus,
                  assignedRepName: r.assignedRepName ?? '',
                  funderName: f.funderName,
                  funderStatus: f.status === 'no_response' ? 'pending' : f.status,
                  submittedAt: f.submittedAt,
                  notes: f.notes ?? '',
                }))
              );
              exportCSV('submissions', flat, [
                { key: 'submittedAt', label: 'Submitted', format: (v) => (v ? new Date(v as string).toISOString().slice(0, 10) : '') },
                { key: 'dealName', label: 'Deal' },
                { key: 'merchantName', label: 'Merchant' },
                { key: 'dealStatus', label: 'Deal Status' },
                { key: 'assignedRepName', label: 'Rep' },
                { key: 'funderName', label: 'Funder' },
                { key: 'funderStatus', label: 'Funder Status' },
                { key: 'notes', label: 'Notes / Offer' },
              ]);
            }}
            disabled={rows.length === 0}
            className="gap-1.5"
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button variant="outline" onClick={() => setShowManualAdd(true)}>+ Add manual</Button>
          <Link href="/deal-shop">
            <Button>Shop a deal</Button>
          </Link>
        </div>
      </header>

      {/* Filters / sort / search row */}
      {rows.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          {/* Rep filter chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setRepFilter('all')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                repFilter === 'all'
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-card text-foreground border-border hover:border-foreground/40'
              }`}
            >
              All reps ({rows.length})
            </button>
            {repOptions.reps.map((r) => {
              const count = rows.filter((row) => row.assignedRepId === r.id).length;
              return (
                <button
                  key={r.id}
                  onClick={() => setRepFilter(r.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    repFilter === r.id
                      ? 'bg-foreground text-background border-foreground'
                      : 'bg-card text-foreground border-border hover:border-foreground/40'
                  }`}
                >
                  {r.name} ({count})
                </button>
              );
            })}
            {repOptions.hasUnassigned && (
              <button
                onClick={() => setRepFilter('unassigned')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                  repFilter === 'unassigned'
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-card text-foreground border-border hover:border-foreground/40'
                }`}
              >
                Unassigned ({rows.filter((r) => !r.assignedRepId).length})
              </button>
            )}
          </div>

          {/* Sort + search on the right */}
          <div className="flex items-center gap-2 sm:ml-auto">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search deal, merchant, funder…"
              className="h-9 w-full sm:w-64 rounded-md border border-input bg-card px-3 text-sm"
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'recent' | 'rep')}
              className="h-9 rounded-md border border-input bg-card px-2 text-sm"
              title="Sort"
            >
              <option value="recent">Most recent</option>
              <option value="rep">By rep</option>
            </select>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : filteredRows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? 'No submissions yet. Shop your first deal to get started.'
              : 'No submissions match the current filters.'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredRows.map((row) => {
            const isOpen = expanded[row.submissionId] ?? false;
            const counts = {
              total: row.funders.length,
              approved: row.funders.filter((f) => f.status === 'approved').length,
              declined: row.funders.filter((f) => f.status === 'declined').length,
              pending: row.funders.filter((f) => f.status === 'no_response').length,
            };
            return (
              <Card key={row.submissionId}>
                <div className="flex items-stretch">
                  <button
                    onClick={() => setExpanded((p) => ({ ...p, [row.submissionId]: !isOpen }))}
                    className="flex-1 text-left px-6 py-4 flex items-center justify-between hover:bg-muted/40 transition"
                  >
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {row.dealName}
                        {/* Assigned rep pill — quickly answers "whose deal is this?"
                            without expanding the row. Falls back to "Unassigned" so
                            stray rows don't slip by unnoticed. */}
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {row.assignedRepName ?? 'Unassigned'}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {row.merchantName && <>{row.merchantName} • </>}
                        Last activity {formatDate(row.updatedAt)} • {counts.total} funder{counts.total === 1 ? '' : 's'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {counts.approved > 0 && <Badge variant="success">{counts.approved} approved</Badge>}
                      {counts.declined > 0 && <Badge variant="destructive">{counts.declined} declined</Badge>}
                      {counts.pending > 0 && <Badge variant="outline">{counts.pending} pending</Badge>}
                    </div>
                  </button>
                  <button
                    onClick={() => deleteSubmission(row.submissionId, row.dealName)}
                    title="Delete submission"
                    className="px-4 text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition border-l border-border"
                  >
                    ✕
                  </button>
                </div>

                {isOpen && (
                  <CardContent className="border-t border-border">
                    <div className="space-y-2 mt-4">
                      {row.funders.map((sf) => {
                        const notesValue = localNotes[sf.id] ?? sf.notes ?? '';
                        return (
                          <div key={sf.id} className="rounded border border-border p-3">
                            <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
                              <div className="min-w-0">
                                <div className="font-medium text-sm">{sf.funderName}</div>
                                <div className="text-xs text-muted-foreground">
                                  Submitted {formatDate(sf.submittedAt)}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <select
                                  value={sf.status}
                                  onChange={(e) => updateFunder(sf.id, { status: e.target.value })}
                                  className={cn(
                                    'rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                                    sf.status === 'approved' && 'bg-emerald-50 border-emerald-300 text-emerald-700',
                                    sf.status === 'declined' && 'bg-rose-50 border-rose-300 text-rose-700',
                                    sf.status === 'no_response' && 'bg-card border-border text-foreground',
                                  )}
                                >
                                  <option value="no_response">Pending</option>
                                  <option value="approved">Approved</option>
                                  <option value="declined">Declined</option>
                                </select>
                                <Button size="sm" variant="ghost" onClick={() => removeFunder(sf.id)}>Remove</Button>
                              </div>
                            </div>
                            <Textarea
                              value={notesValue}
                              onChange={(e) => setLocalNotes((p) => ({ ...p, [sf.id]: e.target.value }))}
                              onBlur={() => {
                                const current = localNotes[sf.id];
                                if (current !== undefined && current !== (sf.notes ?? '')) {
                                  updateFunder(sf.id, { notes: current });
                                }
                              }}
                              placeholder="Offer terms, response details, etc."
                              rows={2}
                              className="text-sm"
                            />
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-4 pt-3 border-t border-border">
                      <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                        Add another funder to this deal
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Link href={`/submit?dealId=${row.dealId}`}>
                          <Button variant="outline" size="sm" className="gap-1.5">
                            <Send className="h-3.5 w-3.5" />
                            Submit to more funders
                          </Button>
                        </Link>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openManualForDeal(row.dealId, row.dealName)}
                          className="gap-1.5"
                        >
                          <PlusCircle className="h-3.5 w-3.5" />
                          Log funder manually
                        </Button>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                        <span className="font-medium">Submit to more</span> sends a real email through your SMTP and tracks the response. <span className="font-medium">Log manually</span> just records a funder you shopped outside the system — no email sent.
                      </p>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {showManualAdd && (
        <div className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowManualAdd(false)}>
          <div className="bg-card rounded-xl shadow-2xl border border-border w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-base font-semibold">Add submission manually</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Record a deal you already submitted (no email is sent).
              </p>
            </div>
            <div className="p-6 space-y-3 text-sm">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Deal name *</span>
                <input
                  type="text"
                  value={manualForm.dealName}
                  onChange={(e) => setManualForm({ ...manualForm, dealName: e.target.value })}
                  placeholder="ABC Plumbing"
                  readOnly={!!manualForm.dealId}
                  className={cn(
                    'mt-1 w-full h-10 px-3 rounded-md border border-input bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring',
                    manualForm.dealId && 'bg-muted/40 cursor-not-allowed'
                  )}
                />
                {manualForm.dealId && (
                  <span className="text-[11px] text-muted-foreground mt-1 block">
                    Logging an outside-system funder against this existing deal.
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Funder (pick one)</span>
                <select
                  value={manualForm.funderId}
                  onChange={(e) => setManualForm({ ...manualForm, funderId: e.target.value })}
                  className="mt-1 w-full h-10 px-3 rounded-md border border-input bg-card text-sm"
                >
                  <option value="">— Type a name below instead —</option>
                  {funderList.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
              {!manualForm.funderId && (
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Or type funder name *</span>
                  <input
                    type="text"
                    value={manualForm.manualFunderName}
                    onChange={(e) => setManualForm({ ...manualForm, manualFunderName: e.target.value })}
                    placeholder="Some Funder Inc."
                    className="mt-1 w-full h-10 px-3 rounded-md border border-input bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              )}
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Status</span>
                <select
                  value={manualForm.status}
                  onChange={(e) => setManualForm({ ...manualForm, status: e.target.value as typeof manualForm.status })}
                  className="mt-1 w-full h-10 px-3 rounded-md border border-input bg-card text-sm"
                >
                  <option value="no_response">No response</option>
                  <option value="approved">Approved</option>
                  <option value="declined">Declined</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Notes (optional)</span>
                <Textarea
                  value={manualForm.notes}
                  onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })}
                  rows={3}
                />
              </label>
            </div>
            <div className="px-6 py-3 border-t border-border flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setShowManualAdd(false)} disabled={manualSaving}>Cancel</Button>
              <Button onClick={submitManual} loading={manualSaving}>Save submission</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
