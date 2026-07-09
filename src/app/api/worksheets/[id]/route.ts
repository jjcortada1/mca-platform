import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { worksheets, worksheetRows } from '@/lib/db/schema';
import { and, eq, asc } from 'drizzle-orm';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { getWorksheetAccess } from '@/lib/worksheets';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** GET — one sheet with all its rows. Owner or shared (view/edit). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const access = await getWorksheetAccess(params.id, ctx.user.id);
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const rows = await db.select().from(worksheetRows)
      .where(eq(worksheetRows.worksheetId, params.id))
      .orderBy(asc(worksheetRows.sortOrder), asc(worksheetRows.createdAt));
    return NextResponse.json({
      data: {
        id: access.sheet.id,
        name: access.sheet.name,
        columns: access.sheet.columns,
        myRole: access.role,
        rows: rows.map((r) => ({ id: r.id, cells: r.cells })),
      },
    });
  } catch (e) { return apiError(e); }
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  columns: z.array(z.object({
    id: z.string().min(1).max(40),
    label: z.string().min(1).max(120),
    // Column width in px (drag-resizable in the UI). Optional; clamped.
    width: z.number().int().min(60).max(1200).optional(),
  })).max(30).optional(),
});

/** PATCH — rename / edit columns. Owner only. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const access = await getWorksheetAccess(params.id, ctx.user.id);
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (access.role !== 'owner') {
      return NextResponse.json({ error: 'Only the sheet owner can change its name or columns.' }, { status: 403 });
    }
    const body = patchSchema.parse(await req.json());
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.columns !== undefined) {
      if (body.columns.length === 0) {
        return NextResponse.json({ error: 'A sheet needs at least one column.' }, { status: 400 });
      }
      updates.columns = body.columns;
    }
    await db.update(worksheets).set(updates).where(eq(worksheets.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

/** DELETE — soft-delete a sheet. Owner only. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const access = await getWorksheetAccess(params.id, ctx.user.id);
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (access.role !== 'owner') {
      return NextResponse.json({ error: 'Only the sheet owner can delete it.' }, { status: 403 });
    }
    await db.update(worksheets).set({ isDeleted: true, updatedAt: new Date() })
      .where(eq(worksheets.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

const addRowSchema = z.object({
  cells: z.record(z.string(), z.string().max(4000)).optional(),
});

/** POST — add a row. Owner or edit access. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const access = await getWorksheetAccess(params.id, ctx.user.id);
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (access.role === 'view') {
      return NextResponse.json({ error: 'You have view-only access to this sheet.' }, { status: 403 });
    }
    const body = addRowSchema.parse(await req.json().catch(() => ({})));
    const [row] = await db.insert(worksheetRows).values({
      worksheetId: params.id,
      cells: body.cells ?? {},
      createdBy: ctx.user.id,
    }).returning();
    await db.update(worksheets).set({ updatedAt: new Date() }).where(eq(worksheets.id, params.id));
    return NextResponse.json({ ok: true, data: { id: row.id, cells: row.cells } });
  } catch (e) { return apiError(e); }
}
