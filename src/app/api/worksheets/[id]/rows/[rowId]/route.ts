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

const patchSchema = z.object({
  cells: z.record(z.string(), z.string().max(4000)),
});

/** PATCH — update a row's cells. Owner or edit access on the parent sheet. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; rowId: string } }) {
  try {
    const ctx = await requireTenantContext();
    const access = await getWorksheetAccess(params.id, ctx.user.id);
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (access.role === 'view') {
      return NextResponse.json({ error: 'You have view-only access to this sheet.' }, { status: 403 });
    }
    const body = patchSchema.parse(await req.json());
    await db.update(worksheetRows)
      .set({ cells: body.cells, updatedAt: new Date() })
      .where(and(eq(worksheetRows.id, params.rowId), eq(worksheetRows.worksheetId, params.id)));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

/** DELETE — remove a row. Owner or edit access. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; rowId: string } }) {
  try {
    const ctx = await requireTenantContext();
    const access = await getWorksheetAccess(params.id, ctx.user.id);
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (access.role === 'view') {
      return NextResponse.json({ error: 'You have view-only access to this sheet.' }, { status: 403 });
    }
    await db.delete(worksheetRows)
      .where(and(eq(worksheetRows.id, params.rowId), eq(worksheetRows.worksheetId, params.id)));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
