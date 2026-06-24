'use client';

import * as React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, Button, Input, Field, PageHeader, Badge, MoneyInput } from '@/components/ui/primitives';
import { formatCurrency, cn } from '@/lib/utils';
import { Calculator, RotateCcw, Sparkles, Lock, Unlock } from 'lucide-react';

type Tab = 'fwd' | 'rev';
type Freq = 'daily' | 'weekly';

// MCA industry constants (per JJ's spec)
const BUSINESS_DAYS_PER_WEEK = 5;
const WEEKS_PER_MONTH = 4;
const WEEKS_PER_YEAR = 52;
const BUSINESS_DAYS_PER_MONTH = BUSINESS_DAYS_PER_WEEK * WEEKS_PER_MONTH; // 20
const BUSINESS_DAYS_PER_YEAR = BUSINESS_DAYS_PER_WEEK * WEEKS_PER_YEAR;   // 260

export default function CalculatorPage() {
  const [tab, setTab] = useState<Tab>('fwd');
  const [commissionRules, setCommissionRules] = useState<{ threshold: number; commissionPct: number }[]>([]);

  useEffect(() => {
    fetch('/api/settings/commission-rules')
      .then((r) => r.json())
      .then((j) => {
        const rules = (j.rules ?? j.data ?? []).map((r: { threshold: number | string; commissionPct: number | string }) => ({
          threshold: Number(r.threshold),
          commissionPct: Number(r.commissionPct),
        }));
        setCommissionRules(rules);
      })
      .catch(() => setCommissionRules([]));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calculator"
        description="Forward MCA calculations and reverse-engineer offers from observed deposits + payments."
      />

      <div className="inline-flex bg-card border border-border rounded-lg p-1">
        {([
          { k: 'fwd', label: 'Deal Calculator', icon: Calculator },
          { k: 'rev', label: 'Merchant Funding Estimator', icon: RotateCcw },
        ] as const).map(({ k, label, icon: Icon }) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition',
              tab === k ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'fwd' ? <ForwardCalc rules={commissionRules} /> : <ReverseCalc />}
    </div>
  );
}

/* ============================================================
   FORWARD CALCULATOR
   ============================================================ */

function ForwardCalc({ rules }: { rules: { threshold: number; commissionPct: number }[] }) {
  const [funding, setFunding] = useState<number | ''>('');
  const [factorRate, setFactorRate] = useState('');
  const [origPct, setOrigPct] = useState('');
  const [nPay, setNPay] = useState('');
  const [freq, setFreq] = useState<Freq>('daily');

  const fund = funding === '' ? 0 : funding;
  const fr = parseFloat(factorRate) || 0;
  const orig = parseFloat(origPct) || 0;
  const n = parseFloat(nPay) || 0;

  // Math (true MCA structure: 5 business days/wk)
  const payback = fund * fr;
  const fee = fund * (orig / 100);
  const net = fund - fee;
  const totalCost = payback - fund;

  // Term in business days (always)
  const termBusinessDays = freq === 'daily' ? n : n * BUSINESS_DAYS_PER_WEEK;
  const termWeeks = termBusinessDays / BUSINESS_DAYS_PER_WEEK;
  const termMonths = termBusinessDays / BUSINESS_DAYS_PER_MONTH;

  // Per-payment amount
  const paymentAmount = n ? payback / n : 0;

  // Daily / weekly / monthly equivalents (for both directions of view)
  const dailyEquiv = termBusinessDays > 0 ? payback / termBusinessDays : 0;
  const weeklyEquiv = termWeeks > 0 ? payback / termWeeks : 0;
  const monthlyEquiv = termMonths > 0 ? payback / termMonths : 0;

  // Commission from rules table (descending walk)
  let commissionPct = 0;
  if (rules.length && fr > 0) {
    const sorted = [...rules].sort((a, b) => a.threshold - b.threshold);
    if (fr >= sorted[0].threshold) {
      for (const r of sorted) {
        if (fr >= r.threshold) commissionPct = r.commissionPct;
      }
    }
  }
  const commission = fund * (commissionPct / 100);

  function clear() {
    setFunding('');
    setFactorRate('');
    setOrigPct('');
    setNPay('');
  }

  const fmt = (x: number) => (!isFinite(x) || !x ? '—' : formatCurrency(x));
  const termLabel = !n
    ? '—'
    : `${termBusinessDays} business days · ${termWeeks.toFixed(1)} weeks · ${termMonths.toFixed(2)} months`;

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {/* Inputs (2 cols on lg) */}
      <div className="lg:col-span-2">
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Inputs</div>
              <Button variant="ghost" size="sm" onClick={clear}>Clear</Button>
            </div>

            <Field label="Funding amount">
              <MoneyInput
                value={funding}
                onValueChange={setFunding}
                decimals={2}
                placeholder="100,000.00"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Factor rate">
                <Input
                  type="number"
                  step="0.001"
                  placeholder="1.45"
                  value={factorRate}
                  onChange={(e) => setFactorRate(e.target.value)}
                />
              </Field>
              <Field label="Origination fee %">
                <Input
                  type="number"
                  step="0.1"
                  placeholder="3"
                  value={origPct}
                  onChange={(e) => setOrigPct(e.target.value)}
                />
              </Field>
            </div>

            <Field label="Number of payments">
              <Input
                type="number"
                placeholder={freq === 'daily' ? '100' : '20'}
                value={nPay}
                onChange={(e) => setNPay(e.target.value)}
              />
            </Field>

            <Field label="Payment frequency">
              <div className="grid grid-cols-2 gap-2">
                {(['daily', 'weekly'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setFreq(m)}
                    className={cn(
                      'px-4 py-2.5 rounded border-2 text-sm font-medium transition',
                      freq === m
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                    )}
                  >
                    {m === 'daily' ? 'Daily (M–F)' : 'Weekly'}
                  </button>
                ))}
              </div>
            </Field>

            <div className="text-[10px] text-muted-foreground/80 leading-relaxed pt-2 border-t border-border">
              MCA standard: 5 business days/week · 4 weeks/month · 52 weeks/year
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Results (3 cols on lg) */}
      <div className="lg:col-span-3 space-y-4">
        {/* Top KPIs */}
        <div className="grid grid-cols-3 gap-3">
          <Kpi label={`Payment / ${freq === 'daily' ? 'day' : 'week'}`} value={fmt(paymentAmount)} primary />
          <Kpi label="Total payback" value={fmt(payback)} />
          <Kpi label="Net to merchant" value={fmt(net)} />
        </div>

        {/* Detail rows */}
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            <Row label="Funding amount" value={fmt(fund)} />
            <Row label="Origination fee" value={fmt(fee)} hint={orig ? `${orig}%` : undefined} />
            <Row label="Total cost of capital" value={fmt(totalCost)} />
            <Row label="Term length" value={termLabel} />
            <Row label="Daily payment equivalent"  value={fmt(dailyEquiv)} hint="payback ÷ business days" />
            <Row label="Weekly payment equivalent" value={fmt(weeklyEquiv)} hint="payback ÷ weeks" />
            <Row label="Monthly payment equivalent" value={fmt(monthlyEquiv)} hint="payback ÷ months" />
            <Row label="Commission %" value={commissionPct ? `${commissionPct.toFixed(1)}%` : '—'} />
            <Row label="Commission $" value={fmt(commission)} bold />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ============================================================
   REVERSE CALCULATOR — interactive sliders
   ============================================================ */

function ReverseCalc() {
  // Observed inputs
  const [deposit, setDeposit] = useState<number | ''>('');
  const [payment, setPayment] = useState<number | ''>('');
  const [freq, setFreq] = useState<Freq>('daily');

  // Adjustable assumptions (sliders)
  const [factorRate, setFactorRate] = useState(1.40);
  const [feePct, setFeePct] = useState(5);
  const [termWeeks, setTermWeeks] = useState(20);
  const [autoSync, setAutoSync] = useState(true); // when one slider moves, recalc one of the others

  // Lock controls — when ON, Suggest Clean cannot change that variable.
  // Per the spec the user can also "lock" Funding Amount and Payment Amount,
  // which here are the observed `deposit` and `payment` inputs. Locking those
  // is decorative because Suggest Clean never modifies them anyway — but the
  // lock toggles still render so the lock UI feels complete.
  const [lockFactor, setLockFactor] = useState(false);
  const [lockFee, setLockFee] = useState(false);
  const [lockTerm, setLockTerm] = useState(false);
  const [lockDeposit, setLockDeposit] = useState(false);
  const [lockPayment, setLockPayment] = useState(false);

  const dep = deposit === '' ? 0 : deposit;
  const pmt = payment === '' ? 0 : payment;

  // Estimated funded amount = deposit ÷ (1 - feePct/100)
  const estFunded = feePct < 100 ? dep / (1 - feePct / 100) : 0;
  const fee = estFunded - dep;

  // Term in business days
  const termBusinessDays = termWeeks * BUSINESS_DAYS_PER_WEEK;

  // Predicted payback from funded × factor
  const predictedPayback = estFunded * factorRate;

  // Predicted payment amount based on factor + term
  const predictedPaymentAmount = freq === 'daily'
    ? (termBusinessDays > 0 ? predictedPayback / termBusinessDays : 0)
    : (termWeeks > 0 ? predictedPayback / termWeeks : 0);

  // Match Quality — payment-driven per spec. Payment accuracy is dominant
  // (90% of the score); funding-amount roundness/realism contributes the
  // remaining 10%. Other variables (factor/term/fee) feed INTO the payment
  // calculation so they're implicitly weighted via their effect on the
  // predicted payment — no need to score them separately.
  //
  // Heavily penalize large payment variance per spec: if predicted payment
  // is more than 5% off entered, the score drops fast (no chance of showing
  // "Strong" when the structure clearly doesn't reproduce the observed payment).
  const matchDetail = useMemo(() => {
    if (!dep || !pmt) return null;
    const dollarDiff = predictedPaymentAmount - pmt;
    const pctDiff = pmt > 0 ? (dollarDiff / pmt) * 100 : 0;
    const absPct = Math.abs(pctDiff);
    // Steep payment-driven score: exact match = 100; 5% off ≈ 75;
    // 10% off ≈ 50; 25% off ≈ 0. Power curve so small errors are
    // visible but the score collapses fast for big errors.
    let paymentScore: number;
    if (absPct <= 0.5) paymentScore = 100;
    else if (absPct >= 25) paymentScore = 0;
    else paymentScore = Math.max(0, 100 - Math.pow(absPct / 5, 1.4) * 25);
    // Funding realism (round numbers — 10% weight).
    const nearest10k = Math.round(estFunded / 10000) * 10000;
    const fundingDelta = estFunded > 0 ? Math.abs(estFunded - nearest10k) / estFunded : 1;
    const fundingScore = fundingDelta < 0.01 ? 100 : fundingDelta < 0.025 ? 90 : fundingDelta < 0.05 ? 75 : 60;
    const score = Math.round(paymentScore * 0.9 + fundingScore * 0.1);
    return { score, dollarDiff, pctDiff, paymentScore: Math.round(paymentScore) };
  }, [dep, pmt, predictedPaymentAmount, estFunded]);

  const cleanScore = matchDetail?.score ?? null;

  // When user changes deposit/payment, solve for the EXACT term that makes
  // the predicted payment match the observed payment to the penny. Given
  // funded = deposit / (1 - fee%), payback = funded × factor, payment =
  // payback / term, the exact term is:
  //
  //   daily:   termWeeks = (funded × factor) / (payment × BUSINESS_DAYS_PER_WEEK)
  //   weekly:  termWeeks = (funded × factor) / payment
  //
  // No rounding — the slider step is fine enough (0.1 wks) and the inline
  // numeric input accepts arbitrary decimals so the user gets penny-exact.
  useEffect(() => {
    if (!autoSync || !dep || !pmt) return;
    if (lockTerm) return; // user has frozen term; leave it alone
    const funded = dep / (1 - feePct / 100);
    const estPayback = funded * factorRate;
    const estWks = freq === 'daily'
      ? estPayback / (pmt * BUSINESS_DAYS_PER_WEEK)
      : estPayback / pmt;
    if (estWks > 4 && estWks < 60) {
      // Round to whole weeks — the slider now uses integer week increments
      // so users see clean values (24 wks, not 23.7).
      setTermWeeks(Math.round(estWks));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep, pmt, freq]); // intentionally NOT autoSync/factorRate/feePct — those are user-driven

  function reset() {
    setDeposit('');
    setPayment('');
    setFactorRate(1.40);
    setFeePct(5);
    setTermWeeks(20);
  }

  const [suggestions, setSuggestions] = useState<
    { factor: number; fee: number; termWeeks: number; score: number; predictedPayment: number; impliedFunded: number }[]
  >([]);

  function scoreStructure(factor: number, fee: number, termWks: number): { score: number; predictedPayment: number; impliedFunded: number } {
    const funded = fee < 100 ? dep / (1 - fee / 100) : 0;
    const payback = funded * factor;
    const tBizDays = termWks * BUSINESS_DAYS_PER_WEEK;
    const predictedPayment = freq === 'daily'
      ? (tBizDays > 0 ? payback / tBizDays : 0)
      : (termWks > 0 ? payback / termWks : 0);
    const paymentDelta = pmt > 0 ? Math.abs(predictedPayment - pmt) / pmt : 1;
    const score = Math.max(0, Math.round(100 - paymentDelta * 100));
    return { score, predictedPayment, impliedFunded: funded };
  }

  // How "natural" is an implied funded amount? Rewards round numbers a real
  // funder would actually write: nearest $5K/$10K. Net $95K @ 5% → $100,000
  // (perfectly round) beats an odd structure that implies $98,420 funded.
  function roundnessBonus(funded: number): number {
    if (funded <= 0) return 0;
    const nearest5k = Math.round(funded / 5000) * 5000;
    const nearest10k = Math.round(funded / 10000) * 10000;
    const d5 = Math.abs(funded - nearest5k) / funded;
    const d10 = Math.abs(funded - nearest10k) / funded;
    // within ~1% of a round 10k → big bonus; of a round 5k → smaller bonus
    if (d10 < 0.01) return 12;
    if (d5 < 0.01) return 7;
    if (d10 < 0.025) return 4;
    return 0;
  }

  // Common MCA fee preference (lower, standard fees first).
  const FEE_PRIORITY: Record<number, number> = { 2: 6, 3: 5, 5: 6, 7: 3, 10: 2, 12: 0, 15: -2 };

  function snapToClean() {
    if (!dep || !pmt) return;
    // Candidate space: when a variable is locked, the candidate list for that
    // variable becomes a single-element array containing the current value.
    // This guarantees Suggest Clean cannot change a locked field while still
    // letting it optimize whatever is unlocked.
    const cleanFactors = lockFactor ? [factorRate] : [1.25, 1.30, 1.35, 1.40, 1.45, 1.49, 1.50];
    const cleanFees = lockFee ? [feePct] : [2, 3, 5, 7, 10, 12, 15];
    const cleanTerms = lockTerm ? [termWeeks] : [10, 12, 16, 20, 24, 30, 40, 52];

    const candidates: { factor: number; fee: number; termWeeks: number; score: number; predictedPayment: number; impliedFunded: number; rank: number }[] = [];
    for (const factor of cleanFactors) {
      for (const fee of cleanFees) {
        for (const t of cleanTerms) {
          const s = scoreStructure(factor, fee, t);
          // STRICT minimum: only show predictions that hit the merchant's
          // target payment within 5%. Per JJ's spec, suggestions below 95%
          // accuracy are useless noise — better to show fewer high-quality
          // matches than pad the list with stale guesses. We keep a slightly
          // looser fallback (90%) when EVERY variable is locked so the
          // matcher can still surface something rather than nothing.
          const minScore = (lockFactor && lockFee && lockTerm) ? 90 : 95;
          if (s.score < minScore) continue;
          // Final rank = payment accuracy + realism (round funded + common fee).
          const rank = s.score + roundnessBonus(s.impliedFunded) + (FEE_PRIORITY[fee] ?? 0);
          candidates.push({ factor, fee, termWeeks: t, ...s, rank });
        }
      }
    }
    // Sort:
    //   1. Exact (100%) matches first — those are perfect payment hits.
    //   2. Then by realism-weighted rank within the same accuracy bucket.
    //   3. Tie-break by raw payment score.
    candidates.sort((a, b) => {
      const aExact = a.score === 100 ? 1 : 0;
      const bExact = b.score === 100 ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      return (b.rank - a.rank) || (b.score - a.score);
    });
    // Take the top 4 — per spec, four options is the sweet spot for the
    // broker (was 5 before; 4 keeps the picker scannable without scrolling).
    const top: typeof candidates = [];
    for (const c of candidates) {
      if (top.length >= 4) break;
      if (top.some((t) => t.fee === c.fee && Math.abs(t.factor - c.factor) < 0.001 && Math.abs(t.termWeeks - c.termWeeks) <= 2)) continue;
      top.push(c);
    }
    setSuggestions(top.map(({ factor, fee, termWeeks, score, predictedPayment, impliedFunded }) => ({ factor, fee, termWeeks, score, predictedPayment, impliedFunded })));
    if (top[0]) {
      // Only apply changes to UNLOCKED variables — locked stays put.
      if (!lockFactor) setFactorRate(top[0].factor);
      if (!lockFee) setFeePct(top[0].fee);
      if (!lockTerm) setTermWeeks(top[0].termWeeks);
    }
  }

  function applySuggestion(s: { factor: number; fee: number; termWeeks: number }) {
    setFactorRate(s.factor);
    setFeePct(s.fee);
    setTermWeeks(s.termWeeks);
  }

  const fmt = (x: number) => (!isFinite(x) || !x ? '—' : formatCurrency(x));

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {/* Inputs + sliders */}
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Observed</div>
              <Button variant="ghost" size="sm" onClick={reset}>Reset</Button>
            </div>

            <div className="rounded bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
              Enter what you can see — the bank deposit and the payment going out. Then adjust the sliders to find the most likely MCA structure.
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                Deposit seen
                <LockToggle locked={lockDeposit} onToggle={() => setLockDeposit((v) => !v)} title="Lock funding amount" />
              </div>
              <MoneyInput
                value={deposit}
                onValueChange={setDeposit}
                decimals={2}
                placeholder="95,000.00"
              />
              <div className="text-xs text-muted-foreground">Net wired to merchant</div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                Payment amount
                <LockToggle locked={lockPayment} onToggle={() => setLockPayment((v) => !v)} title="Lock payment amount" />
              </div>
              <MoneyInput
                value={payment}
                onValueChange={setPayment}
                decimals={2}
                placeholder={freq === 'daily' ? '710.00' : '3,550.00'}
              />
              <div className="text-xs text-muted-foreground">Per {freq === 'daily' ? 'business day' : 'week'}</div>
            </div>

            <Field label="Payment frequency">
              <div className="grid grid-cols-2 gap-2">
                {(['daily', 'weekly'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setFreq(m)}
                    className={cn(
                      'px-3 py-2 rounded border-2 text-sm font-medium transition',
                      freq === m
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {m === 'daily' ? 'Daily' : 'Weekly'}
                  </button>
                ))}
              </div>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Adjust assumptions</div>
              <Button variant="outline" size="sm" onClick={snapToClean} className="gap-1.5">
                <Sparkles className="h-3 w-3" />
                Suggest clean structures
              </Button>
            </div>

            {suggestions.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
                  Possible structures — tap to apply
                </div>
                {suggestions.map((s, i) => {
                  const active = s.factor === factorRate && s.fee === feePct && s.termWeeks === termWeeks;
                  return (
                    <button
                      key={i}
                      onClick={() => applySuggestion(s)}
                      className={cn(
                        'w-full flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs transition text-left',
                        active ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-foreground/30'
                      )}
                    >
                      <span className="tabular-nums">
                        {s.factor.toFixed(2)}× · {s.fee}% fee · {s.termWeeks}wk
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground tabular-nums">
                          ≈ {formatCurrency(s.predictedPayment)}/{freq === 'daily' ? 'day' : 'wk'}
                        </span>
                        <Badge
                          variant={s.score === 100 ? 'success' : s.score >= 98 ? 'warning' : 'outline'}
                          className="text-[10px] tabular-nums"
                        >
                          {s.score === 100 ? '100% exact' : `${s.score}%`}
                        </Badge>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-muted-foreground">Factor rate</div>
                <LockToggle locked={lockFactor} onToggle={() => setLockFactor((v) => !v)} title="Lock factor rate" />
              </div>
              <Slider
                label=""
                value={factorRate}
                min={1.10}
                max={1.55}
                step={0.01}
                onChange={setFactorRate}
                format={(v) => v.toFixed(2)}
                cleanValues={[1.30, 1.35, 1.40, 1.45, 1.49]}
                disabled={lockFactor}
                precision={2}
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-muted-foreground">Origination fee %</div>
                <LockToggle locked={lockFee} onToggle={() => setLockFee((v) => !v)} title="Lock origination fee" />
              </div>
              <Slider
                label=""
                value={feePct}
                min={0}
                max={15}
                step={0.5}
                onChange={setFeePct}
                format={(v) => `${v.toFixed(1)}%`}
                cleanValues={[3, 5, 7, 10]}
                disabled={lockFee}
                precision={1}
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-muted-foreground">Term (weeks)</div>
                <LockToggle locked={lockTerm} onToggle={() => setLockTerm((v) => !v)} title="Lock term" />
              </div>
              <Slider
                label=""
                value={termWeeks}
                min={4}
                max={60}
                step={1}
                onChange={setTermWeeks}
                format={(v) => `${v.toFixed(0)} wks`}
                cleanValues={[10, 12, 16, 20, 24, 30, 40]}
                disabled={lockTerm}
                precision={0}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Results panel */}
      <div className="lg:col-span-3 space-y-4">
        {/* Match quality + key estimates */}
        <div className="grid grid-cols-3 gap-3">
          <Kpi label="Estimated funded" value={fmt(estFunded)} primary />
          <Kpi label="Predicted payment" value={fmt(predictedPaymentAmount)} />
          <Kpi
            label="Match quality"
            value={cleanScore !== null ? `${cleanScore}/100` : '—'}
            tone={cleanScore === null ? undefined : cleanScore >= 75 ? 'success' : cleanScore >= 50 ? 'warning' : 'danger'}
          />
        </div>

        <Card>
          <CardContent className="p-0 divide-y divide-border">
            <Row label="Estimated funded amount" value={fmt(estFunded)} hint="deposit ÷ (1 − fee%)" />
            <Row label="Origination fee" value={fmt(fee)} hint={`${feePct.toFixed(1)}%`} />
            <Row label="Predicted payback" value={fmt(predictedPayback)} hint={`× factor ${factorRate.toFixed(3)}`} />
            <Row label="Term length" value={`${termWeeks} weeks · ${termBusinessDays} business days`} />
            <Row
              label="Predicted payment"
              value={fmt(predictedPaymentAmount)}
              hint={pmt > 0 ? `vs observed ${formatCurrency(pmt)} (${((Math.abs(predictedPaymentAmount - pmt) / pmt) * 100).toFixed(1)}% off)` : undefined}
              bold
            />
          </CardContent>
        </Card>

        {/* Match quality detail — explicit entered vs calculated breakdown */}
        {cleanScore !== null && pmt > 0 && matchDetail && (
          <Card>
            <CardContent className="p-4 space-y-3 text-xs">
              <div className="text-sm font-semibold">Match assessment</div>

              {/* Payment-by-payment comparison. This is the dominant driver
                  of Match Quality per spec — large variance here forces a
                  low score even if other variables look reasonable. */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded border border-border p-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Entered payment</div>
                  <div className="text-sm font-semibold tabular-nums">{formatCurrency(pmt)}</div>
                  <div className="text-[10px] text-muted-foreground">
                    per {freq === 'daily' ? 'business day' : 'week'}
                  </div>
                </div>
                <div className="rounded border border-border p-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Calculated payment</div>
                  <div className="text-sm font-semibold tabular-nums">{formatCurrency(predictedPaymentAmount)}</div>
                  <div className="text-[10px] text-muted-foreground">
                    from factor × funded ÷ term
                  </div>
                </div>
              </div>

              {/* Explicit $ + % difference. Sign preserved so user can see
                  whether the structure over- or under-pays vs reality. */}
              <div className="flex items-center justify-between gap-3 rounded border border-border p-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Difference</div>
                  <div className={cn(
                    'text-sm font-semibold tabular-nums',
                    Math.abs(matchDetail.pctDiff) < 1 ? 'text-emerald-700'
                      : Math.abs(matchDetail.pctDiff) < 5 ? 'text-foreground'
                      : Math.abs(matchDetail.pctDiff) < 15 ? 'text-amber-700'
                      : 'text-rose-700'
                  )}>
                    {matchDetail.dollarDiff >= 0 ? '+' : ''}{formatCurrency(matchDetail.dollarDiff)}
                    {' '}({matchDetail.pctDiff >= 0 ? '+' : ''}{matchDetail.pctDiff.toFixed(1)}%)
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Match score</div>
                  <div className="text-lg font-bold tabular-nums">{cleanScore}<span className="text-xs text-muted-foreground">/100</span></div>
                </div>
              </div>

              {cleanScore >= 75 ? (
                <div className="text-emerald-700">
                  ✓ Strong match — predicted payment is close to entered and assumptions are clean MCA values.
                </div>
              ) : cleanScore >= 50 ? (
                <div className="text-amber-700">
                  ~ Plausible match — adjust the sliders or click <strong>Snap to clean</strong> for a more typical structure.
                </div>
              ) : (
                <div className="text-rose-700">
                  ✗ Weak match — predicted payment is far from entered. Try a different factor rate, term, or fee%.
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   Sub-components
   ============================================================ */

function Kpi({
  label,
  value,
  primary,
  tone,
}: {
  label: string;
  value: string;
  primary?: boolean;
  tone?: 'success' | 'warning' | 'danger';
}) {
  return (
    <div className={cn(
      'rounded-lg border p-4',
      primary ? 'bg-primary/5 border-primary/20' : 'bg-card border-border',
      tone === 'success' && 'bg-emerald-50 border-emerald-200',
      tone === 'warning' && 'bg-amber-50 border-amber-200',
      tone === 'danger' && 'bg-rose-50 border-rose-200',
    )}>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</div>
      <div className={cn(
        'text-xl font-semibold tabular-nums mt-1',
        primary && 'text-primary',
        tone === 'success' && 'text-emerald-700',
        tone === 'warning' && 'text-amber-700',
        tone === 'danger' && 'text-rose-700',
      )}>{value}</div>
    </div>
  );
}

function Row({ label, value, hint, bold }: { label: string; value: string; hint?: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between px-4 py-2.5 gap-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-right">
        <div className={cn('tabular-nums', bold ? 'text-base font-semibold text-primary' : 'text-sm font-medium')}>
          {value}
        </div>
        {hint && <div className="text-[10px] text-muted-foreground/70">{hint}</div>}
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  cleanValues,
  disabled,
  precision,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  cleanValues?: number[];
  disabled?: boolean;
  /** Decimal places for the inline editable number input. Inferred from
   *  `step` if not provided. */
  precision?: number;
}) {
  const pct = ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100;
  const isClean = cleanValues?.some((c) => Math.abs(c - value) < step / 2);

  // Derive decimal places from step if not explicit. `step=0.0001` → 4 places.
  // Lets us render the number input at the right precision without forcing
  // long .0000 tails on integer-stepped sliders.
  const decimalPlaces = precision ?? (() => {
    if (step >= 1) return 0;
    const s = step.toString();
    return s.includes('.') ? s.split('.')[1].length : 0;
  })();

  // Local text state for the inline numeric input. Decoupled from `value`
  // while focused so the user can clear / type fractional digits without
  // the parent's value snapping back.
  const [text, setText] = React.useState<string>(value.toFixed(decimalPlaces));
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => {
    if (!focused) setText(value.toFixed(decimalPlaces));
  }, [value, decimalPlaces, focused]);

  function commitText() {
    const parsed = parseFloat(text);
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(max, Math.max(min, parsed));
      onChange(clamped);
      setText(clamped.toFixed(decimalPlaces));
    } else {
      // Reject — reset to current value
      setText(value.toFixed(decimalPlaces));
    }
  }

  return (
    <div className={disabled ? 'opacity-50' : ''}>
      <div className="flex items-baseline justify-between mb-1.5 gap-2">
        {label ? (
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
        ) : <div />}
        {/* Inline editable number input — types-in the exact value when
            slider granularity isn't enough. Bypasses the slider step so
            penny-precise factor / fee / term values are achievable. */}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value.replace(/[^\d.\-]/g, ''))}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); commitText(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
            }}
            disabled={disabled}
            className={cn(
              'h-6 w-20 rounded border border-input bg-card px-1.5 text-xs text-right tabular-nums',
              'focus:outline-none focus:ring-2 focus:ring-ring/40',
              isClean && 'text-emerald-700 font-semibold'
            )}
          />
          {isClean && <span className="text-[10px] text-emerald-600">★</span>}
        </div>
      </div>

      {/* Track: rendered as background + filled portion + range overlay.
          The native range input gets opacity-0 but covers the whole bar
          so click-and-drag works anywhere on the track. */}
      <div className="relative h-2 bg-muted rounded-full">
        <div
          className="absolute h-full bg-primary rounded-full transition-[width]"
          style={{ width: `${pct}%` }}
        />
        {cleanValues?.map((c) => {
          if (c < min || c > max) return null;
          const cPct = ((c - min) / (max - min)) * 100;
          return (
            <div
              key={c}
              className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3.5 bg-emerald-400/60 rounded-full pointer-events-none"
              style={{ left: `${cPct}%` }}
              title={`Clean: ${format(c)}`}
            />
          );
        })}
        {/* Visual thumb — purely decorative. The real input below handles
            interaction. */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-4 rounded-full bg-card border-2 border-primary shadow-sm pointer-events-none"
          style={{ left: `${pct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          disabled={disabled}
          className="absolute inset-0 w-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          aria-label={label}
        />
      </div>
    </div>
  );
}

/**
 * Small lock icon toggle used next to each calculator field. When locked,
 * Suggest Clean treats that field as fixed and only optimizes the
 * unlocked variables. The Slider component dims and disables when its
 * field is locked, so the user can see at a glance which inputs are
 * being held constant.
 */
function LockToggle({
  locked,
  onToggle,
  title,
}: {
  locked: boolean;
  onToggle: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={title}
      aria-label={title}
      aria-pressed={locked}
      className={cn(
        'h-5 w-5 rounded-full flex items-center justify-center text-[10px] transition-colors',
        locked
          ? 'bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200'
          : 'bg-transparent text-muted-foreground/50 border border-transparent hover:text-foreground hover:border-border'
      )}
    >
      {locked ? '🔒' : '🔓'}
    </button>
  );
}
