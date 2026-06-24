'use client';

import { useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';
import { formatCalendarDate } from '@/lib/dates';

interface CommissionRow {
  id: string;
  amountOwed: number;
  amountPaid: number;
  status: string;
  clawedBack: boolean;
  fundingDate: string | null;
  earlyPayoffDiscount: string | null;
  notes: string | null;
  updatedAt: string;
}
interface PaymentRow {
  amount: number;
  paidDate: string;
  method: string | null;
}
interface PortalData {
  leadSourceName: string;
  /**
   * Per-status rollup for this lead source.
   *  • available = cleared but not yet paid out (i.e. what's drawable
   *    right now). Highlighted on the dashboard because it's the
   *    headline number the lead source actually cares about.
   */
  totals: { total: number; paid: number; pending: number; owed: number; available: number; clawedBack: number };
  history: CommissionRow[];
  payments: PaymentRow[];
}

const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
// formatCalendarDate parses the date in UTC and renders in UTC so the
// displayed day matches what was typed in — no timezone day-shift.
const fmtDate = (s: string | null | undefined) => formatCalendarDate(s);
const STATUS_LABEL: Record<string, string> = { pending: 'Pending', cleared: 'Paid/Cleared', clawed_back: 'Clawed back' };

export default function LeadSourcePortalPage() {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

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

            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
              <Stat label="Total earned" value={fmt(data.totals.total)} />
              <Stat label="Paid to you" value={fmt(data.totals.paid)} tone="success" />
              <Stat label="Pending" value={fmt(data.totals.pending)} tone="warning" />
              {/* Available — cleared but not yet paid out. Highlighted as
                  success since this is the actionable balance the lead
                  source can expect on the next disbursement cycle. */}
              <Stat label="Available" value={fmt(data.totals.available)} tone="success" />
              <Stat label="Still owed" value={fmt(data.totals.owed)} />
              <Stat label="Clawed back" value={fmt(data.totals.clawedBack)} tone="danger" />
            </div>

            {/* Per-deal summary (no deal name shown) */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border font-medium text-sm">Commission breakdown</div>
              {data.history.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">No commission records yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-5 py-2">Funded</th>
                      <th className="px-5 py-2 text-right">Owed</th>
                      <th className="px-5 py-2 text-right">Paid</th>
                      <th className="px-5 py-2">Status</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {data.history.map((h) => (
                      <>
                        <tr
                          key={h.id}
                          className={`cursor-pointer hover:bg-muted/20 ${h.clawedBack ? 'bg-rose-50/40' : ''}`}
                          onClick={() => setExpanded(expanded === h.id ? null : h.id)}
                        >
                          <td className="px-5 py-2.5 text-muted-foreground tabular-nums">{fmtDate(h.fundingDate)}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums">{fmt(h.amountOwed)}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums text-emerald-700">{fmt(h.amountPaid)}</td>
                          <td className="px-5 py-2.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${h.clawedBack ? 'bg-rose-100 text-rose-800' : h.status === 'cleared' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                              {STATUS_LABEL[h.status] ?? h.status}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground text-xs">{expanded === h.id ? '▲' : '▼'}</td>
                        </tr>
                        {expanded === h.id && (
                          <tr className="bg-muted/10">
                            <td colSpan={5} className="px-5 py-3">
                              <div className="grid sm:grid-cols-2 gap-3 text-xs">
                                <Field label="Funded date" value={fmtDate(h.fundingDate)} />
                                <Field label="Early payoff discount" value={h.earlyPayoffDiscount || '—'} />
                                <Field label="Status" value={STATUS_LABEL[h.status] ?? h.status} />
                                <Field label="Last update" value={fmtDate(h.updatedAt)} />
                                <div className="sm:col-span-2">
                                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Notes</div>
                                  <div className="mt-0.5 whitespace-pre-wrap">{h.notes || <span className="text-muted-foreground italic">None</span>}</div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Logged payments — amount/date/method only */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border font-medium text-sm">Payments to you</div>
              {data.payments.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">No payments logged yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-5 py-2">Date</th>
                      <th className="px-5 py-2 text-right">Amount</th>
                      <th className="px-5 py-2">Method</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {data.payments.map((p, i) => (
                      <tr key={i}>
                        <td className="px-5 py-2.5 text-muted-foreground tabular-nums">{fmtDate(p.paidDate)}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-emerald-700">{fmt(p.amount)}</td>
                        <td className="px-5 py-2.5 uppercase text-xs">{p.method ?? '—'}</td>
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warning' | 'danger' }) {
  const color = tone === 'success' ? 'text-emerald-700' : tone === 'warning' ? 'text-amber-700' : tone === 'danger' ? 'text-rose-700' : 'text-foreground';
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`text-lg font-semibold tabular-nums mt-1 ${color}`}>{value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
