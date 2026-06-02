import { db } from '@/lib/db/client';
import {
  sheetSyncConfig, dealCommissions, leadSourceCommissions, deals, users,
  leadSources, funders, funderContacts, submissions, submissionFunders,
  accountingEntries, commissionPayments,
} from '@/lib/db/schema';
import { and, eq, gt } from 'drizzle-orm';
import { decrypt } from '@/lib/crypto';
import { resolveAutoStatus } from '@/lib/commissions/calc';
import {
  getAccessToken, getSpreadsheet, ensureTab, appendTab, parseServiceAccount, type ServiceAccount,
} from './client';

/**
 * APPEND-ONLY GOOGLE SHEETS BACKUP
 *
 * This is a real backup, not a mirror. Once a row is appended to the Sheet,
 * it stays there forever — even if the source record is deleted from the CRM.
 *
 * How it works:
 *   - Each backup-eligible table has its own tab in the configured Sheet.
 *   - Per-company config tracks the last sync cursor per table (an ISO
 *     timestamp). On each sync, we read every row that was created OR updated
 *     after the cursor and APPEND it to the Sheet. The cursor advances.
 *   - Every appended row carries a "Backed up at" column so you can see
 *     exactly when each snapshot was written.
 *   - Edits create NEW rows in the Sheet (audit trail). Deletes just mean
 *     no further updates flow — the last known state stays preserved.
 *
 * Tabs created (auto-named, in your sheet):
 *   - Deals
 *   - Funders
 *   - Funder Contacts
 *   - Submissions
 *   - Submission Funders
 *   - Rep Commissions
 *   - Lead Source Commissions
 *   - Commission Payments
 *   - Accounting
 */

// Tab names. Used both for ensureTab() and for the cursor map keys.
const TABS = {
  deals: 'Deals',
  funders: 'Funders',
  funderContacts: 'Funder Contacts',
  submissions: 'Submissions',
  submissionFunders: 'Submission Funders',
  dealCommissions: 'Rep Commissions',
  leadSourceCommissions: 'Lead Source Commissions',
  commissionPayments: 'Commission Payments',
  accountingEntries: 'Accounting',
} as const;

type TableKey = keyof typeof TABS;

// Number coerce + ISO date helpers.
function n(v: unknown): number { const x = parseFloat(String(v ?? 0)); return isNaN(x) ? 0 : x; }
function iso(d: Date | string | null | undefined): string { if (!d) return ''; const dt = typeof d === 'string' ? new Date(d) : d; return isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10); }
function isoFull(d: Date | string | null | undefined): string { if (!d) return ''; const dt = typeof d === 'string' ? new Date(d) : d; return isNaN(dt.getTime()) ? '' : dt.toISOString(); }

/**
 * Load the company's sync config. Returns null if not configured/enabled.
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

/* ============================================================
   ROW BUILDERS — one per table
   Each takes (companyId, since) and returns:
     { rows: [...], maxUpdatedAt: Date | null }
   ============================================================ */

// All headers include "Backed up at" as the LAST column so you can always tell
// when each row landed in the sheet.
const COMMON_TAIL = ['Backed up at'];
const BACKUP_NOW = () => new Date().toISOString();

async function buildDealRows(companyId: string, since: Date) {
  const rows = await db.select().from(deals).where(and(eq(deals.companyId, companyId), gt(deals.updatedAt, since)));
  const header = [
    'Deal ID', 'Name', 'Merchant First', 'Merchant Last', 'Merchant Email', 'Merchant Phone',
    'Assigned Rep ID', 'Status', 'Funded Amount', 'Net Amount', 'Fee %', 'Factor Rate',
    'Term Mode', 'Term Count', 'Funding Date', 'Amount Collected', 'Offer Amount', 'Offer Notes',
    'Renewal Notes', 'Is Deleted', 'Created At', 'Updated At', ...COMMON_TAIL,
  ];
  let max = since;
  const data = rows.map((d) => {
    if (d.updatedAt && d.updatedAt > max) max = d.updatedAt;
    return [
      d.id, d.name, d.merchantFirstName ?? '', d.merchantLastName ?? '',
      d.merchantEmail ?? '', d.merchantPhone ?? '', d.assignedRepId ?? '',
      d.status, n(d.fundedAmount), n(d.netAmount), n(d.feePct), n(d.factorRate),
      d.termMode ?? '', n(d.termCount), iso(d.fundingDate), n(d.amountCollected),
      n(d.offerAmount), d.offerNotes ?? '', d.renewalNotes ?? '',
      d.isDeleted ? 'YES' : 'no', isoFull(d.createdAt), isoFull(d.updatedAt), BACKUP_NOW(),
    ];
  });
  return { header, rows: data, maxUpdatedAt: max };
}

