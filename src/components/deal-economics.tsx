'use client';
/**
 * Live deal-economics strip — drop beneath any funding-details form. As the
 * user types funding amount / factor / term / fee, this recomputes and shows
 * payback, payment, net, cost of capital, and commission instantly. Pure
 * display; never writes anything.
 */
import { useMemo } from 'react';
import { computeEconomics, fmtMoney2, type EconomicsInput } from '@/lib/calculator/economics';
import { cn } from '@/lib/utils';

export function DealEconomics({ input, className }: { input: EconomicsInput; className?: string }) {
  const e = useMemo(() => computeEconomics(input), [input]);
  // Nothing derivable yet → render nothing (don't show a strip of dashes).
  if (e.totalPayback === null && e.feeAmount === null && e.commissionAmount === null) return null;

  const items: { label: string; value: string; strong?: boolean }[] = [];
  if (e.totalPayback !== null) items.push({ label: 'Total payback', value: fmtMoney2(e.totalPayback), strong: true });
  if (e.paymentAmount !== null) {
    items.push({
      label: `Payment${e.paymentLabel ? ` (${e.paymentLabel})` : ''}`,
      value: fmtMoney2(e.paymentAmount),
      strong: true,
    });
  }
  if (e.feeAmount !== null) items.push({ label: 'Fee amount', value: fmtMoney2(e.feeAmount) });
  if (e.netToMerchant !== null && e.feeAmount !== null) items.push({ label: 'Net to merchant', value: fmtMoney2(e.netToMerchant) });
  if (e.costOfCapital !== null) {
    items.push({
      label: 'Cost of capital',
      value: `${fmtMoney2(e.costOfCapital)}${e.costOfCapitalPct !== null ? ` (${e.costOfCapitalPct.toFixed(1)}%)` : ''}`,
    });
  }
  if (e.commissionAmount !== null) items.push({ label: 'Commission', value: fmtMoney2(e.commissionAmount), strong: true });

  return (
    <div className={cn(
      'rounded-lg border border-border bg-muted/25 px-3 py-2.5 flex flex-wrap gap-x-5 gap-y-1.5',
      className
    )}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">{it.label}</div>
          <div className={cn('text-[13px] tabular-nums', it.strong ? 'font-semibold' : 'font-medium')}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}
