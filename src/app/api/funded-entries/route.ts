import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { fundedEntries, users } from '@/lib/db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { fundedEntrySchema } from '@/lib/validation/schemas';
import { apiError } from '@/lib/api/errors';
import { fromDateInput } from '@/lib/dates';
import { visibleRepIds } from '@/lib/auth/team-scope';

export async function GET() {
  try {
    const ctx = await requirePermission('funded_board.view');

    // Performance visibility: admins see the whole company's board; team
    // leaders see their team's; everyone else sees only their own entries.
    const isAdmin = ctx.user.role === 'company_admin' || ctx.user.role === 'master_admin';
    const scope = isAdmin ? null : await visibleRepIds(ctx.user.id);

    const entries = await db.select().from(fundedEntries)
      .where(and(
        eq(fundedEntries.companyId, ctx.companyId),
        ...(scope ? [inArray(fundedEntries.repId, scope)] : []),
      ))
      .orderBy(desc(fundedEntries.fundedDate));

    const repIds = Array.from(new Set(entries.map((e) => e.repId)));
    const reps = repIds.length
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, repIds))
      : [];
    const repMap = new Map(reps.map((r) => [r.id, r.name]));

    const data = entries.map((e) => ({
      id: e.id,
      repId: e.repId,
      repName: repMap.get(e.repId) ?? 'Unknown',
      dealInitials: e.dealInitials,
      amountFunded: parseFloat(String(e.amountFunded)),
      fundedWith: e.fundedWith,
      fundedDate: e.fundedDate,
      notes: e.notes,
      createdAt: e.createdAt,
    }));
    return NextResponse.json({ entries: data, data });
  } catch (e) { return apiError(e); }
}

export async function POST(req: NextRequest) {
  try {
    // Same permission as reading the board — before this, POST only needed a
    // session, so even a lead-source login could write leaderboard entries.
    const ctx = await requirePermission('funded_board.view');
    // Reps can post for themselves; admins can post for anyone in the company
    const body = fundedEntrySchema.parse(await req.json());

    const isAdmin = ctx.user.role === 'company_admin' || ctx.user.role === 'master_admin';
    if (!isAdmin && body.repId !== ctx.user.id) {
      return NextResponse.json({ error: 'You can only log your own deals' }, { status: 403 });
    }

    // Verify repId belongs to the current company for EVERY caller — before,
    // only the company_admin path checked, so other roles could attach an
    // arbitrary (even cross-company) user id to an entry.
    const [rep] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.id, body.repId), eq(users.companyId, ctx.companyId))).limit(1);
    if (!rep) return NextResponse.json({ error: 'Rep not in this company' }, { status: 400 });

    const [e] = await db.insert(fundedEntries).values({
      companyId: ctx.companyId,
      repId: body.repId,
      dealInitials: body.dealInitials,
      amountFunded: String(body.amountFunded),
      fundedWith: body.fundedWith ?? null,
      fundedDate: body.fundedDate ? fromDateInput(body.fundedDate) ?? new Date() : new Date(),
      notes: body.notes ?? null,
    }).returning();
    return NextResponse.json({ entry: e });
  } catch (e) { return apiError(e); }
}
