/**
 * New York State courts — WebCivil Supreme party-name search.
 *
 * ─────────────────────────────────────────────────────────────────────
 * THERE IS NO OFFICIAL API. WebCivil Supreme and NYSCEF "Search as Guest"
 * are session-based HTML forms, so this adapter drives the public search
 * the same way a browser does: GET the form, carry the session cookie,
 * POST the query, parse the results table.
 * ─────────────────────────────────────────────────────────────────────
 *
 * WHY IT DISCOVERS THE FORM AT RUNTIME
 * Hardcoding input names would break the first time the court changes its
 * markup, and would be a guess besides. Instead this parses the search
 * page, finds the real <form>, and maps our values onto whatever fields it
 * actually exposes by matching on name/label. That survives markup churn
 * and means the adapter can be corrected from live diagnostics rather than
 * from assumptions.
 *
 * Every call returns `diagnostics` describing what it found, so when a
 * search fails you can see the discovered fields and the response shape
 * instead of a bare "no results".
 *
 * Operational notes: the court rate-limits and blocks aggressive clients.
 * Requests are serialized with a delay, identify themselves honestly, and
 * a block is reported as `blocked` rather than retried in a loop.
 */

const BASE = 'https://iapps.courts.state.ny.us/webcivil';
const SEARCH_PAGE = `${BASE}/FCASSearch?param=P`;

/** Courtesy delay between requests so we never hammer a public service. */
const REQUEST_DELAY_MS = 1200;
let lastRequestAt = 0;

