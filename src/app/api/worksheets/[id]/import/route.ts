import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { worksheets, worksheetRows } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { getWorksheetAccess } from '@/lib/worksheets';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  // 'append' adds below existing rows; 'overwrite' REPLACES this sheet's
  // rows (owner only — it's destructive to the sheet, and only the sheet).
  mode: z.enum(['append', 'overwrite']),
  // Optional new/updated column set (owner only) so imports can bring their
  // own headers. Order is preserved from the file.
  columns: z.array(z.object({
    id: z.string().min(1).max(40),
    label: z.string().min(1).max(120),
    width: z.number().int().min(60).max(1200).optional(),
  })).max(30).optional(),
  // Rows as cells keyed by column id, in file order.
  rows: z.array(z.record(z.string(), z.string().max(4000))).max(2000),
});

/**
 * POST /api/worksheets/[id]/import — bulk-load rows parsed client-side from
 * a Google Sheets / Excel / CSV file. Row + column ORDER is preserved.
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

    if (body.mode === 'overwrite' && access.role !== 'owner') {
      return NextResponse.json({ error: 'Only the sheet owner can overwrite existing rows.' }, { status: 403 });
    }
    if (body.columns && access.role !== 'owner') {
      return NextResponse.json({ error: 'Only the sheet owner can change columns.' }, { status: 403 });
    }

    // Column update first (owner only), so imported cells line up.
    if (body.columns && body.columns.length) {
      await db.update(worksheets)
        .set({ columns: body.columns, updatedAt: new Date() })
        .where(eq(worksheets.id, params.id));
    }

    let startOrder = 0;
    if (body.mode === 'overwrite') {
      // Destroys ONLY this sheet's rows — never touches any other data.
      await db.delete(worksheetRows).where(eq(worksheetRows.worksheetId, params.id));
    } else {
      const existing = await db.select({ sortOrder: worksheetRows.sortOrder })
        .from(worksheetRows)
        .where(eq(worksheetRows.worksheetId, params.id))
        .orderBy(asc(worksheetRows.sortOrder));
      startOrder = existing.length ? Math.max(...existing.map((r) => r.sortOrder)) + 1 : 0;
    }

    if (body.rows.length) {
      // Chunked inserts keep statement size sane for big files.
      const CHUNK = 200;
      for (let i = 0; i < body.rows.length; i += CHUNK) {
        const chunk = body.rows.slice(i, i + CHUNK);
        await db.insert(worksheetRows).values(chunk.map((cells, j) => ({
          worksheetId: params.id,
          cells,
          sortOrder: startOrder + i + j,
          createdBy: ctx.user.id,
        })));
      }
    }
    await db.update(worksheets).set({ updatedAt: new Date() }).where(eq(worksheets.id, params.id));
    return NextResponse.json({ ok: true, imported: body.rows.length });
  } catch (e) { return apiError(e); }
}
