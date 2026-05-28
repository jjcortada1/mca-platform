import { db } from '@/lib/db/client';
import {
  sheetSyncConfig, dealCommissions, leadSourceCommissions, deals, users, leadSources,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { decrypt } from '@/lib/crypto';
import { resolveAutoStatus } from '@/lib/commissions/calc';
import {
  getAccessToken, getSpreadsheet, ensureTab, writeTab, parseServiceAccount, type ServiceAccount,
} from './client';

const REP_TAB = 'Rep Commissions';
const LS_TAB = 'Lead Source Commissions';

const REP_HEADER = [
  'Commission ID', 'Deal ID', 'Deal Name', 'Merchant Name', 'Merchant Phone', 'Merchant Email',
  'Rep', 'Funded Amount', 'Rate', 'Term (mo)', 'Fees', 'Broker Fee',
  'Gross Commission', 'Rep Split %', 'Rep Commission', 'Paid', 'Pending', 'Owed',
  'Status', 'Funding Date', 'Cleared Date', 'Early Payoff', 'Notes', 'Record State', 'Last Updated',
];

const LS_HEADER = [
  'Commission ID', 'Deal ID', 'Deal Name', 'Lead Source',
  'Split %', 'Flat Amount', 'Commission', 'Paid', 'Owed',
  'Status', 'Notes', 'Record State', 'Last Updated',
];

function n(v: unknown): number { const x = parseFloat(String(v ?? 0)); return isNaN(x) ? 0 : x; }
function iso(d: Date | string | null | undefined): string { if (!d) return ''; const dt = typeof d === 'string' ? new Date(d) : d; return isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10); }

/**
 * Load the company's sync config (decrypted). Returns null if not configured/enabled.
 */
export async function getSyncConfig(companyId: string) {
  const [cfg] = await db.select().from(sheetSyncConfig).where(eq(sheetSyncConfig.companyId, companyId)).limit(1);
  return cfg ?? null;
}

export function decodeCredentials(encrypted: string | null): ServiceAccount | null {
  if (!encrypted) return null;
  try {
    return parseServiceAccount(decrypt(encrypted));
  } catch {
    return null;
  }
}

/**
 * Build the rep commission rows (INCLUDING soft-deleted ones, marked Deleted).
 * Soft-deleted rows are kept so the Sheet stays an independent backup.
 */
async function buildRepRows(companyId: string): Promise<(string | number)[][]> {
  const rows = await db
    .select({
      c: dealCommissions,
      dealName: deals.name,
      mFirst: deals.merchantFirstName,
      mLast: deals.merchantLastName,
      mPhone: deals.merchantPhone,
      mEmail: deals.merchantEmail,
      repName: users.name,
    })
    .from(dealCommissions)
    .innerJoin(deals, eq(deals.id, dealCommissions.dealId))
    .leftJoin(users, eq(users.id, dealCommissions.repId))
    .where(eq(dealCommissions.companyId, companyId));

  const now = new Date();
  const out: (string | number)[][] = [REP_HEADER];
  for (const r of rows) {
    const c = r.c;
    const amt = n(c.repCommissionAmount);
    const paid = n(c.paidAmount);
    const status = c.isDeleted ? c.status : resolveAutoStatus(c.status, c.fundingDate, now);
    const owed = status === 'clawed_back' ? 0 : Math.max(0, amt - paid);
    const pending = status === 'pending' ? owed : 0;
    out.push([
      c.id, c.dealId, r.dealName ?? '',
      [r.mFirst, r.mLast].filter(Boolean).join(' '),
      r.mPhone ?? '', r.mEmail ?? '',
      r.repName ?? '',
      n(c.fundedAmount), n(c.rate), n(c.termMonths), n(c.fees), n(c.brokerFee),
      n(c.grossCommission), n(c.repSplitPct), amt, paid, pending, owed,
      status, iso(c.fundingDate), iso(c.clearedDate), c.earlyPayoffDiscount ?? '', c.notes ?? '',
      c.isDeleted ? 'Deleted' : 'Active', iso(c.updatedAt),
    ]);
  }
  return out;
}

