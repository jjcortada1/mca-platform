import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { tasks, teamMembers } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { requireTenantContext } from '@/lib/auth/context';
import { handle, ok, badRequest, notFound, forbidden, noContent } from '@/lib/api/response';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const updateTaskSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional().nullable(),
  assignedToUserId: z.string().uuid().optional().nullable(),
  teamId: z.string().uuid().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  status: z.enum(['open', 'handling', 'completed']).optional(),
});

/** Can this user act on this task? Assignee, creator, admins, and the
 *  assignee's team leader(s) all can. Company-wide tasks: anyone can
 *  mark handling/completed (that's the point of a shared task). */
async function canTouch(
  task: { assignedToUserId: string | null; teamId: string | null; createdBy: string | null },
  userId: string,
  isAdmin: boolean,
): Promise<boolean> {
  if (isAdmin) return true;
  if (task.assignedToUserId === null) return true;
  if (task.assignedToUserId === userId || task.createdBy === userId) return true;
  const myLeaderTeams = await db.select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.isLeader, true)));
  const teamIds = myLeaderTeams.map((t) => t.teamId);
  if (!teamIds.length) return false;
  if (task.teamId && teamIds.includes(task.teamId)) return true;
  const members = await db.select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(inArray(teamMembers.teamId, teamIds));
  return members.some((m) => m.userId === task.assignedToUserId);
}

export const PATCH = handle(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await requireTenantContext();
  const isAdmin = ctx.user.role === 'company_admin' || ctx.user.role === 'master_admin';
  const parsed = updateTaskSchema.parse(await req.json());

  const [task] = await db.select().from(tasks)
    .where(and(eq(tasks.id, params.id), eq(tasks.companyId, ctx.companyId), eq(tasks.isDeleted, false)))
    .limit(1);
  if (!task) return notFound('Task not found');
  if (!(await canTouch(task, ctx.user.id, isAdmin))) {
    return forbidden('You don\'t have access to this task.');
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.title !== undefined) set.title = parsed.title.trim();
  if (parsed.description !== undefined) set.description = parsed.description?.trim() || null;
  if (parsed.assignedToUserId !== undefined) set.assignedToUserId = parsed.assignedToUserId;
  if (parsed.teamId !== undefined) set.teamId = parsed.teamId;
  if (parsed.dueDate !== undefined) {
    if (parsed.dueDate) {
      const d = new Date(parsed.dueDate);
      if (isNaN(d.getTime())) return badRequest('Invalid due date.');
      set.dueDate = d;
    } else {
      set.dueDate = null;
    }
  }
  if (parsed.status) {
    set.status = parsed.status;
    if (parsed.status === 'handling') {
      // Record who took it so nobody doubles up.
      set.handledBy = ctx.user.id;
      set.completedAt = null;
    } else if (parsed.status === 'completed') {
      set.completedAt = new Date();
      // Keep handledBy — if nobody claimed it first, the completer did the work.
      if (!task.handledBy) set.handledBy = ctx.user.id;
    } else {
      // Back to open — clear the claim.
      set.handledBy = null;
      set.completedAt = null;
    }
  }

  await db.update(tasks).set(set).where(eq(tasks.id, task.id));
  return ok({ ok: true });
});

export const DELETE = handle(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await requireTenantContext();
  const isAdmin = ctx.user.role === 'company_admin' || ctx.user.role === 'master_admin';

  const [task] = await db.select().from(tasks)
    .where(and(eq(tasks.id, params.id), eq(tasks.companyId, ctx.companyId), eq(tasks.isDeleted, false)))
    .limit(1);
  if (!task) return notFound('Task not found');
  // Delete is tighter than edit: only admins and the creator.
  if (!isAdmin && task.createdBy !== ctx.user.id) {
    return forbidden('Only admins or the task creator can delete a task.');
  }
  await db.update(tasks).set({ isDeleted: true, updatedAt: new Date() }).where(eq(tasks.id, task.id));
  return noContent();
});
