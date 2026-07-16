import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { worksheets } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  // The owner's sheet-tab order, left to right.
  sheetIds: z.array(z.string().uuid()).min(1).max(200),
});

/**
 * POST /api/worksheets/reorder — persist drag-reordering of the sheet TABS.
 * Only sheets the caller OWNS are touched (the ownerUserId condition means
 * foreign ids in the list are silently ignored); shared-with-me sheets keep
 * their own owner's order.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    const body = schema.parse(await req.json());
    for (let i = 0; i < body.sheetIds.length; i++) {
      await db.update(worksheets)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(and(eq(worksheets.id, body.sheetIds[i]), eq(worksheets.ownerUserId, ctx.user.id)));
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