async function buildLeadSourceRows(companyId: string): Promise<(string | number)[][]> {
  const rows = await db
    .select({
      lsc: leadSourceCommissions,
      dealName: deals.name,
      lsName: leadSources.name,
    })
    .from(leadSourceCommissions)
    .innerJoin(deals, eq(deals.id, leadSourceCommissions.dealId))
    .innerJoin(leadSources, eq(leadSources.id, leadSourceCommissions.leadSourceId))
    .where(eq(leadSourceCommissions.companyId, companyId));

  const out: (string | number)[][] = [LS_HEADER];
  for (const r of rows) {
    const lsc = r.lsc;
    const amt = n(lsc.commissionAmount);
    const paid = n(lsc.paidAmount);
    const owed = lsc.status === 'clawed_back' ? 0 : Math.max(0, amt - paid);
    out.push([
      lsc.id, lsc.dealId, r.dealName ?? '', r.lsName ?? '',
      lsc.splitPct != null ? n(lsc.splitPct) : '', lsc.flatAmount != null ? n(lsc.flatAmount) : '',
      amt, paid, owed,
      lsc.status, lsc.notes ?? '',
      lsc.isDeleted ? 'Deleted' : 'Active', iso(lsc.updatedAt),
    ]);
  }
  return out;
}

export interface SyncResult { ok: boolean; error?: string; repCount?: number; lsCount?: number; }

/**
 * Push all commission data to the configured Google Sheet (both tabs).
 * Records sync status on the config row. Safe to call repeatedly — it always
 * writes to the SAME sheet/tabs and updates rows in place (full rewrite).
 */
export async function syncCompanyToSheet(companyId: string): Promise<SyncResult> {
  const cfg = await getSyncConfig(companyId);
  if (!cfg || !cfg.enabled) return { ok: false, error: 'Sync is not enabled.' };
  if (!cfg.spreadsheetId) return { ok: false, error: 'No spreadsheet ID configured.' };
  const sa = decodeCredentials(cfg.encryptedCredentials);
  if (!sa) return { ok: false, error: 'No valid Google credentials configured.' };

  try {
    const token = await getAccessToken(sa);
    const meta = await getSpreadsheet(token, cfg.spreadsheetId);
    await ensureTab(token, cfg.spreadsheetId, REP_TAB, meta.sheets);
    await ensureTab(token, cfg.spreadsheetId, LS_TAB, meta.sheets);

    const repRows = await buildRepRows(companyId);
    const lsRows = await buildLeadSourceRows(companyId);
    await writeTab(token, cfg.spreadsheetId, REP_TAB, repRows);
    await writeTab(token, cfg.spreadsheetId, LS_TAB, lsRows);

    // Mark rows synced
    await db.update(dealCommissions).set({ syncState: 'synced', syncedAt: new Date(), syncError: null })
      .where(eq(dealCommissions.companyId, companyId));
    await db.update(leadSourceCommissions).set({ syncState: 'synced', syncedAt: new Date(), syncError: null })
      .where(eq(leadSourceCommissions.companyId, companyId));

    await db.update(sheetSyncConfig)
      .set({ lastSyncAt: new Date(), lastSyncStatus: 'ok', lastSyncError: null, updatedAt: new Date() })
      .where(eq(sheetSyncConfig.companyId, companyId));

    return { ok: true, repCount: repRows.length - 1, lsCount: lsRows.length - 1 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Mark rows failed so they retry next time; record on config.
    await db.update(dealCommissions).set({ syncState: 'failed', syncError: msg })
      .where(and(eq(dealCommissions.companyId, companyId), eq(dealCommissions.syncState, 'pending'))).catch(() => {});
    await db.update(sheetSyncConfig)
      .set({ lastSyncAt: new Date(), lastSyncStatus: 'error', lastSyncError: msg, updatedAt: new Date() })
      .where(eq(sheetSyncConfig.companyId, companyId)).catch(() => {});
    return { ok: false, error: msg };
  }
}

/**
 * Fire-and-forget sync trigger for use after a commission mutation.
 * Never throws into the request path — sync failures are recorded, not surfaced
 * as request errors, and the row stays marked pending for the next sync/retry.
 */
export function triggerSync(companyId: string): void {
  // Intentionally not awaited.
  syncCompanyToSheet(companyId).catch((e) => {
    console.error('[sheet-sync] background sync error', e);
  });
}
