import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { teams, teamMembers, users } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { requireCompanyAdmin } from '@/lib/auth/context';
import { handle, ok, badRequest, notFound, noContent } from '@/lib/api/response';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const updateTeamSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  // Full replacement of the member list when provided.
  members: z.array(z.object({
    userId: z.string().uuid(),
    isLeader: z.boolean().default(false),
  })).optional(),
});

/** PATCH — rename team / replace member list (admin only). */
export const PATCH = handle(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await requireCompanyAdmin();
  const parsed = updateTeamSchema.parse(await req.json());

  const [team] = await db.select().from(teams)
    .where(and(eq(teams.id, params.id), eq(teams.companyId, ctx.companyId)))
    .limit(1);
  if (!team) return notFound('Team not found');

  if (parsed.name) {
    await db.update(teams).set({ name: parsed.name.trim(), updatedAt: new Date() })
      .where(eq(teams.id, team.id));
  }

  if (parsed.members) {
    const memberIds = parsed.members.map((m) => m.userId);
    if (memberIds.length) {
      const valid = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.companyId, ctx.companyId), inArray(users.id, memberIds)));
      if (valid.length !== memberIds.length) {
        return badRequest('One or more members are not users of this company.');
      }
    }
    await db.delete(teamMembers).where(eq(teamMembers.teamId, team.id));
    if (parsed.members.length) {
      await db.insert(teamMembers).values(parsed.members.map((m) => ({
        teamId: team.id, userId: m.userId, isLeader: m.isLeader,
      })));
    }
  }
  return ok({ ok: true });
});

/** DELETE — remove a team (admin only). Tasks keep their assignee; their
 *  team link just nulls out via ON DELETE SET NULL. */
export const DELETE = handle(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await requireCompanyAdmin();
  const [team] = await db.select().from(teams)
    .where(and(eq(teams.id, params.id), eq(teams.companyId, ctx.companyId)))
    .limit(1);
  if (!team) return notFound('Team not found');
  await db.delete(teams).where(eq(teams.id, team.id));
  return noContent();
});
