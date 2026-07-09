import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { worksheetShares, users } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { getWorksheetAccess } from '@/lib/worksheets';
import { notifyUsers } from '@/lib/notify';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — who this sheet is shared with. Owner only. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const access = await getWorksheetAccess(params.id, ctx.user.id);
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (access.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 });
    const rows = await db.select().from(worksheetShares)
      .where(eq(worksheetShares.worksheetId, params.id));
    return NextResponse.json({ data: rows.map((r) => ({ id: r.id, email: r.email, role: r.role })) });
  } catch (e) { return apiError(e); }
}

const shareSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(['view', 'edit']),
});

/**
 * POST — share this sheet with an email. The email must already belong to a
 * user in the system — ANY company counts (that's the point: partners at
 * other brokerages on this platform can be given access to one sheet, and
 * only that sheet). Re-sharing the same email just updates the role.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const access = await getWorksheetAccess(params.id, ctx.user.id);
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (access.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 });
    const body = shareSchema.parse(await req.json());
    const email = body.email.trim().toLowerCase();

    if (email === ctx.user.email.toLowerCase()) {
      return NextResponse.json({ error: 'That\'s you — the owner already has full access.' }, { status: 400 });
    }
    // Global lookup — deliberately NOT scoped to the owner's company.
    const [target] = await db.select({ id: users.id, isActive: users.isActive })
      .from(users).where(eq(users.email, email)).limit(1);
    if (!target || target.isActive === false) {
      return NextResponse.json(
        { error: `No account with the email ${email} exists in the system. They need an account (at any company on the platform) before you can share with them.` },
        { status: 404 },
      );
    }

    const [existing] = await db.select().from(worksheetShares)
      .where(and(eq(worksheetShares.worksheetId, params.id), eq(worksheetShares.userId, target.id)))
      .limit(1);
    if (existing) {
      await db.update(worksheetShares).set({ role: body.role }).where(eq(worksheetShares.id, existing.id));
      return NextResponse.json({ ok: true, data: { id: existing.id, email, role: body.role } });
    }
    const [row] = await db.insert(worksheetShares).values({
      worksheetId: params.id,
      userId: target.id,
      email,
      role: body.role,
    }).returning();

    // Let them know a sheet was shared with them.
    notifyUsers(ctx.companyId, [target.id], {
      title: `Sheet shared with you: ${access.sheet.name}`,
      body: `${ctx.user.name || ctx.user.email} gave you ${body.role === 'edit' ? 'edit' : 'view'} access.`,
      link: `/worksheets?sheet=${params.id}`,
    }, ctx.user.id).catch(() => {});

    return NextResponse.json({ ok: true, data: { id: row.id, email, role: row.role } });
  } catch (e) { return apiError(e); }
}

/** DELETE — remove a share (?shareId=...). Owner only. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const access = await getWorksheetAccess(params.id, ctx.user.id);
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (access.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 });
    const shareId = new URL(req.url).searchParams.get('shareId');
    if (!shareId) return NextResponse.json({ error: 'shareId required' }, { status: 400 });
    await db.delete(worksheetShares)
      .where(and(eq(worksheetShares.id, shareId), eq(worksheetShares.worksheetId, params.id)));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
