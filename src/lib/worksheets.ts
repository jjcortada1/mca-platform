import { db } from '@/lib/db/client';
import { worksheets, worksheetShares } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export type WorksheetRole = 'owner' | 'edit' | 'view';

/**
 * Resolve what a user may do on a worksheet.
 *
 * IMPORTANT — cross-company by design: shared worksheets are the ONE place a
 * user from another company can see data here, and only because the owner
 * explicitly shared THIS sheet with THEIR email. Access is therefore checked
 * against ownership + the share list, NOT against companyId.
 */
export async function getWorksheetAccess(
  worksheetId: string,
  userId: string,
): Promise<{ sheet: typeof worksheets.$inferSelect; role: WorksheetRole } | null> {
  const [sheet] = await db.select().from(worksheets)
    .where(and(eq(worksheets.id, worksheetId), eq(worksheets.isDeleted, false)))
    .limit(1);
  if (!sheet) return null;
  if (sheet.ownerUserId === userId) return { sheet, role: 'owner' };
  const [share] = await db.select().from(worksheetShares)
    .where(and(eq(worksheetShares.worksheetId, worksheetId), eq(worksheetShares.userId, userId)))
    .limit(1);
  if (!share) return null;
  return { sheet, role: share.role === 'edit' ? 'edit' : 'view' };
}

/** Default columns for a brand-new sheet — fully editable afterwards. */
export function defaultColumns(): { id: string; label: string }[] {
  return [
    { id: 'c_deal', label: 'Deal' },
    { id: 'c_partner', label: 'Partner / Company' },
    { id: 'c_amount', label: 'Amount' },
    { id: 'c_status', label: 'Status' },
    { id: 'c_notes', label: 'Notes' },
  ];
}
