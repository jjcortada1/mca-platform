import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { worksheetRows } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { getWorksheetAccess } from '@/lib/worksheets';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  // The full row-id order, top to bottom. Ids not in the list keep their
  // position after the listed ones (defensive — the client sends all).
  rowIds: z.array(z.string().uuid()).min(1).max(5000),
});

/**
 * POST /api/worksheets/[id]/reorder — persist a drag-reorder (move row 50 to
 * row 3, etc.). Owner or edit access. sort_order is rewritten to match the
 * given sequence; GET returns rows ordered by sort_order, so the custom
 * order sticks for everyone the sheet is shared with.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const access = await getWorksheetAccess(params.id, ctx.user.id);
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (access.role === 'view') {
      return NextResponse.json({ error: 'You have view-only access to this sheet.' }, { status: 403 });
    }
    const body = schema.parse(await req.json());
    // Scoped per-row update: the worksheetId condition means ids from OTHER
    // sheets are silently ignored (can't be used to touch foreign rows).
    for (let i = 0; i < body.rowIds.length; i++) {
      await db.update(worksheetRows)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(and(eq(worksheetRows.id, body.rowIds[i]), eq(worksheetRows.worksheetId, params.id)));
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