async function buildFunderRows(companyId: string, since: Date) {
  const rows = await db.select().from(funders).where(and(eq(funders.companyId, companyId), gt(funders.updatedAt, since)));
  const header = [
    'Funder ID', 'Name', 'Submission Method', 'Min Revenue', 'Max Positions',
    'Min Credit Tier', 'Submission Emails', 'Phones', 'Supports Reverse',
    'Notes', 'Is Active', 'Updated At', ...COMMON_TAIL,
  ];
  let max = since;
  const data = rows.map((f) => {
    if (f.updatedAt && f.updatedAt > max) max = f.updatedAt;
    return [
      f.id, f.name, f.submissionMethod, n(f.minRevenue), f.maxPositions,
      f.minCreditTier, (f.emails as string[] | null)?.join('; ') ?? '',
      (f.phones as string[] | null)?.join('; ') ?? '',
      f.supportsReverseConsolidation ? 'yes' : 'no',
      f.notes ?? '', f.isActive ? 'yes' : 'no', isoFull(f.updatedAt), BACKUP_NOW(),
    ];
  });
  return { header, rows: data, maxUpdatedAt: max };
}

async function buildFunderContactRows(companyId: string, since: Date) {
  // Contacts don't carry companyId directly; we filter via the funder relation.
  // Since the funder_contacts table doesn't track its own updatedAt timestamp,
  // we fall back to syncing ALL contacts each time — this is acceptable
  // because contacts are tiny and the append model means duplicate rows just
  // show up if a contact is edited a lot (which is rare). For very high
  // change rate we could add an updated_at column; for now this is fine.
  const funderRows = await db.select({ id: funders.id }).from(funders).where(eq(funders.companyId, companyId));
  const funderIds = new Set(funderRows.map((f) => f.id));
  const contacts = await db.select().from(funderContacts);
  const mine = contacts.filter((c) => funderIds.has(c.funderId));

  const header = ['Contact ID', 'Funder ID', 'Name', 'Role', 'Email', 'Phone', 'Is Primary', ...COMMON_TAIL];
  // Since we don't track updated_at, we always re-append the whole list each
  // time the cursor advances. To avoid spamming the sheet, only append on the
  // FIRST sync or when the user clicks "Sync now" explicitly. The trigger-on-
  // mutation path skips this tab (see syncCompanyToSheet).
  const data = mine.map((c) => [
    c.id, c.funderId, c.name, c.role ?? '', c.email ?? '', c.phone ?? '',
    c.isPrimary ? 'yes' : 'no', BACKUP_NOW(),
  ]);
  return { header, rows: data, maxUpdatedAt: since /* don't advance for this table */ };
}

async function buildSubmissionRows(companyId: string, since: Date) {
  const rows = await db.select({ s: submissions, dealName: deals.name })
    .from(submissions)
    .innerJoin(deals, eq(deals.id, submissions.dealId))
    .where(and(eq(submissions.companyId, companyId), gt(submissions.createdAt, since)));
  const header = ['Submission ID', 'Deal ID', 'Deal Name', 'Created At', ...COMMON_TAIL];
  let max = since;
  const data = rows.map((r) => {
    if (r.s.createdAt && r.s.createdAt > max) max = r.s.createdAt;
    return [r.s.id, r.s.dealId, r.dealName, isoFull(r.s.createdAt), BACKUP_NOW()];
  });
  return { header, rows: data, maxUpdatedAt: max };
}

