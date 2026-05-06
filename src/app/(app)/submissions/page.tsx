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

  async function load() {
    setLoading(true);
    const res = await fetch('/api/submissions');
    const json = await res.json();
    setRows(json.submissions ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

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
        <Link href="/deal-shop">
          <Button>Shop a deal</Button>
        </Link>
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
                <button
                  onClick={() => setExpanded((p) => ({ ...p, [row.submissionId]: !isOpen }))}
                  className="w-full text-left px-6 py-4 flex items-center justify-between hover:bg-muted/40 transition"
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
    </div>
  );
}
