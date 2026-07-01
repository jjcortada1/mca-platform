import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { teams, teamMembers, users } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { requireTenantContext, requireCompanyAdmin } from '@/lib/auth/context';
import { handle, ok, created, badRequest } from '@/lib/api/response';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

/**
 * GET — list this company's teams with their members (any authenticated
 * company user; needed so the task form can offer team/assignee options).
 */
export const GET = handle(async () => {
  const ctx = await requireTenantContext();
  const teamRows = await db.select().from(teams)
    .where(eq(teams.companyId, ctx.companyId))
    .orderBy(teams.name);

  const teamIds = teamRows.map((t) => t.id);
  const memberRows = teamIds.length
    ? await db
        .select({
          teamId: teamMembers.teamId,
          userId: teamMembers.userId,
          isLeader: teamMembers.isLeader,
          name: users.name,
          email: users.email,
        })
        .from(teamMembers)
        .innerJoin(users, eq(users.id, teamMembers.userId))
        .where(inArray(teamMembers.teamId, teamIds))
    : [];

  const data = teamRows.map((t) => ({
    id: t.id,
    name: t.name,
    members: memberRows
      .filter((m) => m.teamId === t.id)
      .map((m) => ({ userId: m.userId, name: m.name, email: m.email, isLeader: m.isLeader })),
  }));
  return ok({ data });
});

const createTeamSchema = z.object({
  name: z.string().min(1).max(200),
  // Members with a leader flag. A team can have multiple leaders.
  members: z.array(z.object({
    userId: z.string().uuid(),
    isLeader: z.boolean().default(false),
  })).default([]),
});

/** POST — create a team (admin only). */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await requireCompanyAdmin();
  const parsed = createTeamSchema.parse(await req.json());

  // Validate all member userIds belong to this company (cross-tenant guard).
  const memberIds = parsed.members.map((m) => m.userId);
  if (memberIds.length) {
    const valid = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.companyId, ctx.companyId), inArray(users.id, memberIds)));
    if (valid.length !== memberIds.length) {
      return badRequest('One or more members are not users of this company.');
    }
  }

  const [team] = await db.insert(teams).values({
    companyId: ctx.companyId,
    name: parsed.name.trim(),
  }).returning();

  if (parsed.members.length) {
    await db.insert(teamMembers).values(parsed.members.map((m) => ({
      teamId: team.id, userId: m.userId, isLeader: m.isLeader,
    })));
  }
  return created({ id: team.id });
});
