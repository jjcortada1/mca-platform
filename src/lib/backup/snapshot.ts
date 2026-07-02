/**
 * Backup snapshots — create, prune, and (optionally) email point-in-time
 * copies of a company's data. Additive and safe: this only ever INSERTs into
 * data_backups and prunes OLD rows of that same backup table. It never touches
 * users/deals/funders/commissions/submissions/settings.
 */
import { db } from '@/lib/db/client';
import { companies, dataBackups } from '@/lib/db/schema';
import { eq, desc, inArray } from 'drizzle-orm';
import { gatherCompanyBackup, backupToJson } from './export';
import { sendGenericEmail, type SmtpConfig } from '@/lib/email/smtp';

// Keep the most recent N snapshots per company; older ones are pruned.
const KEEP_PER_COMPANY = 14;
// One automatic snapshot per 24h.
const AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface SnapshotResult {
  id: string;
  byteSize: number;
  rowCounts: Record<string, number>;
  emailed: boolean;
}

/** Create a snapshot now (manual or auto). Returns the stored row summary. */
export async function createBackupSnapshot(
  companyId: string,
  kind: 'auto' | 'manual',
): Promise<SnapshotResult> {
  const datasets = await gatherCompanyBackup(companyId);
  const createdAtIso = new Date().toISOString();
  const content = backupToJson(companyId, datasets, createdAtIso);
  const rowCounts: Record<string, number> = Object.fromEntries(datasets.map((d) => [d.key, d.rows.length]));

  const [row] = await db
    .insert(dataBackups)
    .values({ companyId, kind, content, byteSize: content.length, rowCounts })
    .returning();

  await db.update(companies).set({ lastBackupAt: new Date() }).where(eq(companies.id, companyId));

  // Prune to the most recent KEEP_PER_COMPANY (only ever removes rows from
  // the backup table itself — never source data). We list all ids newest-first
  // and delete everything past the keep window by id.
  const allIds = await db
    .select({ id: dataBackups.id })
    .from(dataBackups)
    .where(eq(dataBackups.companyId, companyId))
    .orderBy(desc(dataBackups.createdAt));
  const staleIds = allIds.slice(KEEP_PER_COMPANY).map((k) => k.id);
  if (staleIds.length) {
    await db.delete(dataBackups).where(inArray(dataBackups.id, staleIds));
  }

  // Optional off-site copy: email the JSON backup if a destination is set and
  // an SMTP transport is available. Best-effort — never blocks the snapshot.
  let emailed = false;
  try {
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    const dest = company?.backupEmail?.trim();
    const smtp = (company?.smtpConfig as SmtpConfig | null) ?? null;
    if (dest && smtp) {
      const date = createdAtIso.slice(0, 10);
      const r = await sendGenericEmail({
        smtp,
        toEmail: dest,
        ccEmails: [],
        subject: `Data backup — ${company?.name ?? 'your company'} — ${date}`,
        bodyNotes:
          `Automatic data backup attached (JSON).\n\n` +
          `Datasets: ${Object.entries(rowCounts).map(([k, v]) => `${k}: ${v}`).join(', ')}.\n\n` +
          `Keep this file somewhere safe (e.g. Google Drive). You can re-import ` +
          `the CSVs into Google Sheets from Settings → Data & backups.`,
        structuredFields: [],
        attachments: [
          {
            filename: `backup-${date}.json`,
            content: Buffer.from(content, 'utf8'),
            contentType: 'application/json',
          },
        ],
      });
      emailed = r.success;
    }
  } catch (err) {
    console.error('[backup] email copy failed (non-fatal):', err instanceof Error ? err.message : err);
  }

  return { id: row.id, byteSize: row.byteSize, rowCounts, emailed };
}

/**
 * Create an automatic snapshot if one is due (none in the last 24h) and the
 * company hasn't turned auto-backups off. Cheap when not due: one small SELECT.
 * Safe to call opportunistically on page loads / API hits. Never throws.
 */
export async function ensureAutoBackup(companyId: string): Promise<void> {
  try {
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company || company.autoBackupEnabled === false) return;
    const last = company.lastBackupAt ? new Date(company.lastBackupAt).getTime() : 0;
    if (Date.now() - last < AUTO_INTERVAL_MS) return;
    await createBackupSnapshot(companyId, 'auto');
  } catch (err) {
    console.error('[backup] ensureAutoBackup failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}
