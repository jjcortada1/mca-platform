/**
 * Shared date-range filtering — one preset vocabulary used by every list
 * that filters by date (Submissions, Active Deals, …) so the behavior is
 * identical platform-wide. Weeks start Monday (business convention).
 */

export type DatePreset =
  | 'all' | 'today' | 'yesterday'
  | 'this_week' | 'last_week'
  | 'this_month' | 'last_month'
  | 'last_7' | 'last_30'
  | 'on_date' | 'custom';

export interface DateRangeValue {
  preset: DatePreset;
  /** For preset 'on_date' — YYYY-MM-DD */
  date?: string;
  /** For preset 'custom' — YYYY-MM-DD (inclusive) */
  from?: string;
  to?: string;
}

export const DATE_PRESET_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This week' },
  { value: 'last_week', label: 'Last week' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_7', label: 'Last 7 days' },
  { value: 'last_30', label: 'Last 30 days' },
  { value: 'on_date', label: 'Specific date…' },
  { value: 'custom', label: 'Custom range…' },
];

function startOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}
function addDays(d: Date, days: number): Date {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
}
/** Monday of the week containing d. */
function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  const dow = (s.getDay() + 6) % 7; // Mon=0 … Sun=6
  return addDays(s, -dow);
}
function parseYmd(s: string | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Resolve a DateRangeValue to [start, end) epoch-ms bounds, or null for
 * "no filtering" (all time, or an incomplete on_date/custom selection).
 */
export function resolveDateRange(v: DateRangeValue, now = new Date()): { start: number; end: number } | null {
  const today = startOfDay(now);
  switch (v.preset) {
    case 'all': return null;
    case 'today': return { start: today.getTime(), end: addDays(today, 1).getTime() };
    case 'yesterday': return { start: addDays(today, -1).getTime(), end: today.getTime() };
    case 'this_week': {
      const s = startOfWeek(now);
      return { start: s.getTime(), end: addDays(s, 7).getTime() };
    }
    case 'last_week': {
      const s = addDays(startOfWeek(now), -7);
      return { start: s.getTime(), end: addDays(s, 7).getTime() };
    }
    case 'this_month': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: s.getTime(), end: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() };
    }
    case 'last_month': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { start: s.getTime(), end: new Date(now.getFullYear(), now.getMonth(), 1).getTime() };
    }
    case 'last_7': return { start: addDays(today, -6).getTime(), end: addDays(today, 1).getTime() };
    case 'last_30': return { start: addDays(today, -29).getTime(), end: addDays(today, 1).getTime() };
    case 'on_date': {
      const d = parseYmd(v.date);
      if (!d) return null;
      return { start: d.getTime(), end: addDays(d, 1).getTime() };
    }
    case 'custom': {
      const from = parseYmd(v.from);
      const to = parseYmd(v.to);
      if (!from && !to) return null;
      return {
        start: from ? from.getTime() : 0,
        end: to ? addDays(to, 1).getTime() : Number.MAX_SAFE_INTEGER,
      };
    }
    default: return null;
  }
}

/** True when timestamp ms falls inside the range (always true for null range). */
export function inDateRange(ms: number, v: DateRangeValue): boolean {
  const r = resolveDateRange(v);
  if (!r) return true;
  return ms >= r.start && ms < r.end;
}
