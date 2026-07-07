/**
 * Notification engine — writes in-app notifications that the bell UI polls
 * and mirrors to the user's physical screen via the browser Notifications API.
 *
 * Fire-and-forget by design: a notification failure must never break the
 * action that triggered it, so every helper swallows its own errors.
 */
import { db } from '@/lib/db/client';
import { notifications, teamMembers, users } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

export interface NotifyPayload {
  title: string;
  body?: string;
  link?: string;
}

/** Insert one notification row per recipient. Dedupes ids; skips actor. */
export async function notifyUsers(
  companyId: string,
  userIds: (string | null | undefined)[],
  payload: NotifyPayload,
  excludeUserId?: string,
): Promise<void> {
  try {
    const ids = Array.from(new Set(userIds.filter((x): x is string => !!x)))
      .filter((id) => id !== excludeUserId);
    if (!ids.length) return;
    await db.insert(notifications).values(
      ids.map((userId) => ({
        companyId,
        userId,
        title: payload.title.slice(0, 300),
        body: payload.body ?? null,
        link: payload.link ?? null,
      }))
    );
    // Mirror to OS-level push (desktop + phone), which reaches users even
    // when the app tab is closed. Fire-and-forget.
    import('@/lib/push')
      .then(({ sendPushToUsers }) => sendPushToUsers(ids, payload))
      .catch(() => {});
  } catch (err) {
    console.error('[notify] insert failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}

/**
 * Leaders of every team a user belongs to. Used so a deal update pings both
 * the assigned rep AND their team leader(s).
 */
export async function leadersOf(userId: string): Promise<string[]> {
  try {
    const memberships = await db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId));
    const teamIds = memberships.map((m) => m.teamId);
    if (!teamIds.length) return [];
    const leaders = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(inArray(teamMembers.teamId, teamIds), eq(teamMembers.isLeader, true)));
    return Array.from(new Set(leaders.map((l) => l.userId).filter((id) => id !== userId)));
  } catch {
    return [];
  }
}

/** All admin user-ids in a company (for approval-queue pings). */
export async function companyAdminIds(companyId: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.companyId, companyId), eq(users.role, 'company_admin'), eq(users.isActive, true)));
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

/**
 * Deal-update notification: pings the assigned rep + their team leader(s)
 * with a human-readable summary of exactly what changed. The actor (whoever
 * made the change) is excluded — you don't need a ping about your own edit.
 */
export async function notifyDealUpdate(opts: {
  companyId: string;
  dealId: string;
  dealName: string;
  assignedRepId: string | null;
  actorId: string;
  actorName: string;
  changes: string[];
}): Promise<void> {
  if (!opts.changes.length) return;
  const recipients: string[] = [];
  if (opts.assignedRepId) {
    recipients.push(opts.assignedRepId);
    recipients.push(...(await leadersOf(opts.assignedRepId)));
  }
  await notifyUsers(
    opts.companyId,
    recipients,
    {
      title: `Deal updated: ${opts.dealName}`,
      body: `${opts.actorName} changed ${opts.changes.join(', ')}.`,
      link: `/active-deals?deal=${opts.dealId}`,
    },
    opts.actorId,
  );
}

/** Human-readable labels for deal fields shown in "what changed" summaries. */
export const DEAL_FIELD_LABELS: Record<string, string> = {
  name: 'deal name',
  status: 'status',
  assignedRepId: 'assigned rep',
  offerAmount: 'offer amount',
  offerNotes: 'offer notes',
  fundedAmount: 'funded amount',
  netAmount: 'net amount',
  feePct: 'fee %',
  factorRate: 'factor rate',
  termMode: 'term mode',
  termCount: 'term count',
  fundingDate: 'funding date',
  fundedWithFunderId: 'funder',
  fundedWithName: 'funder',
  fundedNotes: 'funded notes',
  fundedSubStatus: 'funded status',
  merchantFirstName: 'merchant name',
  merchantLastName: 'merchant name',
  merchantEmail: 'merchant email',
  merchantPhone: 'merchant phone',
  dealType: 'deal type',
  amountCollected: 'amount collected',
  renewalNotes: 'renewal notes',
};