async function buildSubmissionFunderRows(companyId: string, since: Date) {
  // submissionFunders don't directly carry companyId — filter via their submission.
  const subs = await db.select({ id: submissions.id }).from(submissions).where(eq(submissions.companyId, companyId));
  const subIds = new Set(subs.map((s) => s.id));
  // submission_funders only has `submittedAt`, no `updatedAt`. So we use
  // submittedAt as the cursor and append once per (submission, funder) pair.
  // Status changes after the initial submit will NOT re-append (acceptable —
  // the inline status edits aren't audit-critical for the backup case).
  const allSf = await db.select().from(submissionFunders);
  const mine = allSf.filter((sf) =>
    subIds.has(sf.submissionId) && sf.submittedAt > since
  );
  const header = [
    'SubmissionFunder ID', 'Submission ID', 'Funder ID', 'Manual Funder Name',
    'Status', 'Notes', 'Submitted At', ...COMMON_TAIL,
  ];
  let max = since;
  const data = mine.map((sf) => {
    if (sf.submittedAt && sf.submittedAt > max) max = sf.submittedAt;
    return [
      sf.id, sf.submissionId, sf.funderId ?? '', sf.manualFunderName ?? '',
      sf.status, sf.notes ?? '', isoFull(sf.submittedAt),
      BACKUP_NOW(),
    ];
  });
  return { header, rows: data, maxUpdatedAt: max };
}

async function buildDealCommissionRows(companyId: string, since: Date) {
  const rows = await db
    .select({
      c: dealCommissions, dealName: deals.name,
      mFirst: deals.merchantFirstName, mLast: deals.merchantLastName,
      mPhone: deals.merchantPhone, mEmail: deals.merchantEmail,
      repName: users.name,
    })
    .from(dealCommissions)
    .innerJoin(deals, eq(deals.id, dealCommissions.dealId))
    .leftJoin(users, eq(users.id, dealCommissions.repId))
    .where(and(eq(dealCommissions.companyId, companyId), gt(dealCommissions.updatedAt, since)));

  const header = [
    'Commission ID', 'Deal ID', 'Deal Name', 'Merchant Name', 'Merchant Phone', 'Merchant Email',
    'Rep', 'Funded Amount', 'Rate', 'Term (mo)', 'Fees', 'Broker Fee',
    'Gross Commission', 'Rep Split %', 'Rep Commission', 'Paid', 'Pending', 'Owed',
    'Status', 'Funding Date', 'Cleared Date', 'Early Payoff', 'Notes',
    'Is Deleted', 'Updated At', ...COMMON_TAIL,
  ];
  const now = new Date();
  let max = since;
  const data = rows.map((r) => {
    const c = r.c;
    if (c.updatedAt && c.updatedAt > max) max = c.updatedAt;
    const amt = n(c.repCommissionAmount);
    const paid = n(c.paidAmount);
    const status = c.isDeleted ? c.status : resolveAutoStatus(c.status, c.fundingDate, now);
    const owed = status === 'clawed_back' ? 0 : Math.max(0, amt - paid);
    const pending = status === 'pending' ? owed : 0;
    return [
      c.id, c.dealId, r.dealName ?? '',
      [r.mFirst, r.mLast].filter(Boolean).join(' '),
      r.mPhone ?? '', r.mEmail ?? '',
      r.repName ?? '',
      n(c.fundedAmount), n(c.rate), n(c.termMonths), n(c.fees), n(c.brokerFee),
      n(c.grossCommission), n(c.repSplitPct), amt, paid, pending, owed,
      status, iso(c.fundingDate), iso(c.clearedDate),
      c.earlyPayoffDiscount ?? '', c.notes ?? '',
      c.isDeleted ? 'YES' : 'no', isoFull(c.updatedAt), BACKUP_NOW(),
    ];
  });
  return { header, rows: data, maxUpdatedAt: max };
}

