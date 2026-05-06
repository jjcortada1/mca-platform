'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Card, CardHeader, CardTitle, CardContent, CardDescription,
  Button, Input, Field,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { formatCurrency, formatDate } from '@/lib/utils';

interface FundedEntry {
  id: string;
  repId: string;
  repName: string;
  dealInitials: string;
  amountFunded: string;
  fundedDate: string;
  notes: string | null;
  createdAt: string;
}

export default function FundedBoardPage() {
  const toast = useToast();
  const [entries, setEntries] = useState<FundedEntry[]>([]);
  const [reps, setReps] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // New entry form
  const [showForm, setShowForm] = useState(false);
  const [newEntry, setNewEntry] = useState({
    repId: '',
    dealInitials: '',
    amountFunded: '',
    fundedDate: new Date().toISOString().slice(0, 10),
    notes: '',
  });

  async function load() {
    setLoading(true);
    const [eRes, uRes] = await Promise.all([
      fetch('/api/funded-entries').then((r) => r.json()),
      fetch('/api/users').then((r) => r.json()).catch(() => ({ data: [] })),
    ]);
    setEntries(eRes.data ?? []);
    setReps((uRes.data ?? []).filter((u: { role: string }) => u.role !== 'master_admin'));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function saveEntry() {
    if (!newEntry.repId || !newEntry.dealInitials || !newEntry.amountFunded) {
      toast.error('Rep, deal initials, and amount are required.');
      return;
    }
    const res = await fetch('/api/funded-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newEntry),
    });
    if (!res.ok) {
      const j = await res.json();
      toast.error(j.error || 'Save failed.');
      return;
    }
    toast.success('Funded entry logged.');
    setShowForm(false);
    setNewEntry({
      repId: '', dealInitials: '', amountFunded: '',
      fundedDate: new Date().toISOString().slice(0, 10), notes: '',
    });
    load();
  }

  async function delEntry(id: string) {
    if (!confirm('Delete this entry?')) return;
    await fetch(`/api/funded-entries/${id}`, { method: 'DELETE' });
    load();
  }

  // MTD calculations
  const mtdData = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const mtd = entries.filter((e) => new Date(e.fundedDate) >= monthStart);

    const byRep = new Map<string, { name: string; total: number; count: number }>();
    for (const e of mtd) {
      const existing = byRep.get(e.repId) ?? { name: e.repName, total: 0, count: 0 };
      existing.total += parseFloat(e.amountFunded);
      existing.count += 1;
      byRep.set(e.repId, existing);
    }
    const total = mtd.reduce((s, e) => s + parseFloat(e.amountFunded), 0);
    return { total, count: mtd.length, byRep: Array.from(byRep.values()).sort((a, b) => b.total - a.total) };
  }, [entries]);

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Funded Board</h1>
          <p className="text-sm text-muted-foreground mt-1">Track funded deals and rep performance.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add entry'}
        </Button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">MTD Total</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-semibold tabular-nums">{formatCurrency(mtdData.total)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">MTD Deals</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-semibold tabular-nums">{mtdData.count}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Top Rep MTD</CardTitle></CardHeader>
          <CardContent>
            {mtdData.byRep[0] ? (
              <>
                <div className="text-lg font-semibold">{mtdData.byRep[0].name}</div>
                <div className="text-sm text-muted-foreground tabular-nums">{formatCurrency(mtdData.byRep[0].total)}</div>
              </>
            ) : <div className="text-sm text-muted-foreground">No entries yet</div>}
          </CardContent>
        </Card>
      </div>

      {mtdData.byRep.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>MTD by rep</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {mtdData.byRep.map((r) => (
                <div key={r.name} className="flex justify-between items-center py-1 border-b border-border last:border-0">
                  <span className="font-medium">{r.name}</span>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">{r.count} deal{r.count === 1 ? '' : 's'}</span>
                    <span className="tabular-nums font-medium">{formatCurrency(r.total)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>New funded entry</CardTitle>
            <CardDescription>Use deal initials to keep merchant info private.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Field label="Rep" required>
              <select
                value={newEntry.repId}
                onChange={(e) => setNewEntry({ ...newEntry, repId: e.target.value })}
                className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">— select —</option>
                {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Deal initials" required>
              <Input
                placeholder="e.g. ACME"
                value={newEntry.dealInitials}
                onChange={(e) => setNewEntry({ ...newEntry, dealInitials: e.target.value })}
              />
            </Field>
            <Field label="Amount funded" required>
              <Input
                type="number"
                step="0.01"
                placeholder="50000"
                value={newEntry.amountFunded}
                onChange={(e) => setNewEntry({ ...newEntry, amountFunded: e.target.value })}
              />
            </Field>
            <Field label="Funded date">
              <Input
                type="date"
                value={newEntry.fundedDate}
                onChange={(e) => setNewEntry({ ...newEntry, fundedDate: e.target.value })}
              />
            </Field>
            <div className="col-span-2">
              <Field label="Notes">
                <Input
                  value={newEntry.notes}
                  onChange={(e) => setNewEntry({ ...newEntry, notes: e.target.value })}
                />
              </Field>
            </div>
            <div className="col-span-2 flex justify-end">
              <Button onClick={saveEntry}>Save entry</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>All entries</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">No entries yet.</div>
          ) : (
            <table className="data-grid w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Rep</th>
                  <th className="px-4 py-2 font-medium">Deal</th>
                  <th className="px-4 py-2 font-medium text-right">Amount</th>
                  <th className="px-4 py-2 font-medium">Notes</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-border hover:bg-muted/30">
                    <td className="px-4 py-3">{formatDate(e.fundedDate)}</td>
                    <td className="px-4 py-3">{e.repName}</td>
                    <td className="px-4 py-3 font-medium">{e.dealInitials}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(parseFloat(e.amountFunded))}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{e.notes ?? ''}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => delEntry(e.id)} className="text-xs text-muted-foreground hover:text-destructive">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
