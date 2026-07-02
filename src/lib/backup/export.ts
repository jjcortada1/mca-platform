/**
 * Read-only data export / backup.
 *
 * Gathers a single company's data (tenant-scoped) into plain rows that can be
 * serialized to JSON (a full backup) or CSV (per-dataset, for Excel / Google
 * Sheets). This module NEVER writes to or deletes source data — it only reads.
 *
 * Secrets (password hashes, SMTP passwords) are redacted before they leave the
 * database, so a downloaded/emailed backup can't leak credentials.
 */
import { db } from '@/lib/db/client';
import {
  companies, users, funders, funderTiers, funderContacts, funderTierAssignments,
  funderRestrictedStates, funderRestrictedIndustries, deals, submissions,
  submissionFunders, submissionEmails, dealCommissions, leadSources,
  leadSourceCommissions, commissionPayments, commissionDraws, accountingEntries,
  commissionRules, matchOptions, structuredEmailFields, fundedEmailContacts,
  teams, teamMembers, tasks,
} from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

export interface BackupDataset {
  key: string;
  label: string;
  rows: Record<string, unknown>[];
}

// Datasets offered as one-click CSV downloads (the ones people actually want
// in a spreadsheet). The full JSON backup includes everything below.
export const CSV_DATASETS: { key: string; label: string }[] = [
  { key: 'deals', label: 'Deals' },
  { key: 'dealCommissions', label: 'Commissions' },
  { key: 'funders', label: 'Funders' },
  { key: 'users', label: 'Users' },
  { key: 'submissions', label: 'Submissions' },
  { key: 'leadSources', label: 'Lead sources' },
  { key: 'tasks', label: 'Tasks' },
];

const SECRET_KEYS = new Set(['passwordHash', 'password_hash']);
const SECRET_SUBKEYS = ['pass', 'password', 'auth', 'apiKey', 'key', 'secret'];

/** Strip credentials from a row before it leaves the database. */
function redactRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const k of Object.keys(out)) {
    if (SECRET_KEYS.has(k)) { out[k] = '***redacted***'; continue; }
    if (k === 'smtpConfig' && out[k] && typeof out[k] === 'object') {
      const cfg = { ...(out[k] as Record<string, unknown>) };
      for (const sk of SECRET_SUBKEYS) if (sk in cfg) cfg[sk] = '***redacted***';
      out[k] = cfg;
    }
  }
  return out;
}

/**
 * Gather every dataset for one company. All queries are tenant-scoped by
 * companyId (directly, or via parent id sets for child tables).
 */
export async function gatherCompanyBackup(companyId: string): Promise<BackupDataset[]> {
  const out: BackupDataset[] = [];
  const push = (key: string, label: string, rows: Record<string, unknown>[]) =>
    out.push({ key, label, rows: rows.map((r) => redactRow(r as Record<string, unknown>)) });

  const companyRow = await db.select().from(companies).where(eq(companies.id, companyId));
  push('company', 'Company profile', companyRow);

  const us = await db.select().from(users).where(eq(users.companyId, companyId));
  push('users', 'Users', us);

  const fs = await db.select().from(funders).where(eq(funders.companyId, companyId));
  push('funders', 'Funders', fs);
  const funderIds = fs.map((f) => f.id);

  push('funderTiers', 'Funder tiers',
    await db.select().from(funderTiers).where(eq(funderTiers.companyId, companyId)));
  if (funderIds.length) {
    push('funderContacts', 'Funder contacts',
      await db.select().from(funderContacts).where(inArray(funderContacts.funderId, funderIds)));
    push('funderTierAssignments', 'Funder tier assignments',
      await db.select().from(funderTierAssignments).where(inArray(funderTierAssignments.funderId, funderIds)));
    push('funderRestrictedStates', 'Funder restricted states',
      await db.select().from(funderRestrictedStates).where(inArray(funderRestrictedStates.funderId, funderIds)));
    push('funderRestrictedIndustries', 'Funder restricted industries',
      await db.select().from(funderRestrictedIndustries).where(inArray(funderRestrictedIndustries.funderId, funderIds)));
  }

  push('deals', 'Deals',
    await db.select().from(deals).where(eq(deals.companyId, companyId)));

  const subs = await db.select().from(submissions).where(eq(submissions.companyId, companyId));
  push('submissions', 'Submissions', subs);
  const subIds = subs.map((s) => s.id);
  if (subIds.length) {
    const sfs = await db.select().from(submissionFunders).where(inArray(submissionFunders.submissionId, subIds));
    push('submissionFunders', 'Submission funders', sfs);
    const sfIds = sfs.map((x) => x.id);
    if (sfIds.length) {
      push('submissionEmails', 'Submission emails',
        await db.select().from(submissionEmails).where(inArray(submissionEmails.submissionFunderId, sfIds)));
    }
  }

  push('leadSources', 'Lead sources',
    await db.select().from(leadSources).where(eq(leadSources.companyId, companyId)));
  push('dealCommissions', 'Commissions (rep)',
    await db.select().from(dealCommissions).where(eq(dealCommissions.companyId, companyId)));
  push('leadSourceCommissions', 'Commissions (lead source)',
    await db.select().from(leadSourceCommissions).where(eq(leadSourceCommissions.companyId, companyId)));
  push('commissionPayments', 'Commission payments',
    await db.select().from(commissionPayments).where(eq(commissionPayments.companyId, companyId)));
  push('commissionDraws', 'Commission draws',
    await db.select().from(commissionDraws).where(eq(commissionDraws.companyId, companyId)));
  push('accountingEntries', 'Accounting entries',
    await db.select().from(accountingEntries).where(eq(accountingEntries.companyId, companyId)));

  push('commissionRules', 'Commission rules',
    await db.select().from(commissionRules).where(eq(commissionRules.companyId, companyId)));
  push('matchOptions', 'Match options',
    await db.select().from(matchOptions).where(eq(matchOptions.companyId, companyId)));
  push('structuredEmailFields', 'Email fields',
    await db.select().from(structuredEmailFields).where(eq(structuredEmailFields.companyId, companyId)));
  push('fundedEmailContacts', 'Funded email contacts',
    await db.select().from(fundedEmailContacts).where(eq(fundedEmailContacts.companyId, companyId)));

  const tms = await db.select().from(teams).where(eq(teams.companyId, companyId));
  push('teams', 'Teams', tms);
  const teamIds = tms.map((t) => t.id);
  if (teamIds.length) {
    push('teamMembers', 'Team members',
      await db.select().from(teamMembers).where(inArray(teamMembers.teamId, teamIds)));
  }
  push('tasks', 'Tasks',
    await db.select().from(tasks).where(eq(tasks.companyId, companyId)));

  return out;
}

/** Convert rows to a CSV string. Excel-safe quoting; objects are JSON-encoded. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Array.from(
    rows.reduce((set, r) => { Object.keys(r).forEach((k) => set.add(k)); return set; }, new Set<string>())
  );
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [cols.map(esc).join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','));
  return lines.join('\r\n');
}

/** Serialize a full backup payload (object → JSON string). */
export function backupToJson(companyId: string, datasets: BackupDataset[], createdAtIso: string): string {
  return JSON.stringify({
    version: 1,
    createdAt: createdAtIso,
    companyId,
    datasets: Object.fromEntries(datasets.map((d) => [d.key, d.rows])),
  });
}
