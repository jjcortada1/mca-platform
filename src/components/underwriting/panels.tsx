'use client';

import { useMemo, useState } from 'react';
import { Button, Input, Select, Badge } from '@/components/ui/primitives';
import {
  Search, RotateCcw, CheckCircle2, XCircle, AlertTriangle, Info, FileText,
  ChevronRight, TrendingUp, TrendingDown, Minus, Banknote, ArrowLeftRight, Plus,
} from 'lucide-react';
import type {
  UnderwritingFile, UwTransaction, TxnClass, MonthRow, UwPosition,
} from '@/lib/underwriting/workstation';
import { TXN_CLASS_LABEL, POSITION_STATUS_LABEL, REVIEW_LABEL, MANUAL_CLASSES } from '@/lib/underwriting/workstation';
import type { ReviewStatus, TransferAccount } from '@/lib/underwriting/workstation';
import { CADENCE_LABEL } from '@/lib/underwriting/engine';
import {
  Metric, Section, ConfidenceChip, SeverityChip, ClassChip, DataTable, Th, Td,
  money, percent, shortDate, longDate, TONE_TEXT,
} from './shared';
import type { DrillDown, Tone } from './shared';

export interface PanelProps {
  file: UnderwritingFile;
  onDrill: (d: DrillDown) => void;
  onOverride: (keys: string[], cls: TxnClass) => void;
  onResetOverride: (keys: string[]) => void;
  /** Confirm / reject a detected MCA, or clear the decision. */
  onPositionDecision: (id: string, status: ReviewStatus | null) => void;
  /** Confirm / reject a suspected transfer account. */
  onTransferDecision: (id: string, status: ReviewStatus | null) => void;
  /** Open the "mark as MCA" dialog for these transactions. */
  onMarkMca: (txnKeys: string[], merchantKey: string | null, suggestedName: string) => void;
}

const byKey = (file: UnderwritingFile) => new Map(file.transactions.map((t) => [t.key, t]));
const pick = (file: UnderwritingFile, keys: string[]) => {
  const m = byKey(file);
  return keys.map((k) => m.get(k)).filter(Boolean) as UwTransaction[];
};

/* ══════════════════════════ OVERVIEW ══════════════════════════ */

/**
 * The snapshot.
 *
 * Deliberately short. A broker opening a file wants one question answered
 * first — WHO IS THIS MERCHANT ALREADY PAYING, AND HOW MUCH — so current
 * MCA positions are the headline, not a metric card among many. Everything
 * else is four numbers and the risk list; the depth lives behind the tabs.
 */