async function buildLeadSourceCommissionRows(companyId: string, since: Date) {
  const rows = await db
    .select({ lsc: leadSourceCommissions, dealName: deals.name, lsName: leadSources.name })
    .from(leadSourceCommissions)
    .innerJoin(deals, eq(deals.id, leadSourceCommissions.dealId))
    .innerJoin(leadSources, eq(leadSources.id, leadSourceCommissions.leadSourceId))
    .where(and(eq(leadSourceCommissions.companyId, companyId), gt(leadSourceCommissions.updatedAt, since)));

  const header = [
    'Commission ID', 'Deal ID', 'Deal Name', 'Lead Source',
    'Split %', 'Flat Amount', 'Commission', 'Paid', 'Owed',
    'Status', 'Notes', 'Is Deleted', 'Updated At', ...COMMON_TAIL,
  ];
  let max = since;
  const data = rows.map((r) => {
    const lsc = r.lsc;
    if (lsc.updatedAt && lsc.updatedAt > max) max = lsc.updatedAt;
    const amt = n(lsc.commissionAmount);
    const paid = n(lsc.paidAmount);
    const owed = lsc.status === 'clawed_back' ? 0 : Math.max(0, amt - paid);
    return [
      lsc.id, lsc.dealId, r.dealName ?? '', r.lsName ?? '',
      lsc.splitPct != null ? n(lsc.splitPct) : '', lsc.flatAmount != null ? n(lsc.flatAmount) : '',
      amt, paid, owed, lsc.status, lsc.notes ?? '',
      lsc.isDeleted ? 'YES' : 'no', isoFull(lsc.updatedAt), BACKUP_NOW(),
    ];
  });
  return { header, rows: data, maxUpdatedAt: max };
}

async function buildCommissionPaymentRows(companyId: string, since: Date) {
  const rows = await db.select().from(commissionPayments)
    .where(and(eq(commissionPayments.companyId, companyId), gt(commissionPayments.paidDate, since)));
  const header = [
    'Payment ID', 'Deal Commission ID', 'LS Commission ID', 'Rep ID',
    'Lead Source ID', 'Amount', 'Paid Date', 'Method', 'Confirmation #',
    'Is Deleted', ...COMMON_TAIL,
  ];
  let max = since;
  const data = rows.map((p) => {
    if (p.paidDate && p.paidDate > max) max = p.paidDate;
    return [
      p.id, p.dealCommissionId ?? '', p.leadSourceCommissionId ?? '',
      p.repId ?? '', p.leadSourceId ?? '',
      n(p.amount), isoFull(p.paidDate), p.method ?? '', p.confirmationNumber ?? '',
      p.isDeleted ? 'YES' : 'no', BACKUP_NOW(),
    ];
  });
  return { header, rows: data, maxUpdatedAt: max };
}

async function buildAccountingRows(companyId: string, since: Date) {
  const rows = await db.select().from(accountingEntries)
    .where(and(eq(accountingEntries.companyId, companyId), gt(accountingEntries.updatedAt, since)));
  const header = [
    'Entry ID', 'Deal ID', 'Entry Type', 'Amount', 'Entry Date',
    'Method', 'Reference #', 'Notes', 'Is Deleted', 'Updated At', ...COMMON_TAIL,
  ];
  let max = since;
  const data = rows.map((e) => {
    if (e.updatedAt && e.updatedAt > max) max = e.updatedAt;
    return [
      e.id, e.dealId ?? '', e.entryType, n(e.amount), isoFull(e.entryDate),
      e.method ?? '', e.referenceNumber ?? '', e.notes ?? '',
      e.isDeleted ? 'YES' : 'no', isoFull(e.updatedAt), BACKUP_NOW(),
    ];
  });
  return { header, rows: data, maxUpdatedAt: max };
}

/* ============================================================
   ORCHESTRATOR
   ============================================================ */

export interface SyncResult {
  ok: boolean;
  error?: string;
  appended?: Record<string, number>;
}

interface BuilderEntry {
  key: TableKey;
  tab: string;
  build: (companyId: string, since: Date) => Promise<{ header: string[]; rows: (string | number)[][]; maxUpdatedAt: Date }>;
  // If true, this table only appends on a manual "Sync now" — not on every
  // mutation (used for funder_contacts which has no updated_at tracking).
  manualOnly?: boolean;
}

