'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, Button, Input, Field, PageHeader, Badge, MoneyInput } from '@/components/ui/primitives';
import { formatCurrency, cn } from '@/lib/utils';
import { Calculator, RotateCcw, Sparkles } from 'lucide-react';

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

  // "Cleanness" score — how close are we to a clean MCA structure?
  const cleanScore = useMemo(() => {
    if (!dep || !pmt) return null;

    // Score factors:
    //   - payment match: how close is predicted payment to observed?
    //   - rounded fee %: 3, 5, 7, 10 are clean
    //   - rounded factor: 1.30, 1.35, 1.40, 1.45, 1.50, 1.55 are clean
    //   - rounded term: 10, 12, 16, 20, 24, 30, 40 weeks are clean
    const paymentDelta = pmt > 0 ? Math.abs(predictedPaymentAmount - pmt) / pmt : 1;
    const cleanFactors = [1.30, 1.35, 1.40, 1.45, 1.49, 1.50];
    const factorDelta = Math.min(...cleanFactors.map((f) => Math.abs(factorRate - f)));
    const cleanFees = [3, 5, 7, 10];
    const feeDelta = Math.min(...cleanFees.map((f) => Math.abs(feePct - f)));
    const cleanTerms = [10, 12, 16, 20, 24, 30, 40];
    const termDelta = Math.min(...cleanTerms.map((t) => Math.abs(termWeeks - t)));

    const score = Math.max(0, 100 - (paymentDelta * 60 + factorDelta * 80 + feeDelta * 5 + termDelta * 2));
    return Math.round(score);
  }, [dep, pmt, predictedPaymentAmount, factorRate, feePct, termWeeks]);

  // When user changes deposit/payment, try to find a sensible default
  useEffect(() => {
    if (!autoSync || !dep || !pmt) return;
    // For the current factor + fee, infer term from observed payment
    const funded = dep / (1 - feePct / 100);
    const estPayback = funded * factorRate;
    if (freq === 'daily') {
      const estDays = estPayback / pmt;
      const estWks = estDays / BUSINESS_DAYS_PER_WEEK;
      if (estWks > 4 && estWks < 60) setTermWeeks(Math.round(estWks));
    } else {
      const estWks = estPayback / pmt;
      if (estWks > 4 && estWks < 60) setTermWeeks(Math.round(estWks));
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
    { factor: number; fee: number; termWeeks: number; score: number; predictedPayment: number }[]
  >([]);

  function scoreStructure(factor: number, fee: number, termWks: number): { score: number; predictedPayment: number } {
    const funded = fee < 100 ? dep / (1 - fee / 100) : 0;
    const payback = funded * factor;
    const tBizDays = termWks * BUSINESS_DAYS_PER_WEEK;
    const predictedPayment = freq === 'daily'
      ? (tBizDays > 0 ? payback / tBizDays : 0)
      : (termWks > 0 ? payback / termWks : 0);
    const paymentDelta = pmt > 0 ? Math.abs(predictedPayment - pmt) / pmt : 1;
    const score = Math.max(0, Math.round(100 - paymentDelta * 100));
    return { score, predictedPayment };
  }

  function snapToClean() {
    if (!dep || !pmt) return;
    // Generate candidate clean structures across common factor/fee/term values,
    // score each by how closely it reproduces the observed payment, and show the
    // best several so the user can pick the most likely one.
    const cleanFactors = [1.30, 1.35, 1.40, 1.45, 1.49, 1.50];
    const cleanFees = [3, 5, 7, 10];
    const cleanTerms = [10, 12, 16, 20, 24, 30, 40, 52];

    const candidates: { factor: number; fee: number; termWeeks: number; score: number; predictedPayment: number }[] = [];
    for (const factor of cleanFactors) {
      for (const fee of cleanFees) {
        for (const t of cleanTerms) {
          const { score, predictedPayment } = scoreStructure(factor, fee, t);
          candidates.push({ factor, fee, termWeeks: t, score, predictedPayment });
        }
      }
    }
    // Sort by score desc, dedupe near-identical, keep top 5
    candidates.sort((a, b) => b.score - a.score);
    const top: typeof candidates = [];
    for (const c of candidates) {
      if (top.length >= 5) break;
      // skip if a very similar structure already chosen
      if (top.some((t) => t.factor === c.factor && t.fee === c.fee && Math.abs(t.termWeeks - c.termWeeks) <= 2)) continue;
      top.push(c);
    }
    setSuggestions(top);
    // Apply the best immediately
    if (top[0]) {
      setFactorRate(top[0].factor);
      setFeePct(top[0].fee);
      setTermWeeks(top[0].termWeeks);
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

            <Field label="Deposit seen" hint="Net wired to merchant">
              <MoneyInput
                value={deposit}
                onValueChange={setDeposit}
                decimals={2}
                placeholder="95,000.00"
              />
            </Field>

            <Field label="Payment amount" hint={`Per ${freq === 'daily' ? 'business day' : 'week'}`}>
              <MoneyInput
                value={payment}
                onValueChange={setPayment}
                decimals={2}
                placeholder={freq === 'daily' ? '710.00' : '3,550.00'}
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
                          variant={s.score >= 95 ? 'success' : s.score >= 80 ? 'warning' : 'outline'}
                          className="text-[10px] tabular-nums"
                        >
                          {s.score}%
                        </Badge>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <Slider
              label="Factor rate"
              value={factorRate}
              min={1.10}
              max={1.55}
              step={0.005}
              onChange={setFactorRate}
              format={(v) => v.toFixed(3)}
              cleanValues={[1.30, 1.35, 1.40, 1.45, 1.49]}
            />

            <Slider
              label="Origination fee %"
              value={feePct}
              min={0}
              max={15}
              step={0.5}
              onChange={setFeePct}
              format={(v) => `${v.toFixed(1)}%`}
              cleanValues={[3, 5, 7, 10]}
            />

            <Slider
              label="Term (weeks)"
              value={termWeeks}
              min={4}
              max={60}
              step={1}
              onChange={setTermWeeks}
              format={(v) => `${v} wks (${v * BUSINESS_DAYS_PER_WEEK} days)`}
              cleanValues={[10, 12, 16, 20, 24, 30, 40]}
            />
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

        {/* Match quality detail */}
        {cleanScore !== null && pmt > 0 && (
          <Card>
            <CardContent className="p-4 space-y-2 text-xs">
              <div className="text-sm font-semibold mb-1">Match assessment</div>
              {cleanScore >= 75 ? (
                <div className="text-emerald-700">
                  ✓ Strong match — predicted payment is close to observed and assumptions are clean MCA values.
                </div>
              ) : cleanScore >= 50 ? (
                <div className="text-amber-700">
                  ~ Plausible match — try adjusting the sliders or click <strong>Snap to clean</strong> to find a more typical structure.
                </div>
              ) : (
                <div className="text-rose-700">
                  ✗ Weak match — the predicted payment is far from observed. Try a different factor rate, term, or fee%.
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
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  cleanValues?: number[];
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const isClean = cleanValues?.some((c) => Math.abs(c - value) < step / 2);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className={cn(
          'text-sm font-semibold tabular-nums',
          isClean ? 'text-emerald-600' : 'text-foreground'
        )}>
          {format(value)} {isClean && <span className="text-[10px] ml-1">★</span>}
        </div>
      </div>
      <div className="relative h-1.5 bg-muted rounded-full">
        <div
          className="absolute h-full bg-primary rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
        {cleanValues?.map((c) => {
          if (c < min || c > max) return null;
          const cPct = ((c - min) / (max - min)) * 100;
          return (
            <div
              key={c}
              className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 bg-emerald-400/60 rounded-full"
              style={{ left: `${cPct}%` }}
              title={`Clean: ${format(c)}`}
            />
          );
        })}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
        />
      </div>
    </div>
  );
}