export function OverviewPanel({ file, onDrill, onOverride, onResetOverride, onPositionDecision }: PanelProps) {
  const withholdTone: Tone = file.withhold.pct > 0.3 ? 'bad' : file.withhold.pct > 0.2 ? 'warn' : 'good';
  const nsfTotal = file.nsfCount + file.returnedCount;
  const mcaTxns = file.transactions.filter((t) => t.cls === 'mca_payment');
  const positions = file.currentPositions;

  return (
    <div className="space-y-4">
      {/* ── HEADLINE: what they're already paying ── */}
      <section className="border border-border bg-card rounded-md overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <div className="flex items-baseline gap-3">
            <h2 className="text-[15px] font-semibold tracking-tight">Current MCA positions</h2>
            <span className={`text-[26px] font-semibold tabular-nums leading-none ${positions.length >= 3 ? TONE_TEXT.bad : positions.length ? TONE_TEXT.warn : TONE_TEXT.good}`}>
              {positions.length}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-right">
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">Paying per month</div>
              <div className="text-[17px] font-semibold tabular-nums">{money(file.mcaMonthlyPayments)}</div>
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">Per week</div>
              <div className="text-[17px] font-semibold tabular-nums">{money(file.mcaWeeklyPayments)}</div>
            </div>
            <button
              type="button"
              onClick={() => onDrill({
                title: 'MCA withhold %',
                derivation: [
                  ...file.withhold.positions.map((p) => ({ label: p.name, value: `${money(p.monthly)}/mo`, muted: true })),
                  { label: 'Total MCA payments', value: `${money(file.withhold.totalMonthly)}/mo` },
                  { label: 'True revenue', value: `${money(file.withhold.trueRevenueMonthly)}/mo` },
                  { label: `${money(file.withhold.totalMonthly)} ÷ ${money(file.withhold.trueRevenueMonthly)}`, value: percent(file.withhold.pct) },
                ],
                explanation: 'Payments to advances still being debited, divided by true revenue. Stopped positions are excluded — they are not a live burden.',
                transactions: mcaTxns.slice(0, 60),
              })}
              className="text-left hover:opacity-80"
            >
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">Of revenue</div>
              <div className={`text-[17px] font-semibold tabular-nums ${TONE_TEXT[withholdTone]}`}>{percent(file.withhold.pct)}</div>
            </button>
          </div>
        </header>

        {positions.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <div className="text-[14px] font-semibold text-emerald-600 dark:text-emerald-400">No active advances</div>
            <p className="text-[12.5px] text-muted-foreground mt-1">
              Nothing in these statements repeats on the fixed daily or weekly schedule an advance debits on.
            </p>
          </div>
        ) : (
          <DataTable
            minWidth={860}
            head={
              <>
                <Th>Funder</Th>
                <Th align="right">Payment</Th>
                <Th>Frequency</Th>
                <Th align="right">Weekly</Th>
                <Th align="right">Monthly</Th>
                <Th align="right">% of revenue</Th>
                <Th>Funding deposit</Th>
                <Th align="right">Review</Th>
              </>
            }
          >
            {positions.map((p) => (
              <tr
                key={p.id}
                className="border-b border-border/60 hover:bg-muted/40 cursor-pointer"
                onClick={() => onDrill({
                  title: `${p.funderName} — payments`,
                  derivation: [
                    { label: 'Payment', value: `${money(p.paymentAmount, 2)} ${CADENCE_LABEL[p.cadence].toLowerCase()}` },
                    { label: 'Estimated weekly', value: money(p.weeklyEquivalent) },
                    { label: 'Estimated monthly', value: money(p.monthlyEquivalent) },
                    { label: 'First seen', value: longDate(p.firstDate), muted: true },
                    { label: 'Last seen', value: longDate(p.lastDate), muted: true },
                    { label: 'Payments observed', value: String(p.paymentCount), muted: true },
                    { label: 'Estimated original advance', value: p.estimatedFunding ? money(p.estimatedFunding) : 'Not solvable', muted: true },
                    { label: 'Estimated balance remaining', value: p.estimatedRemaining !== null ? money(p.estimatedRemaining) : 'Started before these statements', muted: true },
                  ],
                  explanation: p.confidenceReasons.join('. '),
                  transactions: pick(file, p.txnKeys),
                })}
              >
                <Td>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[13px]">{p.funderName}</span>
                    {p.presentThroughout && <Badge variant="destructive">All {p.monthsInPeriod} months</Badge>}
                    {p.paymentChanged && <Badge variant="warning">Payment changed</Badge>}
                    {!p.identified && <Badge variant="outline">Name not recognized</Badge>}
                  </div>
                </Td>
                <Td align="right" tabular className="font-semibold">{money(p.paymentAmount, 2)}</Td>
                <Td className="text-muted-foreground">{CADENCE_LABEL[p.cadence]}</Td>
                <Td align="right" tabular>{money(p.weeklyEquivalent)}</Td>
                <Td align="right" tabular className="font-medium">{money(p.monthlyEquivalent)}</Td>
                <Td align="right" tabular className={p.withholdPct > 0.15 ? TONE_TEXT.warn : ''}>{percent(p.withholdPct)}</Td>
                <Td className="whitespace-nowrap text-[11.5px]">
                  {p.fundingDetected
                    ? <span className={TONE_TEXT.good}>Detected: {money(p.fundingAmount)} on {longDate(p.fundingDate ?? '')}</span>
                    : <span className="text-muted-foreground">Funding deposit not detected</span>}
                </Td>
                <Td align="right"><ReviewControls p={p} onDecision={onPositionDecision} /></Td>
              </tr>
            ))}
          </DataTable>
        )}

        {(file.historicalPositions.length > 0 || file.fundingEvents.length > 0) && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-2 border-t border-border text-[11.5px] text-muted-foreground">
            {file.historicalPositions.length > 0 && (
              <span>
                {file.historicalPositions.length} position{file.historicalPositions.length === 1 ? '' : 's'} stopped or paid off —
                <span className="font-medium text-foreground"> see MCA Positions</span>
              </span>
            )}
            {file.fundingEvents.length > 0 && (
              <span>
                {file.fundingEvents.length} funding deposit{file.fundingEvents.length === 1 ? '' : 's'} received during the period
              </span>
            )}
          </div>
        )}
      </section>

      {/* ── MCA + transfer headline numbers ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Metric
          label="Current MCAs"
          value={String(file.currentPositions.length)}
          note={`${file.positions.filter((p) => p.review === 'confirmed').length} confirmed`}
          tone={file.currentPositions.length >= 3 ? 'bad' : file.currentPositions.length ? 'warn' : 'good'}
        />
        <Metric
          label="MCA funding detected"
          value={money(file.mcaFundingDetected)}
          note={`${file.fundingEvents.length} deposit${file.fundingEvents.length === 1 ? '' : 's'}`}
          onClick={() => onDrill({
            title: 'MCA funding detected',
            derivation: file.fundingEvents.map((f) => ({
              label: `${f.funderName ?? 'Unnamed'} — ${longDate(f.date)}`, value: money(f.amount),
            })),
            explanation: 'Deposits that look like advance proceeds. Excluded from true revenue — borrowed money is not sales.',
            transactions: pick(file, file.fundingEvents.map((f) => f.txnKey)),
          })}
        />
        <Metric label="MCA withhold" value={percent(file.withhold.pct)} tone={withholdTone} />
        <Metric
          label="Transfer accounts"
          value={String(file.transferAccounts.length)}
          note={file.matchedTransfers.length ? `${file.matchedTransfers.length} matched pair${file.matchedTransfers.length === 1 ? '' : 's'}` : undefined}
        />
        <Metric label="Transfers in" value={money(file.internalTransfersIn)} />
        <Metric label="Transfers out" value={money(file.internalTransfersOut)} />
      </div>

      {/* ── The four numbers that decide the rest ── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="True revenue / month"
          value={money(file.trueRevenueMonthly)}
          note={`${money(file.grossRevenueMonthly)} gross before exclusions`}
          emphasis
          onClick={() => onDrill({
            title: 'True revenue',
            derivation: [
              { label: 'Gross deposits', value: money(file.revenueBridge.gross) },
              ...file.revenueBridge.exclusions.map((e) => ({ label: `Less: ${e.label} (${e.count})`, value: `−${money(e.amount)}`, muted: true })),
              { label: 'True revenue', value: money(file.revenueBridge.trueRevenue) },
            ],
            explanation: 'Only deposits that look like operating sales. Transfers between the merchant’s own accounts, advance proceeds, loan draws, refunds and reversals are excluded — adjust any of it on the Revenue Review tab.',
          })}
        />
        <Metric
          label="Avg daily balance"
          value={money(file.avgDailyBalance)}
          note={file.lowestBalance !== null ? `Low ${money(file.lowestBalance)}` : undefined}
          tone={file.avgDailyBalance !== null && file.avgDailyBalance < 1000 ? 'warn' : 'neutral'}
          emphasis
        />
        <Metric
          label="Negative days"
          value={String(file.negativeDays.totalNegativeDays)}
          note={file.negativeDays.longestRun ? `Longest run ${file.negativeDays.longestRun} days` : 'None'}
          tone={file.negativeDays.totalNegativeDays > 5 ? 'bad' : file.negativeDays.totalNegativeDays > 2 ? 'warn' : 'good'}
          emphasis
          onClick={() => onDrill({
            title: 'Negative days',
            derivation: [
              { label: 'Total negative days', value: String(file.negativeDays.totalNegativeDays) },
              { label: 'Longest consecutive run', value: `${file.negativeDays.longestRun} day(s)` },
              { label: 'Lowest balance', value: money(file.negativeDays.lowestBalance) },
            ],
            explanation: 'Counted from daily ENDING balances — a day is negative if the account closed below zero.',
          })}
        />
        <Metric
          label="NSF / returned"
          value={String(nsfTotal)}
          note={`${file.overdraftCount} overdraft fee${file.overdraftCount === 1 ? '' : 's'}`}
          tone={nsfTotal > 5 ? 'bad' : nsfTotal > 2 ? 'warn' : 'good'}
          emphasis
          onClick={() => onDrill({
            title: 'NSF / returned items',
            derivation: [
              { label: 'NSF items', value: String(file.nsfCount) },
              { label: 'Returned items', value: String(file.returnedCount) },
              { label: 'Overdraft fees', value: String(file.overdraftCount) },
            ],
            explanation: 'Counted once per event per day — a returned item and its fee on the same day is one bounce, not two.',
            transactions: file.transactions.filter((t) => t.bankEventKind !== null),
          })}
        />
      </div>

      {/* ── Anything that should stop the deal ── */}
      {file.riskFlags.length > 0 && (
        <Section title="What to look at" subtitle="Click any line for the transactions behind it" dense>
          <ul className="divide-y divide-border">
            {file.riskFlags.slice(0, 5).map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => onDrill({ title: f.title, explanation: f.explanation, transactions: pick(file, f.txnKeys) })}
                  className="w-full text-left px-4 py-2.5 hover:bg-muted/40 transition-colors flex items-center gap-3"
                >
                  <SeverityChip severity={f.severity} />
                  <span className="text-[12.5px] font-medium min-w-0 flex-1 truncate">{f.title}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              </li>
            ))}
          </ul>
          {file.riskFlags.length > 5 && (
            <div className="px-4 py-2 border-t border-border text-[11.5px] text-muted-foreground">
              {file.riskFlags.length - 5} more on the Risk Flags tab
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

/**
 * Confirm / reject controls for a suspected MCA.
 *
 * Deliberately three-state. The system proposes, the underwriter decides,
 * and the decision is always reversible — a rejected position can be
 * restored, and "clear" puts it back to whatever the rules think.
 */
function ReviewControls({
  p, onDecision,
}: {
  p: UwPosition;
  onDecision: (id: string, status: ReviewStatus | null) => void;
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (p.review === 'confirmed') {
    return (
      <div className="flex items-center justify-end gap-1.5" onClick={stop}>
        <Badge variant="success">Confirmed MCA</Badge>
        <Button variant="outline" className="h-6 px-1.5 text-[11px]" onClick={() => onDecision(p.id, null)} title="Back to suspected">
          <RotateCcw className="h-3 w-3" />
        </Button>
      </div>
    );
  }
  if (p.review === 'rejected') {
    return (
      <div className="flex items-center justify-end gap-1.5" onClick={stop}>
        <Badge variant="outline">Not an MCA</Badge>
        <Button variant="outline" className="h-6 px-1.5 text-[11px]" onClick={() => onDecision(p.id, null)} title="Undo">
          <RotateCcw className="h-3 w-3" />
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-end gap-1.5" onClick={stop}>
      <Button variant="outline" className="h-6 px-2 text-[11px]" onClick={() => onDecision(p.id, 'confirmed')}>
        Confirm MCA
      </Button>
      <Button variant="outline" className="h-6 px-2 text-[11px]" onClick={() => onDecision(p.id, 'rejected')}>
        Not an MCA
      </Button>
    </div>
  );
}

/* ══════════════════════ TRANSFER ACCOUNTS ══════════════════════ */

/**
 * Money the merchant moves between their own accounts.
 *
 * This exists to stop internal transfers inflating revenue. Each detected
 * counterparty account is confirmable, and confirming keeps it out of True
 * Revenue while leaving it in Gross Revenue and the full ledger — the
 * money did arrive, it just wasn't a sale.
 */
export function TransfersPanel({ file, onDrill, onOverride, onTransferDecision }: PanelProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Transfer accounts" value={String(file.transferAccounts.length)} emphasis />
        <Metric label="Transferred in" value={money(file.internalTransfersIn)} emphasis
          note="Excluded from true revenue, kept in gross" />
        <Metric label="Transferred out" value={money(file.internalTransfersOut)} emphasis />
      </div>

      {file.matchedTransfers.length > 0 && (
        <Section
          title="Matched internal transfers"
          subtitle="Both sides visible — a debit in one uploaded statement against an equal credit in another"
          dense
        >
          <DataTable
            minWidth={760}
            head={<><Th>Date</Th><Th align="right">Amount</Th><Th>From → to</Th><Th align="right">Gap</Th><Th align="right">Confidence</Th></>}
          >
            {file.matchedTransfers.map((m) => (
              <tr
                key={m.id}
                className="border-b border-border/60 hover:bg-muted/30 cursor-pointer"
                onClick={() => onDrill({
                  title: `Matched transfer — ${money(m.amount)}`,
                  derivation: [
                    { label: 'Amount', value: money(m.amount) },
                    { label: 'From', value: m.fromAccountLabel },
                    { label: 'To', value: m.toAccountLabel },
                    { label: 'Days apart', value: String(m.dayGap), muted: true },
                  ],
                  explanation: 'An equal, opposite entry in another statement you uploaded within three days. The incoming side is not counted as business revenue.',
                  transactions: pick(file, [m.outKey, m.inKey]),
                })}
              >
                <Td className="whitespace-nowrap">{longDate(m.date)}</Td>
                <Td align="right" tabular className="font-medium">{money(m.amount)}</Td>
                <Td className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    {m.fromAccountLabel} <ArrowLeftRight className="h-3 w-3 text-muted-foreground" /> {m.toAccountLabel}
                  </span>
                </Td>
                <Td align="right" tabular className="text-muted-foreground">{m.dayGap}d</Td>
                <Td align="right"><ConfidenceChip level={m.confidence} /></Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}

      <Section
        title="Transfer accounts"
        subtitle="Grouped by the account on the other side. Click a row for every transaction with it."
        dense
      >
        {file.transferAccounts.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
            No internal transfers detected in these statements.
          </div>
        ) : (
          <DataTable
            minWidth={900}
            head={
              <>
                <Th>Account</Th>
                <Th align="right">Transferred in</Th>
                <Th align="right">Transferred out</Th>
                <Th align="right">Net</Th>
                <Th align="right">Txns</Th>
                <Th>Why</Th>
                <Th align="right">Review</Th>
              </>
            }
          >
            {file.transferAccounts.map((a) => (
              <tr
                key={a.id}
                className="border-b border-border/60 hover:bg-muted/30 cursor-pointer"
                onClick={() => onDrill({
                  title: a.label,
                  derivation: [
                    { label: 'Transferred in', value: money(a.transferredIn) },
                    { label: 'Transferred out', value: money(a.transferredOut) },
                    { label: 'Net', value: money(a.net) },
                    { label: 'Transactions', value: String(a.count), muted: true },
                  ],
                  explanation: a.reason,
                  transactions: pick(file, a.txnKeys),
                })}
              >
                <Td>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[13px]">{a.label}</span>
                    {a.isUploadedAccount && <Badge variant="success">Both sides uploaded</Badge>}
                  </div>
                </Td>
                <Td align="right" tabular className={TONE_TEXT.good}>{money(a.transferredIn)}</Td>
                <Td align="right" tabular className={TONE_TEXT.bad}>{money(a.transferredOut)}</Td>
                <Td align="right" tabular className="font-medium">{money(a.net)}</Td>
                <Td align="right" tabular className="text-muted-foreground">{a.count}</Td>
                <Td className="text-[11.5px] text-muted-foreground max-w-[260px]">{a.reason}</Td>
                <Td align="right">
                  <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {a.status === 'confirmed' ? (
                      <>
                        <Badge variant="success">Confirmed</Badge>
                        <Button variant="outline" className="h-6 px-1.5 text-[11px]" onClick={() => onTransferDecision(a.id, null)}>
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="outline" className="h-6 px-2 text-[11px]" onClick={() => onTransferDecision(a.id, 'confirmed')}>
                          Confirm
                        </Button>
                        <Button variant="outline" className="h-6 px-2 text-[11px]" onClick={() => onTransferDecision(a.id, 'rejected')}>
                          Not internal
                        </Button>
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
        <div className="flex items-start gap-2 px-4 py-3 border-t border-border text-[11.5px] text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Confirming keeps these out of <span className="font-medium text-foreground">true revenue</span> while
            leaving them in gross revenue and the full transaction history. Rejecting returns them to normal
            classification and every metric recalculates.
          </span>
        </div>
      </Section>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/* ══════════════════════════ CASH FLOW ══════════════════════════ */

export function CashFlowPanel({ file, onDrill }: PanelProps) {
  const totals = useMemo(() => file.months.reduce(
    (a, m) => ({
      gross: a.gross + m.grossDeposits,
      trueRev: a.trueRev + m.trueRevenue,
      withdrawals: a.withdrawals + m.withdrawals,
      deposits: a.deposits + m.depositCount,
      negative: a.negative + m.negativeDays,
      nsf: a.nsf + m.nsfCount + m.returnedCount,
      mca: a.mca + m.mcaPayments,
    }),
    { gross: 0, trueRev: 0, withdrawals: 0, deposits: 0, negative: 0, nsf: 0, mca: 0 },
  ), [file.months]);

  const openMonth = (m: MonthRow) => onDrill({
    title: `${m.label} — transactions`,
    derivation: [
      { label: 'Gross deposits', value: money(m.grossDeposits) },
      { label: 'True revenue', value: money(m.trueRevenue) },
      { label: 'Withdrawals', value: money(m.withdrawals) },
      { label: 'Deposit count', value: String(m.depositCount), muted: true },
      { label: 'Average deposit', value: money(m.avgDepositSize), muted: true },
      { label: 'Largest deposit', value: money(m.largestDeposit), muted: true },
      { label: 'Average daily balance', value: money(m.avgDailyBalance), muted: true },
      { label: 'Low / high balance', value: `${money(m.lowBalance)} / ${money(m.highBalance)}`, muted: true },
      { label: 'Ending balance', value: money(m.endingBalance), muted: true },
      { label: 'MCA payments', value: money(m.mcaPayments), muted: true },
      { label: 'MCA % of true revenue', value: percent(m.mcaWithholdPct), muted: true },
    ],
    explanation: m.partial ? 'This month is only partly covered by the uploaded statements, so it is excluded from the monthly averages.' : undefined,
    transactions: file.transactions.filter((t) => t.month === m.key),
  });

  return (
    <div className="space-y-4">
      <Section title="Month by month" subtitle="Click any month to see the transactions behind it" dense>
        <DataTable
          minWidth={980}
          head={
            <>
              <Th>Month</Th>
              <Th align="right">Gross deposits</Th>
              <Th align="right">True revenue</Th>
              <Th align="right">Withdrawals</Th>
              <Th align="right">Deposits</Th>
              <Th align="right">Avg deposit</Th>
              <Th align="right">Avg daily bal</Th>
              <Th align="right">Low bal</Th>
              <Th align="right">Neg days</Th>
              <Th align="right">NSF</Th>
              <Th align="right">MCA paid</Th>
              <Th align="right">MCA %</Th>
            </>
          }
        >
          {file.months.map((m) => (
            <tr
              key={m.key}
              onClick={() => openMonth(m)}
              className="border-b border-border/60 cursor-pointer hover:bg-muted/40 transition-colors"
            >
              <Td className="font-medium whitespace-nowrap">
                {m.label}
                {m.partial && <span className="ml-1.5 text-[10px] text-muted-foreground">partial</span>}
              </Td>
              <Td align="right" tabular>{money(m.grossDeposits)}</Td>
              <Td align="right" tabular className="font-medium">{money(m.trueRevenue)}</Td>
              <Td align="right" tabular>{money(m.withdrawals)}</Td>
              <Td align="right" tabular className="text-muted-foreground">{m.depositCount}</Td>
              <Td align="right" tabular className="text-muted-foreground">{money(m.avgDepositSize)}</Td>
              <Td align="right" tabular>{money(m.avgDailyBalance)}</Td>
              <Td align="right" tabular className={m.lowBalance !== null && m.lowBalance < 0 ? TONE_TEXT.bad : ''}>{money(m.lowBalance)}</Td>
              <Td align="right" tabular className={m.negativeDays > 0 ? TONE_TEXT.bad : 'text-muted-foreground'}>{file.balancesAvailable ? m.negativeDays : '—'}</Td>
              <Td align="right" tabular className={m.nsfCount + m.returnedCount > 0 ? TONE_TEXT.bad : 'text-muted-foreground'}>{m.nsfCount + m.returnedCount}</Td>
              <Td align="right" tabular>{m.mcaPayments > 0 ? money(m.mcaPayments) : '—'}</Td>
              <Td align="right" tabular className={m.mcaWithholdPct > 0.2 ? TONE_TEXT.warn : ''}>{m.mcaPayments > 0 ? percent(m.mcaWithholdPct) : '—'}</Td>
            </tr>
          ))}
          <tr className="border-t-2 border-border bg-muted/30 font-semibold">
            <Td className="font-semibold">Total</Td>
            <Td align="right" tabular>{money(totals.gross)}</Td>
            <Td align="right" tabular>{money(totals.trueRev)}</Td>
            <Td align="right" tabular>{money(totals.withdrawals)}</Td>
            <Td align="right" tabular>{totals.deposits}</Td>
            <Td align="right" tabular>—</Td>
            <Td align="right" tabular>{money(file.avgDailyBalance)}</Td>
            <Td align="right" tabular>{money(file.lowestBalance)}</Td>
            <Td align="right" tabular>{file.balancesAvailable ? totals.negative : '—'}</Td>
            <Td align="right" tabular>{totals.nsf}</Td>
            <Td align="right" tabular>{money(totals.mca)}</Td>
            <Td align="right" tabular>{percent(file.withhold.pct)}</Td>
          </tr>
        </DataTable>
      </Section>

      {!file.balancesAvailable && (
        <p className="text-[12px] text-muted-foreground px-1">
          These statements had no running-balance column, so negative days, average daily balance, and low/high
          balances could not be measured. A CSV export from online banking normally includes the balance column.
        </p>
      )}
    </div>
  );
}

/* ══════════════════════ REVENUE REVIEW ══════════════════════ */

export function RevenueReviewPanel({ file, onDrill, onOverride, onResetOverride }: PanelProps) {
  const [query, setQuery] = useState('');
  const sources = useMemo(() => {
    const q = query.trim().toLowerCase();
    return file.revenueSources.filter((s) => !q || s.merchant.toLowerCase().includes(q));
  }, [file.revenueSources, query]);

  return (
    <div className="space-y-4">
      <Section title="Gross revenue → exclusions → true revenue" subtitle="The full derivation, line by line">
        <div className="space-y-1.5 max-w-2xl">
          <div className="flex items-baseline justify-between gap-4 text-[13.5px] font-medium">
            <span>Gross revenue — all incoming credits</span>
            <span className="tabular-nums">{money(file.revenueBridge.gross)}</span>
          </div>
          {file.revenueBridge.exclusions.map((e) => (
            <div key={e.kind} className="flex items-baseline justify-between gap-4 text-[12.5px] text-muted-foreground pl-4">
              <span>Less: {e.label} <span className="opacity-70">({e.count})</span></span>
              <span className="tabular-nums">−{money(e.amount)}</span>
            </div>
          ))}
          {file.revenueBridge.exclusions.length === 0 && (
            <div className="text-[12.5px] text-muted-foreground pl-4">No exclusions — every credit reads as operating revenue.</div>
          )}
          <div className="flex items-baseline justify-between gap-4 text-[15px] font-semibold pt-2 mt-1 border-t border-border">
            <span>True revenue</span>
            <span className="tabular-nums">{money(file.revenueBridge.trueRevenue)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-4 text-[12.5px] text-muted-foreground">
            <span>Monthly average</span>
            <span className="tabular-nums">{money(file.trueRevenueMonthly)}</span>
          </div>
        </div>
      </Section>

      <Section
        title="Deposit sources"
        subtitle="Toggle any source in or out of true revenue — every number on the file recalculates immediately"
        actions={
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter sources" className="h-8 w-48 pl-8 text-[12.5px]" />
          </div>
        }
        dense
      >
        <DataTable
          minWidth={820}
          head={
            <>
              <Th>Deposit source</Th>
              <Th align="right">Amount</Th>
              <Th align="right">Count</Th>
              <Th>System classification</Th>
              <Th align="center">True revenue?</Th>
              <Th align="right">Actions</Th>
            </>
          }
        >
          {sources.map((s) => (
            <tr key={s.merchant} className="border-b border-border/60 hover:bg-muted/30">
              <Td>
                <button
                  type="button"
                  className="text-left hover:underline"
                  onClick={() => onDrill({
                    title: s.merchant,
                    derivation: [
                      { label: 'Total deposited', value: money(s.total) },
                      { label: 'Transactions', value: String(s.count), muted: true },
                      { label: 'System classification', value: s.classification, muted: true },
                    ],
                    explanation: s.reason,
                    transactions: pick(file, s.keys),
                  })}
                >
                  <span className="font-medium">{s.merchant}</span>
                </button>
                {s.overridden && <Badge variant="outline" className="ml-2">Overridden</Badge>}
              </Td>
              <Td align="right" tabular className="font-medium">{money(s.total)}</Td>
              <Td align="right" tabular className="text-muted-foreground">{s.count}</Td>
              <Td>
                <div className="flex items-center gap-2">
                  <span className="text-[12px]">{s.classification}</span>
                  <ConfidenceChip level={s.confidence} />
                </div>
              </Td>
              <Td align="center">
                {s.isTrueRevenue
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-600 inline" aria-label="Counted" />
                  : <XCircle className="h-4 w-4 text-muted-foreground inline" aria-label="Excluded" />}
              </Td>
              <Td align="right">
                <div className="flex items-center justify-end gap-1.5">
                  <Button
                    variant="outline"
                    className="h-7 px-2 text-[11.5px]"
                    onClick={() => onOverride(s.keys, s.isTrueRevenue ? 'other' : 'revenue')}
                  >
                    {s.isTrueRevenue ? 'Exclude all' : 'Include all'}
                  </Button>
                  {s.overridden && (
                    <Button variant="outline" className="h-7 px-2 text-[11.5px]" onClick={() => onResetOverride(s.keys)} title="Restore automatic classification">
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}

/* ══════════════════════ MCA POSITIONS ══════════════════════ */

export function PositionsPanel({ file, onDrill, onPositionDecision }: PanelProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Current positions" value={String(file.currentPositions.length)} emphasis
          tone={file.currentPositions.length >= 4 ? 'bad' : file.currentPositions.length >= 3 ? 'warn' : 'good'} />
        <Metric label="Combined monthly payments" value={money(file.mcaMonthlyPayments)} emphasis />
        <Metric label="Combined withhold" value={percent(file.withhold.pct)} emphasis
          tone={file.withhold.pct > 0.3 ? 'bad' : file.withhold.pct > 0.2 ? 'warn' : 'good'} />
      </div>

      <Section title="Current MCA positions" subtitle="Detected from funder names and from fixed-amount daily / weekly debit patterns" dense>
        {file.currentPositions.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
            No active advances detected in these statements.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {file.currentPositions.map((p) => <PositionRow key={p.id} p={p} file={file} onDrill={onDrill} onDecision={onPositionDecision} />)}
          </div>
        )}
      </Section>

      {file.fundingEvents.length > 0 && (
        <Section title="Fundings received" subtitle="Incoming deposits that look like advance proceeds" dense>
          <DataTable
            minWidth={760}
            head={<><Th>Date</Th><Th>Funder</Th><Th>Why flagged</Th><Th align="right">Amount</Th><Th>Linked position</Th></>}
          >
            {file.fundingEvents.map((f) => (
              <tr key={f.id} className="border-b border-border/60 hover:bg-muted/30">
                <Td className="whitespace-nowrap">{longDate(f.date)}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{f.funderName ?? 'Unnamed'}</span>
                    <ConfidenceChip level={f.confidence} />
                  </div>
                </Td>
                <Td className="text-[11.5px] text-muted-foreground max-w-[280px]">{f.reason}</Td>
                <Td align="right" tabular className={`font-medium ${TONE_TEXT.good}`}>+{money(f.amount)}</Td>
                <Td className="text-[11.5px] text-muted-foreground">{f.linkedNote ?? '—'}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}

      {file.historicalPositions.length > 0 && (
        <Section
          title="MCA history"
          subtitle="Advances whose payments stopped — a stop is not the same as a payoff, so these are never counted in the current burden"
          dense
        >
          <div className="divide-y divide-border">
            {file.historicalPositions.map((p) => <PositionRow key={p.id} p={p} file={file} onDrill={onDrill} onDecision={onPositionDecision} historical />)}
          </div>
        </Section>
      )}
    </div>
  );
}

function PositionRow({
  p, file, onDrill, onDecision, historical = false,
}: {
  p: UwPosition;
  file: UnderwritingFile;
  onDrill: (d: DrillDown) => void;
  onDecision: (id: string, status: ReviewStatus | null) => void;
  historical?: boolean;
}) {
  const statusTone: Tone =
    p.status === 'active' ? 'neutral'
      : p.status === 'possible_default' ? 'bad'
        : p.status === 'stopped' ? 'warn' : 'good';

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold">{p.funderName}</span>
            <ConfidenceChip level={p.confidenceLevel} />
            {!p.identified && <Badge variant="outline">Unrecognized name</Badge>}
            {p.paymentChanged && <Badge variant="warning">Payment changed</Badge>}
            {p.review === 'confirmed' && <Badge variant="success">Confirmed MCA</Badge>}
            {p.review === 'rejected' && <Badge variant="outline">Not an MCA</Badge>}
          </div>
          {p.presentThroughout && !historical && (
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-rose-600 dark:text-rose-400">
              Active throughout entire statement period
            </div>
          )}
          <div className={`mt-1 text-[11.5px] ${TONE_TEXT[statusTone]}`}>
            {POSITION_STATUS_LABEL[p.status]} — <span className="text-muted-foreground">{p.statusReason}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="outline" className="h-7 px-2 text-[11.5px]"
            onClick={() => onDrill({
              title: `${p.funderName} — payments`,
              derivation: [
                { label: 'Payment', value: `${money(p.paymentAmount, 2)} ${CADENCE_LABEL[p.cadence].toLowerCase()}` },
                { label: 'Estimated weekly', value: money(p.weeklyEquivalent) },
                { label: 'Estimated monthly', value: money(p.monthlyEquivalent) },
                { label: 'First seen', value: longDate(p.firstDate), muted: true },
                { label: 'Last seen', value: longDate(p.lastDate), muted: true },
                { label: 'Months present', value: `${p.monthsPresent} of ${p.monthsInPeriod}`, muted: true },
                { label: 'Payments observed', value: String(p.paymentCount), muted: true },
                { label: 'Estimated original advance', value: p.estimatedFunding ? money(p.estimatedFunding) : 'Not solvable', muted: true },
                { label: 'Estimated factor', value: p.estimatedFactor ? p.estimatedFactor.toFixed(2) : '—', muted: true },
                { label: 'Estimated balance remaining', value: p.estimatedRemaining !== null ? money(p.estimatedRemaining) : 'Started before these statements', muted: true },
                { label: 'Share of true revenue', value: percent(p.withholdPct), muted: true },
              ],
              explanation: `${p.confidenceReasons.join('. ')}. Advance size and factor are reverse-solved from the payment and cadence — they are estimates, not a payoff figure.`,
              transactions: pick(file, p.txnKeys),
            })}
          >
            {p.paymentCount} payments
          </Button>
          <ReviewControls p={p} onDecision={onDecision} />
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-x-4 gap-y-2 text-[12px]">
        <Fact label="Payment" value={`${money(p.paymentAmount, 2)}`} sub={CADENCE_LABEL[p.cadence]} />
        <Fact label="Weekly" value={money(p.weeklyEquivalent)} />
        <Fact label="Monthly" value={money(p.monthlyEquivalent)} />
        <Fact label="First seen" value={shortDate(p.firstDate)} />
        <Fact label="Last seen" value={shortDate(p.lastDate)} />
        <Fact label="Months present" value={`${p.monthsPresent}/${p.monthsInPeriod}`} />
        <Fact label="Withhold" value={percent(p.withholdPct)} />
      </div>

      {p.paymentChanged && (
        <div className="mt-2 text-[11.5px] text-amber-700 dark:text-amber-400">
          Payment history: {p.paymentHistory.map((s) => money(s.amount, 2)).join('  →  ')}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-[10.5px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/* ══════════════════════════ RISK ══════════════════════════ */

export function RiskPanel({ file, onDrill }: PanelProps) {
  const bySeverity = {
    high: file.riskFlags.filter((f) => f.severity === 'high'),
    medium: file.riskFlags.filter((f) => f.severity === 'medium'),
    low: file.riskFlags.filter((f) => f.severity === 'low' || f.severity === 'info'),
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="High risk" value={String(bySeverity.high.length)} tone={bySeverity.high.length ? 'bad' : 'good'} emphasis />
        <Metric label="Medium risk" value={String(bySeverity.medium.length)} tone={bySeverity.medium.length ? 'warn' : 'good'} emphasis />
        <Metric label="Collection activity" value={String(file.collections.length)} tone={file.collections.length ? 'bad' : 'good'} emphasis />
      </div>

      <Section title="Risk flags" subtitle="Each flag explains the rule that fired and links to the transactions that caused it" dense>
        {file.riskFlags.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">Nothing triggered.</div>
        ) : (
          <ul className="divide-y divide-border">
            {file.riskFlags.map((f) => (
              <li key={f.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0"><SeverityChip severity={f.severity} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold">{f.title}</div>
                    <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">{f.explanation}</p>
                    {f.txnKeys.length > 0 && (
                      <button
                        type="button"
                        className="mt-1.5 text-[11.5px] font-medium text-primary hover:underline"
                        onClick={() => onDrill({ title: f.title, explanation: f.explanation, transactions: pick(file, f.txnKeys) })}
                      >
                        View {f.txnKeys.length} transaction{f.txnKeys.length === 1 ? '' : 's'}
                      </button>
                    )}
                  </div>
                  <ConfidenceChip level={f.confidence} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {file.collections.length > 0 && (
        <Section title="Suspected debt collection activity" subtitle="Payments to collection, settlement, or workout firms — with confidence, because a law-firm payment is not automatically collections" dense>
          <DataTable
            minWidth={700}
            head={<><Th>Payee</Th><Th align="right">Payments</Th><Th align="right">Total</Th><Th>Why flagged</Th><Th align="right">Confidence</Th></>}
          >
            {file.collections.map((c) => (
              <tr key={c.id} className="border-b border-border/60 hover:bg-muted/30 cursor-pointer"
                onClick={() => onDrill({ title: c.payee, explanation: c.reason, transactions: pick(file, c.txnKeys) })}>
                <Td className="font-medium">{c.payee}</Td>
                <Td align="right" tabular>{c.count}</Td>
                <Td align="right" tabular className="font-medium">{money(c.total)}</Td>
                <Td className="text-[11.5px] text-muted-foreground max-w-[320px]">{c.reason}</Td>
                <Td align="right"><ConfidenceChip level={c.confidence} /></Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </div>
  );
}

/* ══════════════════════ TRANSACTIONS ══════════════════════ */

type TxnFilter = 'all' | TxnClass | 'credits' | 'debits' | 'large' | 'excluded';
type SortKey = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc';

export function TransactionsPanel({ file, onDrill, onOverride, onResetOverride, onMarkMca }: PanelProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TxnFilter>('all');
  const [sort, setSort] = useState<SortKey>('date-desc');
  const [account, setAccount] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(100);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const isAmountQuery = /^\$?[\d,.]+$/.test(q) && q.length > 0;
    const numeric = isAmountQuery ? Number(q.replace(/[^0-9.]/g, '')) : NaN;

    let list = file.transactions.filter((t) => {
      if (account !== 'all' && t.accountId !== account) return false;
      switch (filter) {
        case 'all': break;
        case 'credits': if (t.amount <= 0) return false; break;
        case 'debits': if (t.amount >= 0) return false; break;
        case 'large': if (!t.isLarge) return false; break;
        case 'excluded': if (!(t.amount > 0 && !t.isTrueRevenue)) return false; break;
        default: if (t.cls !== filter) return false;
      }
      if (!q) return true;
      if (isAmountQuery && Number.isFinite(numeric) && Math.abs(Math.abs(t.amount) - numeric) < 0.005) return true;
      return t.description.toLowerCase().includes(q)
        || t.merchant.toLowerCase().includes(q)
        || (t.funderName ?? '').toLowerCase().includes(q);
    });

    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'date-asc': return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
        case 'amount-desc': return Math.abs(b.amount) - Math.abs(a.amount);
        case 'amount-asc': return Math.abs(a.amount) - Math.abs(b.amount);
        default: return a.date > b.date ? -1 : a.date < b.date ? 1 : 0;
      }
    });
    return list;
  }, [file.transactions, query, filter, sort, account]);

  const shown = rows.slice(0, limit);
  const totals = rows.reduce((a, t) => (t.amount > 0 ? { ...a, in: a.in + t.amount } : { ...a, out: a.out + Math.abs(t.amount) }), { in: 0, out: 0 });

  const FILTERS: { key: TxnFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'credits', label: 'Credits' },
    { key: 'debits', label: 'Debits' },
    { key: 'mca_payment', label: 'MCA' },
    { key: 'mca_funding', label: 'Funding' },
    { key: 'returned_payment', label: 'NSF' },
    { key: 'internal_transfer', label: 'Transfers' },
    { key: 'revenue', label: 'Revenue' },
    { key: 'excluded', label: 'Excluded revenue' },
    { key: 'collection', label: 'Collections' },
    { key: 'large', label: 'Large' },
  ];

  const toggle = (key: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const bulk = (cls: TxnClass) => { onOverride(Array.from(selected), cls); setSelected(new Set()); };

  function exportCsv() {
    const head = ['Date', 'Description', 'Merchant', 'Debit', 'Credit', 'Balance', 'Category', 'True revenue', 'Account', 'Month', 'Confidence', 'Reason'];
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const body = rows.map((t: UwTransaction) => [
      t.date, esc(t.description), esc(t.merchant),
      t.amount < 0 ? Math.abs(t.amount).toFixed(2) : '',
      t.amount > 0 ? t.amount.toFixed(2) : '',
      t.balance === null ? '' : t.balance.toFixed(2),
      TXN_CLASS_LABEL[t.cls], t.isTrueRevenue ? 'yes' : '',
      esc(t.accountId), t.month, t.confidence, esc(t.reason),
    ].join(','));
    const blob = new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'underwriting-transactions.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setLimit(100); }}
            placeholder='Search every statement — "Reliance", "NSF", "wire", or an amount like 10000'
            className="h-9 pl-8 text-[13px]"
          />
        </div>
        {file.accounts.length > 1 && (
          <Select value={account} onChange={(e) => setAccount(e.target.value)} className="h-9 w-auto text-[12.5px]">
            <option value="all">All accounts</option>
            {file.accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </Select>
        )}
        <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-9 w-auto text-[12.5px]">
          <option value="date-desc">Newest first</option>
          <option value="date-asc">Oldest first</option>
          <option value="amount-desc">Largest first</option>
          <option value="amount-asc">Smallest first</option>
        </Select>
        <Button variant="outline" className="h-9" onClick={exportCsv}>CSV</Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => { setFilter(f.key); setLimit(100); }}
              className={`px-2.5 py-1 rounded text-[11.5px] font-medium transition-colors ${
                active ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11.5px] text-muted-foreground">
        <span>{rows.length.toLocaleString()} of {file.transactions.length.toLocaleString()} transactions</span>
        <span className={TONE_TEXT.good}>In {money(totals.in)}</span>
        <span className={TONE_TEXT.bad}>Out {money(totals.out)}</span>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border border-border bg-muted/40 rounded-md px-3 py-2">
          <span className="text-[12.5px] font-medium">{selected.size} selected</span>
          <Button
            variant="outline"
            className="h-7 px-2 text-[11.5px]"
            title="Add every other transaction from the same payees to the selection"
            onClick={() => {
              const keys = new Set(Array.from(selected).map((k) => file.transactions.find((t) => t.key === k)?.merchantKey).filter(Boolean) as string[]);
              setSelected(new Set(file.transactions.filter((t) => keys.has(t.merchantKey)).map((t) => t.key)));
            }}
          >
            Select all matching
          </Button>
          <div className="flex flex-wrap items-center gap-1.5 ml-auto">
            <Button
              className="h-7 px-2 text-[11.5px]"
              onClick={() => {
                const rows = Array.from(selected).map((k) => file.transactions.find((t) => t.key === k)!).filter(Boolean);
                onMarkMca(Array.from(selected), rows[0]?.merchantKey ?? null, rows[0]?.merchant ?? '');
              }}
            >
              <Plus className="h-3 w-3 mr-1" /> Mark as MCA
            </Button>
            <Button variant="outline" className="h-7 px-2 text-[11.5px]" onClick={() => bulk('internal_transfer')}>
              Mark internal transfer
            </Button>
            <Select
              value=""
              onChange={(e) => { if (e.target.value) bulk(e.target.value as TxnClass); }}
              className="h-7 w-auto text-[11.5px]"
              aria-label="Classify selection"
            >
              <option value="">Classify as…</option>
              {MANUAL_CLASSES.map((c) => <option key={c} value={c}>{TXN_CLASS_LABEL[c]}</option>)}
            </Select>
            <Button variant="outline" className="h-7 px-2 text-[11.5px]" onClick={() => { onResetOverride(Array.from(selected)); setSelected(new Set()); }}>
              <RotateCcw className="h-3 w-3 mr-1" /> Reset to system
            </Button>
          </div>
        </div>
      )}

      <div className="border border-border rounded-md bg-card">
        <DataTable
          minWidth={1080}
          head={
            <>
              <Th className="w-8" />
              <Th onClick={() => setSort((v) => (v === 'date-desc' ? 'date-asc' : 'date-desc'))}>Date</Th>
              <Th>Description</Th>
              <Th>Merchant</Th>
              <Th align="right" onClick={() => setSort((v) => (v === 'amount-desc' ? 'amount-asc' : 'amount-desc'))}>Debit</Th>
              <Th align="right">Credit</Th>
              <Th align="right">Balance</Th>
              <Th>Category</Th>
              <Th align="center">Rev?</Th>
              <Th>Account</Th>
            </>
          }
        >
          {shown.map((t) => (
            <tr key={t.key} className={`border-b border-border/60 hover:bg-muted/30 ${selected.has(t.key) ? 'bg-primary/5' : ''}`}>
              <Td className="w-8">
                <input
                  type="checkbox"
                  checked={selected.has(t.key)}
                  onChange={() => toggle(t.key)}
                  aria-label={`Select ${t.description}`}
                  className="h-3.5 w-3.5 align-middle"
                />
              </Td>
              <Td className="whitespace-nowrap text-muted-foreground">{shortDate(t.date)}</Td>
              <Td>
                <button
                  type="button"
                  className="text-left hover:underline max-w-[320px] truncate block"
                  title={t.description}
                  onClick={() => onDrill({
                    title: t.merchant,
                    derivation: [
                      { label: 'Date', value: longDate(t.date) },
                      { label: 'Amount', value: money(t.amount, 2) },
                      { label: 'Balance after', value: money(t.balance, 2), muted: true },
                      { label: 'Classification', value: TXN_CLASS_LABEL[t.cls] },
                      { label: 'System said', value: TXN_CLASS_LABEL[t.autoClass], muted: true },
                      { label: 'Account', value: t.accountId, muted: true },
                    ],
                    explanation: t.reason,
                    transactions: [t],
                  })}
                >
                  {t.description}
                </button>
              </Td>
              <Td className="text-muted-foreground max-w-[160px] truncate" title={t.merchant}>{t.merchant}</Td>
              <Td align="right" tabular className={t.amount < 0 ? TONE_TEXT.bad : 'text-muted-foreground'}>
                {t.amount < 0 ? money(Math.abs(t.amount), 2) : ''}
              </Td>
              <Td align="right" tabular className={t.amount > 0 ? TONE_TEXT.good : 'text-muted-foreground'}>
                {t.amount > 0 ? money(t.amount, 2) : ''}
              </Td>
              <Td align="right" tabular className="text-muted-foreground">{t.balance === null ? '—' : money(t.balance, 2)}</Td>
              <Td>
                <div className="flex items-center gap-1.5">
                  <ClassChip cls={t.cls} />
                  {t.overridden && <Badge variant="outline">Manual</Badge>}
                  {t.isLarge && <Badge variant="outline">Large</Badge>}
                </div>
              </Td>
              <Td align="center">
                {t.amount > 0 ? (t.isTrueRevenue
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 inline" />
                  : <XCircle className="h-3.5 w-3.5 text-muted-foreground inline" />) : <span className="text-muted-foreground">—</span>}
              </Td>
              <Td className="text-[11.5px] text-muted-foreground whitespace-nowrap">
                {file.accounts.find((a) => a.id === t.accountId)?.label ?? t.accountId}
              </Td>
            </tr>
          ))}
        </DataTable>
        {rows.length > shown.length && (
          <div className="p-2 border-t border-border">
            <Button variant="outline" className="w-full h-8 text-[12.5px]" onClick={() => setLimit((n) => n + 300)}>
              Show more ({(rows.length - shown.length).toLocaleString()} remaining)
            </Button>
          </div>
        )}
        {rows.length === 0 && (
          <div className="py-10 text-center text-[13px] text-muted-foreground">Nothing matches that search.</div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════ STATEMENTS ══════════════════════ */

export function StatementsPanel({ file, onDrill }: PanelProps) {
  return (
    <div className="space-y-4">
      {file.accounts.map((acct) => {
        const stmts = file.statements.filter((s) => s.accountId === acct.id);
        const acctTxns = file.transactions.filter((t) => t.accountId === acct.id);
        const credits = acctTxns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
        const debits = acctTxns.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

        return (
          <Section
            key={acct.id}
            title={acct.label}
            subtitle={`${stmts.length} statement${stmts.length === 1 ? '' : 's'} · ${acctTxns.length.toLocaleString()} transactions · ${money(credits)} in / ${money(debits)} out`}
            dense
          >
            <DataTable
              minWidth={640}
              head={<><Th>Statement</Th><Th>Period</Th><Th>Months</Th><Th align="right">Transactions</Th><Th align="right">Pages</Th></>}
            >
              {stmts.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-border/60 hover:bg-muted/30 cursor-pointer"
                  onClick={() => onDrill({
                    title: s.fileName,
                    derivation: [
                      { label: 'Account', value: acct.label },
                      { label: 'Period', value: `${longDate(s.periodStart)} – ${longDate(s.periodEnd)}` },
                      { label: 'Transactions read', value: String(s.transactionCount) },
                      { label: 'Pages', value: s.pageCount ? String(s.pageCount) : '—', muted: true },
                    ],
                    explanation: 'All transactions parsed from this statement.',
                    transactions: file.transactions.filter((t) => t.statementId === s.id),
                  })}
                >
                  <Td>
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="font-medium truncate max-w-[280px]" title={s.fileName}>{s.fileName}</span>
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{longDate(s.periodStart)} – {longDate(s.periodEnd)}</Td>
                  <Td className="text-muted-foreground">{s.months.join(', ')}</Td>
                  <Td align="right" tabular>{s.transactionCount.toLocaleString()}</Td>
                  <Td align="right" tabular className="text-muted-foreground">{s.pageCount ?? '—'}</Td>
                </tr>
              ))}
            </DataTable>
          </Section>
        );
      })}

      <p className="text-[11.5px] text-muted-foreground px-1 flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          Statements are parsed in your browser and are not uploaded or stored. Clicking a statement shows every
          transaction read from it; to view the original PDF, open the file you uploaded.
        </span>
      </p>
    </div>
  );
}
