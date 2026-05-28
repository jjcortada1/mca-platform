'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card, CardContent,
  Button, Badge, Textarea,
} from '@/components/ui/primitives';
import { formatDate } from '@/lib/utils';

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
    funderId: '',
    manualFunderName: '',
    status: 'no_response' as 'no_response' | 'approved' | 'declined',
    notes: '',
  });
  const [manualSaving, setManualSaving] = useState(false);

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
    if (!manualForm.dealName.trim()) { alert('Deal name is required.'); return; }
    if (!manualForm.funderId && !manualForm.manualFunderName.trim()) {
      alert('Pick a funder OR type a funder name.'); return;
    }
    setManualSaving(true);
    try {
      const body: Record<string, unknown> = {
        dealName: manualForm.dealName.trim(),
        status: manualForm.status,
      };
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
      setManualForm({ dealName: '', funderId: '', manualFunderName: '', status: 'no_response', notes: '' });
      load();
    } finally {
      setManualSaving(false);
    }
  }

  useEffect(() => { load(); loadFunders(); }, []);

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
          <Button variant="outline" onClick={() => setShowManualAdd(true)}>+ Add manual</Button>
          <Link href="/deal-shop">
            <Button>Shop a deal</Button>
          </Link>
        </div>
      </header>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No submissions yet. Shop your first deal to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
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
                      <div className="font-medium">{row.dealName}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
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
                        const ed = editing[sf.id];
                        return (
                          <div key={sf.id} className="rounded border border-border p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <div className="font-medium text-sm">{sf.funderName}</div>
                                <div className="text-xs text-muted-foreground">
                                  Submitted {formatDate(sf.submittedAt)}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {ed ? (
                                  <>
                                    <select
                                      value={ed.status}
                                      onChange={(e) =>
                                        setEditing((p) => ({ ...p, [sf.id]: { ...ed, status: e.target.value } }))
                                      }
                                      className="rounded border border-input bg-background px-2 py-1 text-xs"
                                    >
                                      <option value="no_response">No response</option>
                                      <option value="approved">Approved</option>
                                      <option value="declined">Declined</option>
                                    </select>
                                    <Button size="sm" onClick={() => saveFunder(sf.id)}>Save</Button>
                                  </>
                                ) : (
                                  <>
                                    <Badge
                                      variant={
                                        sf.status === 'approved' ? 'success' :
                                        sf.status === 'declined' ? 'destructive' : 'outline'
                                      }
                                    >
                                      {sf.status === 'no_response' ? 'pending' : sf.status}
                                    </Badge>
                                    <Button size="sm" variant="outline" onClick={() => startEdit(sf)}>Edit</Button>
                                    <Button size="sm" variant="ghost" onClick={() => removeFunder(sf.id)}>Remove</Button>
                                  </>
                                )}
                              </div>
                            </div>
                            {ed ? (
                              <Textarea
                                value={ed.notes}
                                onChange={(e) =>
                                  setEditing((p) => ({ ...p, [sf.id]: { ...ed, notes: e.target.value } }))
                                }
                                placeholder="Notes (offer terms, response details, etc.)"
                                rows={2}
                              />
                            ) : sf.notes ? (
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{sf.notes}</p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-4 flex gap-2">
                      <Link href={`/deal-shop/submit?dealId=${row.dealId}`}>
                        <Button variant="outline" size="sm">Add more funders</Button>
                      </Link>
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
                  className="mt-1 w-full h-10 px-3 rounded-md border border-input bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
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
