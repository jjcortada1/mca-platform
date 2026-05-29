import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(n: number | string | null | undefined, opts?: { compact?: boolean }): string {
  if (n == null || n === '') return '$0';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (Number.isNaN(num)) return '$0';
  if (opts?.compact && Math.abs(num) >= 1000) {
    if (Math.abs(num) >= 1_000_000) {
      return `$${(num / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 })}M`;
    }
    return `$${(num / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}K`;
  }
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
