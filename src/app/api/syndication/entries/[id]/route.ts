import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { syndicationDeals, syndicationEntries } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/syndication/entries/[id] — remove a syndication entry.
 * The rep who added it (or an admin) only. Tenant-guarded via the parent deal.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const [entry] = await db.select().from(syndicationEntries)
      .where(eq(syndicationEntries.id, params.id)).limit(1);
    if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const [deal] = await db.select({ companyId: syndicationDeals.companyId })
      .from(syndicationDeals)
      .where(eq(syndicationDeals.id, entry.syndicationDealId)).limit(1);
    if (!deal || deal.companyId !== ctx.companyId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const isAdmin = ctx.user.role === 'company_admin' || ctx.user.role === 'master_admin';
    if (!isAdmin && entry.userId !== ctx.user.id) {
      return NextResponse.json({ error: 'You can only remove your own entry.' }, { status: 403 });
    }
    await db.delete(syndicationEntries)
      .where(and(eq(syndicationEntries.id, entry.id)));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
