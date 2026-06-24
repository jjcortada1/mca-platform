import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { dealSyndications } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import type { SessionUser } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAdmin(u: SessionUser) {
  return u.role === 'company_admin' || u.role === 'master_admin' || hasPermission(u, 'commissions.manage');
}

/**
 * DELETE /api/deals/[id]/syndications/[sid]
 *
 * Soft-delete a syndication record. Preserves the row in the DB so
 * audit/history is intact; just hides it from all queries via
 * isDeleted=true. The {id} path segment is the deal id (for route
 * parity with the listing route); ownership check uses the syndication
 * row's own companyId so deal-id mismatches are caught.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; sid: string } }) {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    // Verify the syndication exists, belongs to this company AND this
    // deal. If any of those don't line up, treat as not-found rather
    // than leaking which one mismatched.
    const [existing] = await db.select()
      .from(dealSyndications)
      .where(and(
        eq(dealSyndications.id, params.sid),
        eq(dealSyndications.dealId, params.id),
        eq(dealSyndications.companyId, ctx.companyId),
        eq(dealSyndications.isDeleted, false),
      ))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Syndication not found' }, { status: 404 });

    await db.update(dealSyndications)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(eq(dealSyndications.id, params.sid));

    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