const BUILDERS: BuilderEntry[] = [
  { key: 'deals', tab: TABS.deals, build: buildDealRows },
  { key: 'funders', tab: TABS.funders, build: buildFunderRows },
  { key: 'funderContacts', tab: TABS.funderContacts, build: buildFunderContactRows, manualOnly: true },
  { key: 'submissions', tab: TABS.submissions, build: buildSubmissionRows },
  { key: 'submissionFunders', tab: TABS.submissionFunders, build: buildSubmissionFunderRows },
  { key: 'dealCommissions', tab: TABS.dealCommissions, build: buildDealCommissionRows },
  { key: 'leadSourceCommissions', tab: TABS.leadSourceCommissions, build: buildLeadSourceCommissionRows },
  { key: 'commissionPayments', tab: TABS.commissionPayments, build: buildCommissionPaymentRows },
  { key: 'accountingEntries', tab: TABS.accountingEntries, build: buildAccountingRows },
];

/**
 * APPEND-ONLY sync. For each backup-eligible table, append every row whose
 * timestamp is newer than the per-table cursor. Cursor advances on success.
 * No row is ever cleared or rewritten in the Sheet.
 *
 * @param opts.manual If true, includes the manual-only tabs (like funder_contacts).
 */
export async function syncCompanyToSheet(
  companyId: string,
  opts: { manual?: boolean } = {}
): Promise<SyncResult> {
  const cfg = await getSyncConfig(companyId);
  if (!cfg || !cfg.enabled) return { ok: false, error: 'Sync is not enabled.' };
  if (!cfg.spreadsheetId) return { ok: false, error: 'No spreadsheet ID configured.' };
  const sa = decodeCredentials(cfg.encryptedCredentials);
  if (!sa) return { ok: false, error: 'No valid Google credentials configured.' };

  const cursors: Record<string, string> = (cfg.backupCursors as Record<string, string> | null) ?? {};
  const appended: Record<string, number> = {};

  try {
    const token = await getAccessToken(sa);
    const meta = await getSpreadsheet(token, cfg.spreadsheetId);
    // Ensure every tab exists upfront so a partial failure doesn't leave
    // half-created tabs.
    for (const b of BUILDERS) {
      if (b.manualOnly && !opts.manual) continue;
      await ensureTab(token, cfg.spreadsheetId, b.tab, meta.sheets);
    }

    const nextCursors = { ...cursors };

    for (const b of BUILDERS) {
      if (b.manualOnly && !opts.manual) continue;
      const sinceStr = cursors[b.key];
      // First sync ever for this table: use epoch so EVERYTHING gets backed up.
      const since = sinceStr ? new Date(sinceStr) : new Date(0);
      const built = await b.build(companyId, since);
      if (built.rows.length > 0) {
        await appendTab(token, cfg.spreadsheetId, b.tab, built.header, built.rows);
        appended[b.key] = built.rows.length;
      }
      if (built.maxUpdatedAt > since) {
        nextCursors[b.key] = built.maxUpdatedAt.toISOString();
      }
    }

    await db.update(sheetSyncConfig)
      .set({
        lastSyncAt: new Date(),
        lastSyncStatus: 'ok',
        lastSyncError: null,
        backupCursors: nextCursors,
        updatedAt: new Date(),
      })
      .where(eq(sheetSyncConfig.companyId, companyId));

    return { ok: true, appended };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(sheetSyncConfig)
      .set({ lastSyncAt: new Date(), lastSyncStatus: 'error', lastSyncError: msg, updatedAt: new Date() })
      .where(eq(sheetSyncConfig.companyId, companyId)).catch(() => {});
    return { ok: false, error: msg };
  }
}

/**
 * Fire-and-forget sync trigger for use after a mutation. Never throws into
 * the request path; failures are recorded on the config row.
 */
export function triggerSync(companyId: string): void {
  syncCompanyToSheet(companyId).catch((e) => {
    console.error('[sheet-sync] background sync error', e);
  });
}
