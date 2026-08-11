/**
 * Name variants for court searching.
 *
 * Court indexes record parties as they were written on the filing, which
 * is rarely how a merchant writes their own name. "ACME LOGISTICS LLC"
 * may be indexed as "ACME LOGISTICS", "ACME LOGISTICS, LLC", or just
 * "ACME". Searching only the exact string misses real judgments, which for
 * underwriting is the expensive direction to be wrong in.
 *
 * Variants are ordered most-specific first and capped, because each one is
 * a separate request to a public service.
 */

/** Suffixes courts commonly drop or abbreviate. */
const ENTITY_SUFFIXES = /\b(L\.?L\.?C|INC|CORP(ORATION)?|CO|COMPANY|LTD|L\.?P|L\.?L\.?P|PLLC|PC|ENTERPRISES?|HOLDINGS?|GROUP)\b\.?/gi;

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/[.,]+$/, '').trim();
}

/**
 * Business name variants, most specific first.
 * Capped at 3 so one lookup never fans out into a burst of requests.
 */
export function businessNameVariants(raw: string): string[] {
  const base = clean(raw);
  if (!base) return [];
  const out: string[] = [base];

  const noSuffix = clean(base.replace(ENTITY_SUFFIXES, ''));
  if (noSuffix && noSuffix.toUpperCase() !== base.toUpperCase()) out.push(noSuffix);

  // Distinctive leading words — "ACME LOGISTICS AND FREIGHT" → "ACME LOGISTICS".
  const words = noSuffix.split(' ').filter(Boolean);
  if (words.length > 2) {
    const short = words.slice(0, 2).join(' ');
    if (!out.some((v) => v.toUpperCase() === short.toUpperCase())) out.push(short);
  }

  return out.filter((v) => v.length >= 3).slice(0, 3);
}

/**
 * Person name variants. New York indexes people "Last, First", so that
 * form leads; the plain "First Last" is included because some records and
 * business-party entries use it.
 */
export function personNameVariants(first: string, last: string): string[] {
  const f = clean(first);
  const l = clean(last);
  if (!l) return f ? [f] : [];
  if (!f) return [l];
  return [`${l}, ${f}`, `${l} ${f}`, l].filter((v) => v.length >= 3).slice(0, 3);
}

/**
 * How closely a returned case caption matches what we searched.
 *
 * A party search matches on substrings, so "ACME" returns every ACME in
 * the state. Scoring lets the UI separate a near-certain hit from a
 * coincidence instead of presenting them as equals.
 */
export function matchScore(caption: string, searched: string): number {
  const c = caption.toUpperCase();
  const s = searched.toUpperCase().replace(/,/g, '');
  if (!c || !s) return 0;
  if (c.includes(s)) return 1;
  const tokens = s.split(' ').filter((t) => t.length > 2);
  if (!tokens.length) return 0;
  const hit = tokens.filter((t) => c.includes(t)).length;
  return hit / tokens.length;
}

export type MatchConfidence = 'strong' | 'partial' | 'weak';

export function toConfidence(score: number): MatchConfidence {
  if (score >= 0.99) return 'strong';
  if (score >= 0.6) return 'partial';
  return 'weak';
}
