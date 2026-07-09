import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { worksheets, worksheetShares, users } from '@/lib/db/schema';
import { and, eq, inArray, asc } from 'drizzle-orm';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { defaultColumns } from '@/lib/worksheets';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/worksheets — every sheet I OWN plus every sheet SHARED with me
 * (shares can come from users at other companies — intentional).
 */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    if (ctx.user.role === 'lead_source') {
      return NextResponse.json({ error: 'Not available for this account' }, { status: 403 });
    }
    const own = await db.select().from(worksheets)
      .where(and(eq(worksheets.ownerUserId, ctx.user.id), eq(worksheets.isDeleted, false)))
      .orderBy(asc(worksheets.sortOrder), asc(worksheets.createdAt));

    const shares = await db.select().from(worksheetShares)
      .where(eq(worksheetShares.userId, ctx.user.id));
    const sharedIds = shares.map((s) => s.worksheetId).filter((id) => !own.some((o) => o.id === id));
    const shared = sharedIds.length
      ? await db.select().from(worksheets)
          .where(and(inArray(worksheets.id, sharedIds), eq(worksheets.isDeleted, false)))
      : [];
    // Owner names for the "shared with me" labels.
    const ownerIds = Array.from(new Set(shared.map((s) => s.ownerUserId)));
    const owners = ownerIds.length
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ownerIds))
      : [];
    const ownerName = new Map(owners.map((o) => [o.id, o.name]));
    const roleBySheet = new Map(shares.map((s) => [s.worksheetId, s.role]));

    const data = [
      ...own.map((s) => ({ id: s.id, name: s.name, columns: s.columns, myRole: 'owner' as const, ownerName: null })),
      ...shared.map((s) => ({
        id: s.id, name: s.name, columns: s.columns,
        myRole: (roleBySheet.get(s.id) === 'edit' ? 'edit' : 'view') as 'edit' | 'view',
        ownerName: ownerName.get(s.ownerUserId) ?? 'someone',
      })),
    ];
    return NextResponse.json({ data });
  } catch (e) { return apiError(e); }
}

const createSchema = z.object({ name: z.string().min(1).max(200) });

/** POST — create a new sheet (with sensible default columns). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    if (ctx.user.role === 'lead_source') {
      return NextResponse.json({ error: 'Not available for this account' }, { status: 403 });
    }
    const body = createSchema.parse(await req.json());
    const [row] = await db.insert(worksheets).values({
      ownerUserId: ctx.user.id,
      companyId: ctx.companyId,
      name: body.name.trim(),
      columns: defaultColumns(),
    }).returning();
    return NextResponse.json({ ok: true, data: row });
  } catch (e) { return apiError(e); }
}
