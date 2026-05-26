import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { funderTiers } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import { z } from 'zod';
import { apiError } from '@/lib/api/errors';

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

/**
 * POST /api/funder-tiers/reorder
 * Body: { ids: [tierId, tierId, ...] in display order }
 * Updates sortOrder of each to match its index in the array.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    if (!hasPermission(ctx.user, 'funders.edit')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { ids } = schema.parse(await req.json());

    // Defense in depth: only reorder tiers that actually belong to this company
    const valid = await db
      .select({ id: funderTiers.id })
      .from(funderTiers)
      .where(and(eq(funderTiers.companyId, ctx.companyId), inArray(funderTiers.id, ids)));
    const validSet = new Set(valid.map((t) => t.id));

    for (let i = 0; i < ids.length; i++) {
      if (!validSet.has(ids[i])) continue;
      await db
        .update(funderTiers)
        .set({ sortOrder: i })
        .where(and(eq(funderTiers.id, ids[i]), eq(funderTiers.companyId, ctx.companyId)));
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
