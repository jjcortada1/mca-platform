'use client';

import { useState, useEffect } from 'react';
import {
  Card, CardContent, Button, Input, Field,
} from '@/components/ui/primitives';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';

type Tab = 'fwd' | 'rev';

export default function CalculatorPage() {
  const [tab, setTab] = useState<Tab>('fwd');
  const [commissionRules, setCommissionRules] = useState<{ threshold: number; commissionPct: number }[]>([]);

  useEffect(() => {
    fetch('/api/settings/commission-rules')
      .then((r) => r.json())
      .then((j) => setCommissionRules(j.rules ?? j.data ?? []))
      .catch(() => setCommissionRules([]));
  }, []);

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">🧮 Calculator</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Compute deal terms or reverse-engineer an offer from observed deposit and payment.
        </p>
      </header>

      <div className="flex gap-1 bg-card border border-border rounded-lg p-1">
        <button
          onClick={() => setTab('fwd')}
          className={cn(
            'flex-1 px-4 py-2 rounded text-sm font-medium transition',
            tab === 'fwd' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Deal Calculator
        </button>
        <button
          onClick={() => setTab('rev')}
          className={cn(
            'flex-1 px-4 py-2 rounded text-sm font-medium transition',
            tab === 'rev' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Reverse Calculator
        </button>
      </div>

      {tab === 'fwd' ? <ForwardCalc rules={commissionRules} /> : <ReverseCalc />}
    </div>
  );
}

function ForwardCalc({ rules }: { rules: { threshold: number; commissionPct: number }[] }) {
  const [funding, setFunding] = useState('');
  const [factorRate, setFactorRate] = useState('');
  const [origPct, setOrigPct] = useState('');
  const [nPay, setNPay] = useState('');
  const [freq, setFreq] = useState<'daily' | 'weekly'>('daily');

  const fund = parseFloat(funding) || 0;
  const fr = parseFloat(factorRate) || 0;
  const orig = parseFloat(origPct) || 0;
  const n = parseFloat(nPay) || 0;

  const payback = fund * fr;
  const fee = fund * (orig / 100);
  const net = fund - fee;
  const payment = n ? payback / n : 0;
  const totalCost = payback - fund;
  const termDays = freq === 'daily' ? n : n * 7;
  const termStr = !n ? '—' : termDays >= 7 ? `${Math.round(termDays / 7)} weeks (${termDays} days)` : `${termDays} days`;

  // Calc commission from rules — find highest threshold ≤ factor rate
  let commissionPct = 0;
  if (rules.length && fr > 0) {
    const sorted = [...rules].sort((a, b) => a.threshold - b.threshold);
    for (const r of sorted) {
      if (fr >= r.threshold) commissionPct = r.commissionPct;
    }
  }
  const commission = fund * (commissionPct / 100);

  function clear() {
    setFunding(''); setFactorRate(''); setOrigPct(''); setNPay('');
  }

  const fmt = (n: number) => isNaN(n) || !isFinite(n) || !n ? '—' : formatCurrency(n);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-semibold">Deal Calculator</div>
              <div className="text-xs text-muted-foreground mt-0.5">Results update instantly</div>
            </div>
            <Button variant="ghost" size="sm" onClick={clear}>Clear</Button>
          </div>
          <Field label="Funding Amount ($)">
            <Input type="number" placeholder="e.g. 100000" value={funding} onChange={(e) => setFunding(e.target.value)} />
          </Field>
          <Field label="Factor Rate">
            <Input type="number" step="0.001" placeholder="e.g. 1.45" value={factorRate} onChange={(e) => setFactorRate(e.target.value)} />
          </Field>
          <Field label="Origination Fee (%)">
            <Input type="number" step="0.1" placeholder="e.g. 3" value={origPct} onChange={(e) => setOrigPct(e.target.value)} />
          </Field>
          <Field label="Number of Payments">
            <Input type="number" placeholder="e.g. 100" value={nPay} onChange={(e) => setNPay(e.target.value)} />
          </Field>
          <Field label="Payment Frequency">
            <div className="flex gap-2">
              {(['daily', 'weekly'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setFreq(m)}
                  className={cn(
                    'flex-1 px-4 py-2 rounded border-2 text-sm font-medium transition',
                    freq === m ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground'
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
        <CardContent className="p-5 space-y-1">
          <div className="text-base font-semibold mb-3">Results</div>
          <Row label="Payback Amount" value={fmt(payback)} />
          <Row label="Net Funded (after fee)" value={fmt(net)} />
          <Row label="Origination Fee" value={fmt(fee)} />
          <Row label={`Payment Per ${freq === 'daily' ? 'Day' : 'Week'}`} value={fmt(payment)} bold />
          <Row label="Total Cost of Capital" value={fmt(totalCost)} />
          <Row label="Term Length" value={termStr} />
          <div className="border-t border-border my-2" />
          <Row label="Commission %" value={commissionPct ? `${commissionPct.toFixed(1)}%` : '—'} />
          <Row label="Commission $" value={fmt(commission)} />
        </CardContent>
      </Card>
    </div>
  );
}

function ReverseCalc() {
  const [deposit, setDeposit] = useState('');
  const [payment, setPayment] = useState('');
  const [freq, setFreq] = useState<'daily' | 'weekly'>('daily');
  const [periods, setPeriods] = useState('');
  const [funded, setFunded] = useState('');

  const dep = parseFloat(deposit) || 0;
  const pmt = parseFloat(payment) || 0;
  const userPeriods = parseFloat(periods) || 0;
  const userFunded = parseFloat(funded) || 0;

  // Estimate funded amount from deposit if not provided
  // Origination fees are typically 3-7% of funded — so deposit is ~95% of funded
  const estFunded = userFunded || (dep > 0 ? dep / 0.95 : 0);

  // Estimate factor rate
  // Try a range of factor rates and find the one that best fits a 100-150 day daily / 16-26 week weekly term
  // If user provided periods, use those directly
  let bestFr = 0, bestPeriods = 0, bestPayback = 0;
  if (estFunded > 0 && pmt > 0) {
    if (userPeriods > 0) {
      bestPeriods = userPeriods;
      bestPayback = pmt * userPeriods;
      bestFr = bestPayback / estFunded;
    } else {
      // Try common factor rates 1.20 - 1.55, find the one with most "natural" term length
      let bestScore = Infinity;
      for (let fr = 1.20; fr <= 1.55; fr += 0.005) {
        const payback = estFunded * fr;
        const periods = payback / pmt;
        // Prefer terms 80-150 daily / 16-30 weekly
        const target = freq === 'daily' ? 110 : 22;
        const score = Math.abs(periods - target) + Math.abs(periods - Math.round(periods)) * 5;
        if (score < bestScore) {
          bestScore = score;
          bestFr = fr;
          bestPeriods = periods;
          bestPayback = payback;
        }
      }
    }
  }

  const fee = estFunded - dep;
  const feePct = estFunded > 0 ? (fee / estFunded) * 100 : 0;
  const totalCost = bestPayback - estFunded;
  const termDays = freq === 'daily' ? bestPeriods : bestPeriods * 7;
  const termStr = !bestPeriods ? '—' : termDays >= 7 ? `${Math.round(termDays / 7)} weeks (${Math.round(termDays)} days)` : `${Math.round(termDays)} days`;

  function clear() {
    setDeposit(''); setPayment(''); setPeriods(''); setFunded('');
  }

  const fmt = (n: number) => isNaN(n) || !isFinite(n) || !n ? '—' : formatCurrency(n);
  const fmtR = (n: number) => isNaN(n) || !isFinite(n) || !n ? '—' : n.toFixed(3);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-semibold">Reverse MCA Calculator</div>
              <div className="text-xs text-muted-foreground mt-0.5">Figure out the deal from what you can see</div>
            </div>
            <Button variant="ghost" size="sm" onClick={clear}>Clear</Button>
          </div>

          <div className="rounded bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
            Example: $95K deposit, $5,950/week payments for ~32 weeks. Enter what you know, calculator estimates the rest.
          </div>

          <Field label="Deposit Seen in Bank ($)" hint="What you see deposited from the funder">
            <Input type="number" placeholder="e.g. 95000" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
          </Field>
          <Field label="Payment Amount ($)" hint="Daily or weekly payment going out">
            <Input type="number" placeholder="e.g. 5950" value={payment} onChange={(e) => setPayment(e.target.value)} />
          </Field>
          <Field label="Payment Frequency">
            <div className="flex gap-2">
              {(['daily', 'weekly'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setFreq(m)}
                  className={cn(
                    'flex-1 px-4 py-2 rounded border-2 text-sm font-medium transition',
                    freq === m ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  {m === 'daily' ? 'Daily' : 'Weekly'}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Number of Payments (optional)" hint="Leave blank to estimate">
            <Input type="number" placeholder="e.g. 32" value={periods} onChange={(e) => setPeriods(e.target.value)} />
          </Field>
          <Field label="Funded Amount (optional)" hint="Leave blank to estimate from deposit">
            <Input type="number" placeholder="e.g. 100000" value={funded} onChange={(e) => setFunded(e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-1">
          <div className="text-base font-semibold mb-3">Estimated Deal</div>
          <Row label="Estimated Funded Amount" value={fmt(estFunded)} bold />
          <Row label="Estimated Origination Fee" value={fmt(fee)} />
          <Row label="Estimated Fee %" value={feePct ? `${feePct.toFixed(1)}%` : '—'} />
          <div className="border-t border-border my-2" />
          <Row label="Estimated Factor Rate" value={fmtR(bestFr)} bold />
          <Row label="Estimated Payback" value={fmt(bestPayback)} />
          <Row label="Total Cost of Capital" value={fmt(totalCost)} />
          <Row label="Term Length" value={termStr} />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-border last:border-0">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={cn(
        'tabular-nums',
        bold ? 'text-base font-bold text-primary' : 'text-sm font-medium'
      )}>{value}</div>
    </div>
  );
}
