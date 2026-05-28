'use client';

import { useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';

interface PortalData {
  leadSourceName: string;
  totals: { total: number; paid: number; pending: number; owed: number; clawedBack: number };
  history: { amountOwed: number; amountPaid: number; status: string; updatedAt: string }[];
}

const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const STATUS_LABEL: Record<string, string> = { pending: 'Pending', cleared: 'Paid/Cleared', clawed_back: 'Reversed' };

export default function LeadSourcePortalPage() {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/lead-source-portal')
      .then(async (r) => {
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Unable to load'); }
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="bg-card border-b border-border">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="font-semibold">{data?.leadSourceName ?? 'Partner Portal'}</div>
          <button onClick={() => signOut({ callbackUrl: '/login' })} className="text-sm text-muted-foreground hover:text-foreground">
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
        ) : data ? (
          <>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Your commissions</h1>
              <p className="text-sm text-muted-foreground mt-1">A summary of what you&apos;re owed and what&apos;s been paid.</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Total earned" value={fmt(data.totals.total)} />
              <Stat label="Paid to you" value={fmt(data.totals.paid)} tone="success" />
              <Stat label="Pending" value={fmt(data.totals.pending)} tone="warning" />
              <Stat label="Still owed" value={fmt(data.totals.owed)} />
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border font-medium text-sm">Payment history</div>
              {data.history.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">No commission records yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-5 py-2">Date</th>
                      <th className="px-5 py-2 text-right">Owed</th>
                      <th className="px-5 py-2 text-right">Paid</th>
                      <th className="px-5 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {data.history.map((h, i) => (
                      <tr key={i}>
                        <td className="px-5 py-2.5 text-muted-foreground">{new Date(h.updatedAt).toLocaleDateString()}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{fmt(h.amountOwed)}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-emerald-700">{fmt(h.amountPaid)}</td>
                        <td className="px-5 py-2.5">{STATUS_LABEL[h.status] ?? h.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              This view shows only your commission totals and payment status. For questions about a specific payment, contact your account manager.
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warning' }) {
  const color = tone === 'success' ? 'text-emerald-700' : tone === 'warning' ? 'text-amber-700' : 'text-foreground';
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`text-lg font-semibold tabular-nums mt-1 ${color}`}>{value}</div>
    </div>
  );
}
