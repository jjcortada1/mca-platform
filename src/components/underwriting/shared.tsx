'use client';

import { useEffect } from 'react';
import { Badge } from '@/components/ui/primitives';
import { X } from 'lucide-react';
import type { UwTransaction } from '@/lib/underwriting/workstation';
import { TXN_CLASS_LABEL } from '@/lib/underwriting/workstation';
import type { ConfidenceLevel } from '@/lib/underwriting/dictionaries';
import { CONFIDENCE_LABEL } from '@/lib/underwriting/dictionaries';

/**
 * Shared building blocks for the underwriting workstation.
 *
 * The visual language is deliberately institutional: dense rows, tabular
 * figures, hairline rules, one accent colour per meaning. Money is the
 * content, so nothing decorative competes with it.
 */

/* ───────────────────────── formatters ───────────────────────── */

export function money(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function percent(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(decimals)}%`;
}

export function shortDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!y || !m || !d) return iso;
  return `${names[m - 1]} ${d}`;
}

export function longDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!y || !m || !d) return iso;
  return `${names[m - 1]} ${d}, ${y}`;
}

/* ───────────────────────── tone system ───────────────────────── */

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

export const TONE_TEXT: Record<Tone, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-rose-600 dark:text-rose-400',
  neutral: 'text-foreground',
};

/* ───────────────────────── metric card ───────────────────────── */

/**
 * One number, its label, and a one-line note. Clickable when the metric
 * has a derivation worth showing — an underwriter who can't audit the
 * number won't trust it.
 */
export function Metric({
  label, value, note, tone = 'neutral', onClick, emphasis = false,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: Tone;
  onClick?: () => void;
  emphasis?: boolean;
}) {
  const interactive = Boolean(onClick);
  return (
    <div
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick!(); } } : undefined}
      className={[
        'border border-border bg-card px-3.5 py-3 rounded-md',
        interactive ? 'cursor-pointer hover:border-foreground/25 hover:bg-muted/30 transition-colors' : '',
      ].join(' ')}
    >
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground leading-none">
        {label}
      </div>
      <div className={`mt-2 font-semibold tabular-nums leading-none ${emphasis ? 'text-[26px]' : 'text-[19px]'} ${TONE_TEXT[tone]}`}>
        {value}
      </div>
      {note && <div className="mt-1.5 text-[11px] text-muted-foreground leading-snug">{note}</div>}
    </div>
  );
}

/* ───────────────────────── section frame ───────────────────────── */

export function Section({
  title, subtitle, actions, children, dense = false,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  dense?: boolean;
}) {
  return (
    <section className="border border-border bg-card rounded-md">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-border">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </header>
      <div className={dense ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

/* ───────────────────────── chips ───────────────────────── */

export function ConfidenceChip({ level }: { level: ConfidenceLevel }) {
  const variant = level === 'high' ? 'success' : level === 'likely' ? 'default' : level === 'possible' ? 'warning' : 'outline';
  return <Badge variant={variant as any}>{CONFIDENCE_LABEL[level]}</Badge>;
}

export function SeverityChip({ severity }: { severity: 'high' | 'medium' | 'low' | 'info' }) {
  const map = {
    high: { v: 'destructive', t: 'High risk' },
    medium: { v: 'warning', t: 'Medium' },
    low: { v: 'default', t: 'Low' },
    info: { v: 'outline', t: 'Info' },
  } as const;
  const m = map[severity];
  return <Badge variant={m.v as any}>{m.t}</Badge>;
}

export function ClassChip({ cls }: { cls: UwTransaction['cls'] }) {
  const variant =
    cls === 'revenue' ? 'success'
      : cls === 'mca_payment' ? 'destructive'
        : cls === 'mca_funding' ? 'warning'
          : cls === 'collection' ? 'destructive'
            : cls === 'ignored' ? 'outline'
              : 'default';
  return <Badge variant={variant as any}>{TXN_CLASS_LABEL[cls]}</Badge>;
}

/* ───────────────────────── drill-down drawer ───────────────────────── */

export interface DrillDown {
  title: string;
  /** The arithmetic, shown before the evidence. */
  derivation?: { label: string; value: string; muted?: boolean }[];
  /** Free-text explanation of the rule or calculation. */
  explanation?: string;
  transactions?: UwTransaction[];
}

/**
 * The "how did you get this number?" panel.
 *
 * Every metric that can be drilled into opens this: the arithmetic first,
 * then the exact transactions behind it. This is the difference between a
 * tool an underwriter trusts and one they re-check by hand.
 */
export function DrillDownPanel({ drill, onClose }: { drill: DrillDown | null; onClose: () => void }) {
  useEffect(() => {
    if (!drill) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drill, onClose]);

  if (!drill) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div className="relative h-full w-full max-w-2xl bg-card border-l border-border shadow-xl flex flex-col">
        <header className="flex items-start justify-between gap-3 px-5 py-3.5 border-b border-border shrink-0">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold tracking-tight">{drill.title}</h3>
            <p className="text-[11.5px] text-muted-foreground mt-0.5">How this was calculated</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {drill.derivation && drill.derivation.length > 0 && (
            <div className="px-5 py-4 border-b border-border">
              <dl className="space-y-1.5">
                {drill.derivation.map((d, i) => (
                  <div key={i} className={`flex items-baseline justify-between gap-4 text-[13px] ${d.muted ? 'text-muted-foreground' : ''}`}>
                    <dt className={d.muted ? '' : 'font-medium'}>{d.label}</dt>
                    <dd className="tabular-nums font-semibold">{d.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {drill.explanation && (
            <p className="px-5 py-4 text-[12.5px] text-muted-foreground leading-relaxed border-b border-border">
              {drill.explanation}
            </p>
          )}

          {drill.transactions && drill.transactions.length > 0 && (
            <div>
              <div className="px-5 pt-4 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                {drill.transactions.length} transaction{drill.transactions.length === 1 ? '' : 's'}
              </div>
              <table className="w-full text-[12.5px]">
                <tbody>
                  {drill.transactions.map((t, i) => (
                    <tr key={`${t.key}-${i}`} className="border-t border-border/60">
                      <td className="pl-5 pr-2 py-2 whitespace-nowrap text-muted-foreground align-top w-[72px]">
                        {shortDate(t.date)}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="truncate max-w-[300px]" title={t.description}>{t.description}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{t.reason}</div>
                      </td>
                      <td className={`pl-2 pr-5 py-2 text-right tabular-nums whitespace-nowrap align-top font-medium ${t.amount > 0 ? TONE_TEXT.good : TONE_TEXT.bad}`}>
                        {t.amount > 0 ? '+' : '−'}{money(Math.abs(t.amount), 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(!drill.transactions || drill.transactions.length === 0) && !drill.derivation && !drill.explanation && (
            <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
              No underlying transactions for this metric.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── table helpers ───────────────────────── */

export function Th({
  children, align = 'left', className = '', onClick,
}: {
  // Optional: spacer columns (the select-all checkbox) render an empty <th>.
  children?: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  onClick?: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className={[
        'px-2.5 py-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground whitespace-nowrap',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        onClick ? 'cursor-pointer select-none hover:text-foreground' : '',
        className,
      ].join(' ')}
    >
      {children}
    </th>
  );
}

export function Td({
  children, align = 'left', className = '', tabular = false, title,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  tabular?: boolean;
  title?: string;
}) {
  return (
    <td
      title={title}
      className={[
        'px-2.5 py-2 text-[12.5px] align-middle',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        tabular ? 'tabular-nums' : '',
        className,
      ].join(' ')}
    >
      {children}
    </td>
  );
}

/** Dense table shell with a sticky header. */
export function DataTable({
  head, children, minWidth = 720,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" style={{ minWidth }}>
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-border">{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
