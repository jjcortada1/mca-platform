import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { leadSources, leadSourceCommissions } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import type { SessionUser } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { z } from 'zod';

export const runtime = 'nodejs';

function isAdmin(u: SessionUser) {
  return u.role === 'company_admin' || u.role === 'master_admin' || hasPermission(u, 'commissions.manage');
}

const schema = z.object({
  name: z.string().min(1).max(200).optional(),
  contactEmail: z.string().email().optional().nullable().or(z.literal('')),
  contactPhone: z.string().max(50).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  isActive: z.boolean().optional(),
});

/** PATCH /api/lead-sources/[id] — admin edits a lead source. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    const body = schema.parse(await req.json());

    const [ls] = await db.select().from(leadSources)
      .where(and(eq(leadSources.id, params.id), eq(leadSources.companyId, ctx.companyId))).limit(1);
    if (!ls) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.contactEmail !== undefined) updates.contactEmail = body.contactEmail || null;
    if (body.contactPhone !== undefined) updates.contactPhone = body.contactPhone || null;
    if (body.notes !== undefined) updates.notes = body.notes || null;
    if (body.isActive !== undefined) updates.isActive = body.isActive;

    if (Object.keys(updates).length) {
      await db.update(leadSources).set(updates).where(and(eq(leadSources.id, params.id), eq(leadSources.companyId, ctx.companyId)));
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

/**
 * DELETE /api/lead-sources/[id]
 * Refuses if the lead source has commissions attached (to protect history) —
 * the admin should deactivate instead. A clean lead source can be removed.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const [ls] = await db.select().from(leadSources)
      .where(and(eq(leadSources.id, params.id), eq(leadSources.companyId, ctx.companyId))).limit(1);
    if (!ls) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [hasComm] = await db.select({ id: leadSourceCommissions.id }).from(leadSourceCommissions)
      .where(and(eq(leadSourceCommissions.leadSourceId, params.id), eq(leadSourceCommissions.companyId, ctx.companyId))).limit(1);
    if (hasComm) {
      return NextResponse.json({ error: 'This lead source has commissions. Deactivate it instead of deleting.' }, { status: 400 });
    }

    await db.delete(leadSources).where(and(eq(leadSources.id, params.id), eq(leadSources.companyId, ctx.companyId)));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
