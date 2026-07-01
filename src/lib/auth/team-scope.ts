import { db } from '@/lib/db/client';
import { teamMembers } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';

/**
 * The set of rep user-IDs whose WORK (deals, submissions) a given non-admin
 * user is allowed to see:
 *
 *   - Always themselves.
 *   - If they LEAD one or more teams, every member of those teams.
 *
 * This powers team-leader visibility: a leader sees their reps' deals and
 * submissions. It intentionally does NOT extend to commissions — money stays
 * scoped to the individual rep + admins (enforced in the commissions routes,
 * which don't call this).
 *
 * Admins don't need this (they see everything); call it only on the
 * rep/lead-leader path.
 */
export async function visibleRepIds(userId: string): Promise<string[]> {
  const ids = new Set<string>([userId]);

  // Teams this user leads.
  const led = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.isLeader, true)));
  const teamIds = led.map((t) => t.teamId);
  if (teamIds.length) {
    const members = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(inArray(teamMembers.teamId, teamIds));
    for (const m of members) ids.add(m.userId);
  }

  return Array.from(ids);
}
