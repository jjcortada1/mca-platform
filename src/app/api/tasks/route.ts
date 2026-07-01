import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { tasks, teamMembers, users } from '@/lib/db/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { requireTenantContext } from '@/lib/auth/context';
import { handle, ok, created, badRequest, forbidden } from '@/lib/api/response';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

/**
 * Visibility model:
 *   - Admins see every task in the company.
 *   - Everyone sees company-wide tasks (assignedToUserId = null).
 *   - A broker sees tasks assigned to them.
 *   - A team LEADER also sees tasks assigned to members of their team(s)
 *     and tasks attached to their team(s).
 */
async function leaderScope(userId: string): Promise<{ teamIds: string[]; memberIds: string[] }> {
  const myLeaderTeams = await db.select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.isLeader, true)));
  const teamIds = myLeaderTeams.map((t) => t.teamId);
  if (!teamIds.length) return { teamIds: [], memberIds: [] };
  const members = await db.select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(inArray(teamMembers.teamId, teamIds));
  return { teamIds, memberIds: members.map((m) => m.userId) };
}

export const GET = handle(async () => {
  const ctx = await requireTenantContext();
  const isAdmin = ctx.user.role === 'company_admin' || ctx.user.role === 'master_admin';

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      assignedToUserId: tasks.assignedToUserId,
      teamId: tasks.teamId,
      dueDate: tasks.dueDate,
      status: tasks.status,
      handledBy: tasks.handledBy,
      completedAt: tasks.completedAt,
      createdBy: tasks.createdBy,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(and(eq(tasks.companyId, ctx.companyId), eq(tasks.isDeleted, false)))
    .orderBy(desc(tasks.createdAt));

  let visible = rows;
  if (!isAdmin) {
    const { teamIds, memberIds } = await leaderScope(ctx.user.id);
    visible = rows.filter((t) =>
      t.assignedToUserId === null ||
      t.assignedToUserId === ctx.user.id ||
      t.createdBy === ctx.user.id ||
      (t.assignedToUserId !== null && memberIds.includes(t.assignedToUserId)) ||
      (t.teamId !== null && teamIds.includes(t.teamId))
    );
  }

  // Resolve display names in one query so the UI doesn't need N lookups.
  const nameIds = Array.from(new Set(
    visible.flatMap((t) => [t.assignedToUserId, t.handledBy, t.createdBy]).filter(Boolean) as string[]
  ));
  const nameRows = nameIds.length
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, nameIds))
    : [];
  const nameById = new Map(nameRows.map((u) => [u.id, u.name]));

  return ok({
    data: visible.map((t) => ({
      ...t,
      assignedToName: t.assignedToUserId ? nameById.get(t.assignedToUserId) ?? null : null,
      handledByName: t.handledBy ? nameById.get(t.handledBy) ?? null : null,
      createdByName: t.createdBy ? nameById.get(t.createdBy) ?? null : null,
    })),
    me: { id: ctx.user.id, isAdmin },
  });
});

const createTaskSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional().nullable(),
  // null/absent = company-wide task
  assignedToUserId: z.string().uuid().optional().nullable(),
  teamId: z.string().uuid().optional().nullable(),
  dueDate: z.string().optional().nullable(), // ISO date (yyyy-mm-dd) or full ISO
});

export const POST = handle(async (req: NextRequest) => {
  const ctx = await requireTenantContext();
  const parsed = createTaskSchema.parse(await req.json());
  const isAdmin = ctx.user.role === 'company_admin' || ctx.user.role === 'master_admin';

  // Assigning to someone ELSE requires admin or team-leader-over-that-person.
  if (parsed.assignedToUserId && parsed.assignedToUserId !== ctx.user.id && !isAdmin) {
    const { memberIds } = await leaderScope(ctx.user.id);
    if (!memberIds.includes(parsed.assignedToUserId)) {
      return forbidden('Only admins or the assignee\'s team leader can assign tasks to others.');
    }
  }
  // Company-wide tasks are admin-only — otherwise anyone could broadcast.
  if (!parsed.assignedToUserId && !isAdmin) {
    return badRequest('Company-wide tasks can only be created by an admin. Assign the task to yourself or a teammate instead.');
  }

  if (parsed.assignedToUserId) {
    const [assignee] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.id, parsed.assignedToUserId), eq(users.companyId, ctx.companyId)))
      .limit(1);
    if (!assignee) return badRequest('Assignee is not a user of this company.');
  }

  let due: Date | null = null;
  if (parsed.dueDate) {
    const d = new Date(parsed.dueDate);
    if (isNaN(d.getTime())) return badRequest('Invalid due date.');
    due = d;
  }

  const [task] = await db.insert(tasks).values({
    companyId: ctx.companyId,
    title: parsed.title.trim(),
    description: parsed.description?.trim() || null,
    assignedToUserId: parsed.assignedToUserId ?? null,
    teamId: parsed.teamId ?? null,
    dueDate: due,
    createdBy: ctx.user.id,
  }).returning();

  return created({ id: task.id });
});
