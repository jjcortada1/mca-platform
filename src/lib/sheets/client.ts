import crypto from 'crypto';

/**
 * Minimal Google Sheets client using a service account.
 *
 * Auth flow (no external SDK):
 *   1. Build a JWT signed with the service account's private key (RS256).
 *   2. Exchange it at Google's OAuth token endpoint for an access token.
 *   3. Call the Sheets REST API with that bearer token.
 *
 * The service-account JSON (downloaded from Google Cloud Console) provides
 * `client_email` and `private_key`.
 */

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  [k: string]: unknown;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Create a signed JWT and exchange it for an access token. */
export async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  // private_key may contain literal \n if it came through env/JSON — normalize.
  const key = sa.private_key.replace(/\\n/g, '\n');
  const signature = base64url(signer.sign(key));
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Google auth failed (${res.status}): ${t.slice(0, 300)}`);
  }
  const j = await res.json();
  if (!j.access_token) throw new Error('No access token returned from Google');
  return j.access_token as string;
}

/** Get spreadsheet metadata (also serves as a connection test). */
export async function getSpreadsheet(token: string, spreadsheetId: string): Promise<{ title: string; sheets: string[] }> {
  const res = await fetch(`${SHEETS_BASE}/${spreadsheetId}?fields=properties.title,sheets.properties.title`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Sheets read failed (${res.status}): ${t.slice(0, 300)}`);
  }
  const j = await res.json();
  return {
    title: j.properties?.title ?? '',
    sheets: (j.sheets ?? []).map((s: { properties: { title: string } }) => s.properties.title),
  };
}

/** Ensure a tab (sheet) with the given title exists; create it if missing. */
export async function ensureTab(token: string, spreadsheetId: string, title: string, existing: string[]): Promise<void> {
  if (existing.includes(title)) return;
  const res = await fetch(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Could not create tab "${title}" (${res.status}): ${t.slice(0, 200)}`);
  }
}

/**
 * Overwrite an entire tab's contents with the given rows (header + data).
 * We rewrite the whole tab each sync — simplest reliable way to keep rows
 * matched by internal ID and mark deleted ones inactive without leaving stale
 * data. Values are written starting at A1.
 */
export async function writeTab(token: string, spreadsheetId: string, tab: string, rows: (string | number)[][]): Promise<void> {
  // 1. Clear existing values in the tab
  const clearRes = await fetch(`${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(tab)}:clear`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!clearRes.ok) {
    const t = await clearRes.text().catch(() => '');
    throw new Error(`Clear "${tab}" failed (${clearRes.status}): ${t.slice(0, 200)}`);
  }
  // 2. Write new values
  const range = `${tab}!A1`;
  const res = await fetch(
    `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ range, majorDimension: 'ROWS', values: rows }),
    }
  );
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Write "${tab}" failed (${res.status}): ${t.slice(0, 200)}`);
  }
}

/**
 * Read the first row of a tab (the header row, if any). Returns null if the
 * tab is empty. Used to detect whether we need to seed the header before
 * appending data rows.
 */
export async function readFirstRow(token: string, spreadsheetId: string, tab: string): Promise<string[] | null> {
  const range = `${tab}!1:1`;
  const res = await fetch(
    `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  const values = j?.values as string[][] | undefined;
  if (!values || values.length === 0 || values[0].length === 0) return null;
  return values[0];
}

/**
 * APPEND rows to the end of a tab. Existing rows are NEVER touched — this is
 * the foundation of the append-only backup model: once a row is written to
 * the sheet, it stays there forever, even if the source record is later
 * deleted from the CRM.
 *
 * If the tab is empty, `headerRow` is written first as row 1 so the data
 * has column titles. If the tab already has any content, headerRow is
 * ignored (we don't want to add a second header row mid-sheet).
 */
export async function appendTab(
  token: string,
  spreadsheetId: string,
  tab: string,
  headerRow: string[],
  dataRows: (string | number)[][]
): Promise<void> {
  if (dataRows.length === 0) return;
  // If tab is empty, write the header first so the sheet stays self-describing.
  const existingHeader = await readFirstRow(token, spreadsheetId, tab);
  let rowsToAppend = dataRows;
  if (!existingHeader) {
    rowsToAppend = [headerRow, ...dataRows];
  }
  const range = `${tab}!A1`;
  const res = await fetch(
    `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ range, majorDimension: 'ROWS', values: rowsToAppend }),
    }
  );
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Append "${tab}" failed (${res.status}): ${t.slice(0, 200)}`);
  }
}

/** Parse + validate a service account JSON string. */
export function parseServiceAccount(jsonStr: string): ServiceAccount {
  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Credentials are not valid JSON. Paste the full service-account JSON file contents.');
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('JSON is missing client_email or private_key. Use the service-account key file.');
  }
  return parsed;
}
