'use client';

import { useMemo, useState } from 'react';
import { Button, Input, Select, Badge } from '@/components/ui/primitives';
import {
  Search, RotateCcw, CheckCircle2, XCircle, AlertTriangle, Info, FileText,
  ChevronRight, TrendingUp, TrendingDown, Minus, Banknote,
} from 'lucide-react';
import type {
  UnderwritingFile, UwTransaction, TxnClass, MonthRow, UwPosition,
} from '@/lib/underwriting/workstation';
import { TXN_CLASS_LABEL, POSITION_STATUS_LABEL } from '@/lib/underwriting/workstation';
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
  onPositionDecision: (id: string, confirmed: boolean | null) => void;
}

const byKey = (file: UnderwritingFile) => new Map(file.transactions.map((t) => [t.key, t]));
const pick = (file: UnderwritingFile, keys: string[]) => {
  const m = byKey(file);
  return keys.map((k) => m.get(k)).filter(Boolean) as UwTransaction[];
};

/* ══════════════════════════ OVERVIEW ══════════════════════════ */

export function OverviewPanel({ file, onDrill }: PanelProps) {
  const withholdTone: Tone = file.withhold.pct > 0.3 ? 'bad' : file.withhold.pct > 0.2 ? 'warn' : 'good';
  const negTone: Tone = file.negativeDays.totalNegativeDays > 5 ? 'bad' : file.negativeDays.totalNegativeDays > 2 ? 'warn' : 'good';
  const nsfTotal = file.nsfCount + file.returnedCount;
  const nsfTone: Tone = nsfTotal > 5 ? 'bad' : nsfTotal > 2 ? 'warn' : 'good';

  const revenueTxns = file.transactions.filter((t) => t.isTrueRevenue);
  const mcaTxns = file.transactions.filter((t) => t.cls === 'mca_payment');

  const trendIcon = (t: UnderwritingFile['revenueTrend']) =>
    t === 'growing' ? <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
      : t === 'declining' ? <TrendingDown className="h-3.5 w-3.5 text-rose-600" />
        : <Minus className="h-3.5 w-3.5 text-muted-foreground" />;

  return (
    <div className="space-y-4">
      {/* Primary row — the four numbers a broker reads first. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Average true revenue"
          value={money(file.trueRevenueMonthly)}
          note="Per month, non-operating deposits removed"
          emphasis
          onClick={() => onDrill({
            title: 'Average true revenue',
            derivation: [
              { label: 'Gross deposits (total)', value: money(file.revenueBridge.gross) },
              ...file.revenueBridge.exclusions.map((e) => ({
                label: `Less: ${e.label} (${e.count})`, value: `−${money(e.amount)}`, muted: true,
              })),
              { label: 'True revenue (total)', value: money(file.revenueBridge.trueRevenue) },
              { label: `÷ ${file.months.filter((m) => !m.partial).length || file.months.length} full month(s)`, value: money(file.trueRevenueMonthly), muted: true },
            ],
            explanation: 'True revenue counts only deposits that look like operating sales. Transfers between the merchant’s own accounts, advance proceeds, loan draws, refunds and reversals are excluded. Every exclusion is listed on the Revenue Review tab and can be overridden.',
            transactions: revenueTxns.slice(0, 60),
          })}
        />
        <Metric
          label="Gross revenue"
          value={money(file.grossRevenueMonthly)}
          note="Per month, every incoming credit"
          emphasis
          onClick={() => onDrill({
            title: 'Gross revenue',
            derivation: [
              { label: 'All credits (total)', value: money(file.grossRevenueTotal) },
              { label: 'Deposits per month', value: file.avgDepositCount.toFixed(1), muted: true },
            ],
            explanation: 'Every incoming credit, unfiltered — including transfers and advance proceeds. This is the number a merchant usually quotes; true revenue is the one a funder underwrites.',
            transactions: file.transactions.filter((t) => t.amount > 0).slice(0, 60),
          })}
        />
        <Metric
          label="MCA withhold"
          value={percent(file.withhold.pct)}
          tone={withholdTone}
          note={`${money(file.mcaMonthlyPayments)}/mo across ${file.currentPositions.length} position${file.currentPositions.length === 1 ? '' : 's'}`}
          emphasis
          onClick={() => onDrill({
            title: 'MCA withhold %',
            derivation: [
              ...file.withhold.positions.map((p) => ({ label: p.name, value: `${money(p.monthly)}/mo`, muted: true })),
              { label: 'Total MCA payments', value: `${money(file.withhold.totalMonthly)}/mo` },
              { label: 'True revenue', value: `${money(file.withhold.trueRevenueMonthly)}/mo` },
              { label: `${money(file.withhold.totalMonthly)} ÷ ${money(file.withhold.trueRevenueMonthly)}`, value: percent(file.withhold.pct) },
            ],
            explanation: 'Recurring payments to currently-active advances, divided by true revenue. Positions that have stopped are excluded — they are not a live burden.',
            transactions: mcaTxns.slice(0, 60),
          })}
        />
        <Metric
          label="Current MCA positions"
          value={String(file.currentPositions.length)}
          tone={file.currentPositions.length >= 4 ? 'bad' : file.currentPositions.length >= 3 ? 'warn' : 'good'}
          note={file.historicalPositions.length ? `${file.historicalPositions.length} historical / stopped` : 'No historical positions'}
          emphasis
          onClick={() => onDrill({
            title: 'Current MCA positions',
            derivation: file.currentPositions.map((p) => ({
              label: `${p.funderName} — ${money(p.paymentAmount, 2)} ${CADENCE_LABEL[p.cadence].toLowerCase()}`,
              value: `${money(p.monthlyEquivalent)}/mo`,
            })),
            explanation: 'A position counts as current when its payments continue through the end of the statement period. Advances whose payments stopped are moved to MCA history so they do not inflate the burden.',
            transactions: mcaTxns.slice(0, 60),
          })}
        />
      </div>

      {/* Secondary row — balance behaviour and bank events. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Metric
          label="Avg daily balance"
          value={money(file.avgDailyBalance)}
          tone={file.avgDailyBalance !== null && file.avgDailyBalance < 1000 ? 'warn' : 'neutral'}
          onClick={() => onDrill({
            title: 'Average daily balance',
            derivation: file.months.map((m) => ({ label: m.label, value: money(m.avgDailyBalance), muted: true })),
            explanation: 'Each day’s closing balance, carried forward across days with no activity, averaged over the statement period and weighted by the days each month actually covers.',
          })}
        />
        <Metric label="Lowest balance" value={money(file.lowestBalance)} tone={file.lowestBalance !== null && file.lowestBalance < 0 ? 'bad' : 'neutral'} />
        <Metric label="Highest balance" value={money(file.highestBalance)} />
        <Metric
          label="Negative days"
          value={String(file.negativeDays.totalNegativeDays)}
          tone={negTone}
          note={file.negativeDays.longestRun ? `Longest run ${file.negativeDays.longestRun}d` : undefined}
          onClick={() => onDrill({
            title: 'Negative days',
            derivation: [
              { label: 'Total negative days', value: String(file.negativeDays.totalNegativeDays) },
              { label: 'Longest consecutive run', value: `${file.negativeDays.longestRun} day(s)` },
              { label: 'Lowest balance', value: money(file.negativeDays.lowestBalance) },
              { label: 'Average negative balance', value: money(file.negativeDays.averageNegativeBalance), muted: true },
              ...file.negativeDays.perMonth.map((m) => ({ label: m.label, value: `${m.days} day(s)`, muted: true })),
            ],
            explanation: `Counted from daily ENDING balances, not from individual negative transactions — a day is negative if the account closed below zero. ${file.negativeDays.dates.length ? `Dates: ${file.negativeDays.dates.slice(0, 20).map((d) => d.date).join(', ')}` : ''}`,
          })}
        />
        <Metric
          label="NSF / returned"
          value={String(nsfTotal)}
          tone={nsfTone}
          note={`${file.overdraftCount} overdraft fee${file.overdraftCount === 1 ? '' : 's'}`}
          onClick={() => onDrill({
            title: 'NSF / returned items',
            derivation: [
              { label: 'NSF items', value: String(file.nsfCount) },
              { label: 'Returned items', value: String(file.returnedCount) },
              { label: 'Overdraft fees', value: String(file.overdraftCount) },
            ],
            explanation: 'Counted once per event per day — when a statement shows both a returned item and its fee on the same day, that is one bounce, not two.',
            transactions: file.transactions.filter((t) => t.cls === 'bank_event'),
          })}
        />
        <Metric
          label="Avg monthly deposits"
          value={money(file.avgMonthlyDeposits)}
          note={`${file.avgDepositCount.toFixed(1)} deposits/mo`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr,1fr] items-start">
        {/* Automated summary — facts only, no credit decision. */}
        <Section title="Underwriting snapshot" subtitle="Calculated from the statements — facts and signals, not a credit decision">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
            <SummaryRow label="Average true revenue" value={`${money(file.trueRevenueMonthly)}/mo`} />
            <SummaryRow label="Average daily balance" value={money(file.avgDailyBalance)} />
            <SummaryRow label="Negative days" value={String(file.negativeDays.totalNegativeDays)} />
            <SummaryRow label="NSF / returned items" value={String(nsfTotal)} />
            <SummaryRow label="Current MCA positions" value={String(file.currentPositions.length)} />
            <SummaryRow label="Combined MCA withhold" value={percent(file.withhold.pct)} />
            <SummaryRow label="Avg monthly ending balance" value={money(file.avgMonthlyEndingBalance)} />
            <SummaryRow label="Statements analyzed" value={`${file.statementCount} across ${file.accountCount} account${file.accountCount === 1 ? '' : 's'}`} />
          </dl>

          <div className="mt-4 pt-3 border-t border-border grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px]">
            <div className="flex items-center gap-2">
              {trendIcon(file.revenueTrend)}
              <span className="text-muted-foreground">Revenue trend</span>
              <span className="font-medium capitalize ml-auto">{file.revenueTrend}</span>
            </div>
            <div className="flex items-center gap-2">
              {trendIcon(file.balanceTrend)}
              <span className="text-muted-foreground">Balance trend</span>
              <span className="font-medium capitalize ml-auto">{file.balanceTrend}</span>
            </div>
            <div className="flex items-center gap-2">
              <Banknote className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">MCA burden</span>
              <span className={`font-medium ml-auto ${TONE_TEXT[withholdTone]}`}>
                {file.withhold.pct > 0.3 ? 'Heavy' : file.withhold.pct > 0.2 ? 'Moderate' : file.withhold.pct > 0 ? 'Light' : 'None'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Fundings received</span>
              <span className="font-medium ml-auto">{file.fundingEvents.length}</span>
            </div>
          </div>
        </Section>

        <Section
          title="Risk flags"
          subtitle={file.riskFlags.length ? `${file.riskFlags.length} signal${file.riskFlags.length === 1 ? '' : 's'} — every one is explained` : undefined}
          dense
        >
          {file.riskFlags.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">
              No risk signals triggered on these statements.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {file.riskFlags.slice(0, 6).map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => onDrill({
                      title: f.title,
                      explanation: f.explanation,
                      transactions: pick(file, f.txnKeys),
                    })}
                    className="w-full text-left px-4 py-2.5 hover:bg-muted/40 transition-colors flex items-start gap-2.5"
                  >
                    <span className="mt-0.5 shrink-0"><SeverityChip severity={f.severity} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-medium">{f.title}</span>
                      <span className="block text-[11.5px] text-muted-foreground mt-0.5 line-clamp-2 leading-snug">{f.explanation}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
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
                    onClick={() => onOverride(s.keys, s.isTrueRevenue ? 'non_revenue' : 'revenue')}
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
  onDecision: (id: string, confirmed: boolean | null) => void;
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
            {p.userConfirmed === true && <Badge variant="success">Confirmed</Badge>}
            {p.userConfirmed === false && <Badge variant="outline">Rejected</Badge>}
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
          {p.userConfirmed !== true && (
            <Button variant="outline" className="h-7 px-2 text-[11.5px]" onClick={() => onDecision(p.id, true)}>Confirm</Button>
          )}
          {p.userConfirmed !== false && (
            <Button variant="outline" className="h-7 px-2 text-[11.5px]" onClick={() => onDecision(p.id, false)}>Reject</Button>
          )}
          {p.userConfirmed !== null && (
            <Button variant="outline" className="h-7 px-2 text-[11.5px]" onClick={() => onDecision(p.id, null)} title="Clear decision">
              <RotateCcw className="h-3 w-3" />
            </Button>
          )}
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

export function TransactionsPanel({ file, onDrill, onOverride, onResetOverride }: PanelProps) {
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
    { key: 'bank_event', label: 'NSF' },
    { key: 'non_revenue', label: 'Transfers' },
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
          <div className="flex flex-wrap gap-1.5 ml-auto">
            {(['revenue', 'non_revenue', 'mca_payment', 'mca_funding', 'collection', 'ignored'] as TxnClass[]).map((c) => (
              <Button key={c} variant="outline" className="h-7 px-2 text-[11.5px]" onClick={() => bulk(c)}>
                Mark {TXN_CLASS_LABEL[c].toLowerCase()}
              </Button>
            ))}
            <Button variant="outline" className="h-7 px-2 text-[11.5px]" onClick={() => { onResetOverride(Array.from(selected)); setSelected(new Set()); }}>
              <RotateCcw className="h-3 w-3 mr-1" /> Auto
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
