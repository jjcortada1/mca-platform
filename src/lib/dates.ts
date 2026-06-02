/**
 * Calendar-date helpers.
 *
 * The bug being avoided here: a typed-in date like "2026-01-15" is treated by
 * `new Date('2026-01-15')` as UTC midnight, which renders as "Jan 14" for any
 * user west of GMT. We want a typed date to mean THE CALENDAR DAY, regardless
 * of viewer timezone.
 *
 * Strategy:
 *   - Input: HTML <input type="date"> emits "YYYY-MM-DD" — keep that string
 *     all the way to the DB. When the DB column is timestamptz, we anchor to
 *     local noon to avoid any rollover.
 *   - Display: when reading back, take only the date portion (or use
 *     UTC-getters) so the displayed day matches what was entered.
 */

/** Format a Date | ISO string | null as "YYYY-MM-DD" — never shifts the day. */
export function toDateInput(value: Date | string | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') {
    // Already a date string ("2026-01-15" or "2026-01-15T..."). Take the first 10 chars.
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    // Fallback: parse and re-emit in UTC so we get the same calendar day the DB stored.
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return formatUTCDate(d);
  }
  return formatUTCDate(value);
}

function formatUTCDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Display a calendar date as "Jan 15, 2026" — no time, no shift. */
export function formatCalendarDate(
  value: Date | string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
): string {
  if (!value) return '—';
  let dateOnly: string;
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      dateOnly = value.slice(0, 10);
    } else {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return '—';
      dateOnly = formatUTCDate(d);
    }
  } else {
    dateOnly = formatUTCDate(value);
  }
  // Parse parts manually so the locale formatter gets the right Y/M/D
  // without any timezone interpretation.
  const [y, m, d] = dateOnly.split('-').map(Number);
  // Construct as UTC then format in UTC so no shift happens.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
}

/**
 * Convert a "YYYY-MM-DD" form input to a Date that's safe to store in a
 * `timestamptz` column. We anchor to local-noon UTC so DST never bumps the
 * day across boundaries.
 *
 * Returns null for empty/invalid input.
 */
export function fromDateInput(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return null;
  const [y, m, d] = trimmed.slice(0, 10).split('-').map(Number);
  // Noon UTC: a 12-hour buffer either side ensures no timezone shifts the
  // day even with DST transitions.
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}