async function polite(): Promise<void> {
  const wait = Math.max(0, REQUEST_DELAY_MS - (Date.now() - lastRequestAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

export interface CourtCase {
  /** Index / docket number as shown by the court. */
  indexNumber: string;
  caption: string;
  court: string | null;
  county: string | null;
  caseType: string | null;
  filedDate: string | null;
  status: string | null;
  /** Deep link back to the court's own case detail page, when derivable. */
  url: string | null;
  /** Which party name matched. */
  matchedName: string;
}

export interface CourtSearchDiagnostics {
  /** Discovered form action + method. */
  formAction?: string;
  formMethod?: string;
  /** Names of the inputs we found on the search form. */
  discoveredFields?: string[];
  /** Which of our values we mapped onto which field. */
  fieldMapping?: Record<string, string>;
  httpStatus?: number;
  /** Trimmed response excerpt, only on failure — never the whole page. */
  responseExcerpt?: string;
  note?: string;
}

export interface CourtSearchResult {
  ok: boolean;
  /** 'ok' | 'no_results' | 'blocked' | 'unavailable' | 'parse_failed' */
  status: 'ok' | 'no_results' | 'blocked' | 'unavailable' | 'parse_failed';
  cases: CourtCase[];
  error?: string;
  diagnostics: CourtSearchDiagnostics;
}

/* ───────────────────────── tiny HTML helpers ───────────────────────── */
/* Regex rather than a DOM dependency: the two shapes needed here (form
   inputs, result rows) are simple and this keeps the module dependency
   free. Everything is defensive — malformed markup yields empty results,
   never an exception. */

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

interface DiscoveredForm {
  action: string;
  method: string;
  fields: { name: string; type: string; value: string }[];
}

/** Parse the first form that looks like the party search. */
export function discoverForm(html: string, baseUrl: string): DiscoveredForm | null {
  const forms = html.match(/<form[\s\S]*?<\/form>/gi) ?? [];
  let best: DiscoveredForm | null = null;

  for (const form of forms) {
    const actionMatch = form.match(/action\s*=\s*["']([^"']*)["']/i);
    const methodMatch = form.match(/method\s*=\s*["']([^"']*)["']/i);
    const fields: DiscoveredForm['fields'] = [];

    for (const input of form.match(/<input[^>]*>/gi) ?? []) {
      const name = input.match(/name\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!name) continue;
      fields.push({
        name,
        type: (input.match(/type\s*=\s*["']([^"']+)["']/i)?.[1] ?? 'text').toLowerCase(),
        value: input.match(/value\s*=\s*["']([^"']*)["']/i)?.[1] ?? '',
      });
    }
    for (const sel of form.match(/<select[\s\S]*?<\/select>/gi) ?? []) {
      const name = sel.match(/name\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!name) continue;
      // Default to the option marked selected, else the first one.
      const selected = sel.match(/<option[^>]*selected[^>]*value\s*=\s*["']([^"']*)["']/i)?.[1]
        ?? sel.match(/<option[^>]*value\s*=\s*["']([^"']*)["']/i)?.[1]
        ?? '';
      fields.push({ name, type: 'select', value: selected });
    }

    if (!fields.length) continue;
    const candidate: DiscoveredForm = {
      action: new URL(actionMatch?.[1] || '', baseUrl).toString(),
      method: (methodMatch?.[1] ?? 'GET').toUpperCase(),
      fields,
    };
    // Prefer a form that actually has a name-ish text input.
    const looksLikeSearch = fields.some((f) => /name|party|search/i.test(f.name) && f.type !== 'hidden');
    if (looksLikeSearch) return candidate;
    if (!best) best = candidate;
  }
  return best;
}

/**
 * Map our search values onto the form's real field names.
 *
 * Hidden fields and existing defaults are preserved verbatim — those carry
 * the session/state tokens the server expects back.
 */
export function mapFields(
  form: DiscoveredForm,
  values: { name: string; county?: string },
): { body: Record<string, string>; mapping: Record<string, string> } {
  const body: Record<string, string> = {};
  const mapping: Record<string, string> = {};

  for (const f of form.fields) body[f.name] = f.value;

  const pick = (test: RegExp): string | null =>
    form.fields.find((f) => f.type !== 'hidden' && f.type !== 'submit' && test.test(f.name))?.name ?? null;

  // Most specific first — a generic /name/ would otherwise swallow
  // "attorneyName" or "firmName".
  const nameField =
    pick(/party.*name|name.*party/i)
    ?? pick(/txtpartyname|partyname/i)
    ?? pick(/^name$|searchname|lastname|txtname/i)
    ?? pick(/name/i);

  if (nameField) {
    body[nameField] = values.name;
    mapping[nameField] = 'name';
  }

  if (values.county) {
    const countyField = pick(/county|court.*loc|district/i);
    if (countyField) {
      body[countyField] = values.county;
      mapping[countyField] = 'county';
    }
  }

  return { body, mapping };
}

/**
 * Parse the results table.
 *
 * Column order is read from the header row rather than assumed, so a
 * reordered table still maps correctly.
 */
export function parseResults(html: string, matchedName: string): CourtCase[] {
  const cases: CourtCase[] = [];
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];

  for (const table of tables) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    if (rows.length < 2) continue;

    const headerRow = rows[0] ?? '';
    const headerCells = (headerRow.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? []).map((c) => stripTags(c).toLowerCase());
    const idx = (test: RegExp) => headerCells.findIndex((h) => test.test(h));

    const iIndex = idx(/index|case\s*(no|number|#)|docket/);
    const iCaption = idx(/caption|title|parties|case\s*name/);
    if (iIndex === -1 && iCaption === -1) continue; // not the results table

    const iCourt = idx(/court/);
    const iCounty = idx(/county/);
    const iType = idx(/type|nature/);
    const iFiled = idx(/filed|filing|date/);
    const iStatus = idx(/status|disposition/);

    for (const row of rows.slice(1)) {
      const cellsHtml = row.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? [];
      if (!cellsHtml.length) continue;
      const cells = cellsHtml.map((c) => stripTags(c));
      const at = (i: number) => (i >= 0 && i < cells.length ? cells[i] || null : null);

      const indexNumber = at(iIndex) ?? '';
      const caption = at(iCaption) ?? '';
      if (!indexNumber && !caption) continue;
      // Skip pagination / footer rows.
      if (/^\s*(next|previous|page\b)/i.test(indexNumber || caption)) continue;

      const href = cellsHtml[Math.max(iIndex, 0)]?.match(/href\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;

      cases.push({
        indexNumber,
        caption,
        court: at(iCourt),
        county: at(iCounty),
        caseType: at(iType),
        filedDate: at(iFiled),
        status: at(iStatus),
        url: href ? new URL(href, `${BASE}/`).toString() : null,
        matchedName,
      });
    }
    if (cases.length) break;
  }
  return cases;
}

/** Detect the page saying "no cases" vs. a real failure. */
function looksEmpty(text: string): boolean {
  return /no (cases|records|matches|results)|0 cases found|did not (return|match)/i.test(text);
}

function looksBlocked(text: string, status: number): boolean {
  return status === 403 || status === 429
    || /captcha|are you a robot|unusual traffic|access denied|blocked/i.test(text);
}

/* ───────────────────────── the search ───────────────────────── */

const UA = 'CortadaCRM/1.0 (business underwriting; contact: admin)';

function cookiesFrom(res: Response, existing: string): string {
  const set = res.headers.get('set-cookie');
  if (!set) return existing;
  const jar = new Map<string, string>();
  for (const part of existing.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) jar.set(k, v.join('='));
  }
  // Multiple Set-Cookie headers arrive comma-joined; split on the boundary
  // between cookies rather than every comma (dates contain commas too).
  for (const c of set.split(/,(?=[^;]+?=)/)) {
    const [pair] = c.split(';');
    const [k, ...v] = pair.trim().split('=');
    if (k) jar.set(k, v.join('='));
  }
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Search WebCivil Supreme by party name.
 *
 * `name` should already be a single search string (a business name, or
 * "Last, First" for a person) — see ./names.ts for the variants worth
 * trying.
 */
export async function searchPartyName(
  name: string,
  opts: { county?: string; timeoutMs?: number } = {},
): Promise<CourtSearchResult> {
  const diagnostics: CourtSearchDiagnostics = {};
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, status: 'no_results', cases: [], error: 'Empty search name', diagnostics };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 25_000);

  try {
    await polite();
    const pageRes = await fetch(SEARCH_PAGE, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      signal: controller.signal,
      redirect: 'follow',
    });
    const cookies = cookiesFrom(pageRes, '');
    const pageHtml = await pageRes.text();
    diagnostics.httpStatus = pageRes.status;

    if (looksBlocked(pageHtml, pageRes.status)) {
      diagnostics.responseExcerpt = stripTags(pageHtml).slice(0, 400);
      return { ok: false, status: 'blocked', cases: [], error: 'The court site refused the request (rate limit, CAPTCHA, or block).', diagnostics };
    }
    if (!pageRes.ok) {
      diagnostics.responseExcerpt = stripTags(pageHtml).slice(0, 400);
      return { ok: false, status: 'unavailable', cases: [], error: `Court search page returned HTTP ${pageRes.status}.`, diagnostics };
    }

    const form = discoverForm(pageHtml, SEARCH_PAGE);
    if (!form) {
      diagnostics.responseExcerpt = stripTags(pageHtml).slice(0, 400);
      return { ok: false, status: 'parse_failed', cases: [], error: 'Could not find the search form on the court page.', diagnostics };
    }
    diagnostics.formAction = form.action;
    diagnostics.formMethod = form.method;
    diagnostics.discoveredFields = form.fields.map((f) => `${f.name}:${f.type}`);

    const { body, mapping } = mapFields(form, { name: trimmed, county: opts.county });
    diagnostics.fieldMapping = mapping;
    if (!Object.keys(mapping).length) {
      return { ok: false, status: 'parse_failed', cases: [], error: 'Found the form but no field that accepts a party name.', diagnostics };
    }

    await polite();
    const encoded = new URLSearchParams(body).toString();
    const isPost = form.method === 'POST';
    const resultRes = await fetch(isPost ? form.action : `${form.action}?${encoded}`, {
      method: isPost ? 'POST' : 'GET',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        Referer: SEARCH_PAGE,
        Cookie: cookies,
        ...(isPost ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: isPost ? encoded : undefined,
      signal: controller.signal,
      redirect: 'follow',
    });

    const resultHtml = await resultRes.text();
    diagnostics.httpStatus = resultRes.status;
    const plain = stripTags(resultHtml);

    if (looksBlocked(plain, resultRes.status)) {
      diagnostics.responseExcerpt = plain.slice(0, 400);
      return { ok: false, status: 'blocked', cases: [], error: 'The court site refused the search (rate limit, CAPTCHA, or block).', diagnostics };
    }
    if (!resultRes.ok) {
      diagnostics.responseExcerpt = plain.slice(0, 400);
      return { ok: false, status: 'unavailable', cases: [], error: `Court search returned HTTP ${resultRes.status}.`, diagnostics };
    }

    const cases = parseResults(resultHtml, trimmed);
    if (!cases.length) {
      if (looksEmpty(plain)) {
        return { ok: true, status: 'no_results', cases: [], diagnostics };
      }
      diagnostics.responseExcerpt = plain.slice(0, 600);
      diagnostics.note = 'The response did not contain a recognizable results table and did not say "no cases".';
      return { ok: false, status: 'parse_failed', cases: [], error: 'Could not read the results table.', diagnostics };
    }

    return { ok: true, status: 'ok', cases, diagnostics };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: /abort/i.test(msg) ? 'unavailable' : 'unavailable',
      cases: [],
      error: /abort/i.test(msg) ? 'The court site did not respond in time.' : `Could not reach the court site: ${msg}`,
      diagnostics,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch just the search page and report its form — for setup/debugging. */
export async function diagnose(): Promise<CourtSearchDiagnostics & { reachable: boolean; error?: string }> {
  try {
    await polite();
    const res = await fetch(SEARCH_PAGE, { headers: { 'User-Agent': UA } });
    const html = await res.text();
    const form = discoverForm(html, SEARCH_PAGE);
    return {
      reachable: res.ok,
      httpStatus: res.status,
      formAction: form?.action,
      formMethod: form?.method,
      discoveredFields: form?.fields.map((f) => `${f.name}:${f.type}`),
      responseExcerpt: form ? undefined : stripTags(html).slice(0, 600),
      note: form ? 'Search form found.' : 'No form found — the page shape has changed or access is blocked.',
    };
  } catch (e) {
    return { reachable: false, error: e instanceof Error ? e.message : String(e) };
  }
}
