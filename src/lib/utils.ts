import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Title-case a person / business name: capitalize the first letter of each
 * word. Handles hyphenated (Anne-Marie) and apostrophe (O'Brien) names, and
 * leaves the rest of each word as typed (so "McDonald" isn't wrecked — we
 * only force the FIRST letter up, never lowercase the rest).
 * Used on first/last name fields.
 */
export function titleCaseName(s: string): string {
  if (!s) return s;
  return s.replace(/(^|[\s\-'’])([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

/**
 * Sentence-case a line of prose: capitalize the first letter of the string
 * (and after sentence-ending punctuation). Does NOT touch the rest, so names
 * and acronyms mid-sentence stay as typed. Used for notes / message fields —
 * NOT for emails or anything case-sensitive.
 */
export function sentenceCase(s: string): string {
  if (!s) return s;
  return s.replace(/(^\s*|[.!?]\s+)([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase());
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

/**
 * Format a date for display. CALENDAR DATES ONLY — for actual moments in
 * time (like "last sync" timestamps), use `.toLocaleString()` directly.
 *
 * This formatter parses the value in UTC and renders in UTC so a date typed
 * as 2026-01-15 always shows as Jan 15 regardless of viewer timezone. See
 * lib/dates.ts for the full set of date helpers.
 */
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  let y: number, m: number, day: number;
  if (typeof d === 'string') {
    // Take date portion only — never let timezone parsing shift the day.
    const m1 = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m1) {
      y = +m1[1]; m = +m1[2]; day = +m1[3];
    } else {
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return '—';
      y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; day = dt.getUTCDate();
    }
  } else {
    y = d.getUTCFullYear(); m = d.getUTCMonth() + 1; day = d.getUTCDate();
  }
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
