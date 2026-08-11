import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { courtSearches } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/court/searches?dealId= — past lookups, newest first.
 * Always scoped to the caller's company; a deal id only narrows further.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireTenantContext();
    const dealId = new URL(req.url).searchParams.get('dealId');

    const where = dealId
      ? and(eq(courtSearches.companyId, ctx.companyId), eq(courtSearches.dealId, dealId))
      : eq(courtSearches.companyId, ctx.companyId);

    const rows = await db.select().from(courtSearches)
      .where(where)
      .orderBy(desc(courtSearches.createdAt))
      .limit(50);

    return NextResponse.json({ data: rows });
  } catch (e) { return apiError(e); }
}
