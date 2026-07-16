import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { esignRequests } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/esign/requests/[id] — remove a "recent applications sent"
 * record. The list is company-wide, but deleting is limited to the person
 * who sent it or a company admin, so one rep can't clear another rep's
 * history. Always scoped to the caller's company.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('deals.submit');
    const [row] = await db.select({ id: esignRequests.id, createdBy: esignRequests.createdBy })
      .from(esignRequests)
      .where(and(eq(esignRequests.id, params.id), eq(esignRequests.companyId, ctx.companyId)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const isAdmin = ctx.user.role === 'company_admin' || ctx.user.role === 'master_admin';
    if (!isAdmin && row.createdBy !== ctx.user.id) {
      return NextResponse.json({ error: 'You can only delete applications you sent.' }, { status: 403 });
    }

    await db.delete(esignRequests)
      .where(and(eq(esignRequests.id, params.id), eq(esignRequests.companyId, ctx.companyId)));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
