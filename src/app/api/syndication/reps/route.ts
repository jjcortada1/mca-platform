import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { syndicationReps } from '@/lib/db/schema';
import { and, eq, asc } from 'drizzle-orm';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** GET — the saved rep ↔ company directory for the syndication board. */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    if (ctx.user.role === 'lead_source') {
      return NextResponse.json({ error: 'Not available for this account' }, { status: 403 });
    }
    const rows = await db.select().from(syndicationReps)
      .where(eq(syndicationReps.companyId, ctx.companyId))
      .orderBy(asc(syndicationReps.repName));
    return NextResponse.json({ data: rows });
  } catch (e) { return apiError(e); }
}

const upsertSchema = z.object({
  repName: z.string().min(1).max(200),
  repCompanyName: z.string().max(200).optional().nullable(),
});

/**
 * POST — save (or update) a rep in the directory. Case-insensitive upsert on
 * the name: re-saving an existing rep just refreshes their company name.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    if (ctx.user.role === 'lead_source') {
      return NextResponse.json({ error: 'Not available for this account' }, { status: 403 });
    }
    const body = upsertSchema.parse(await req.json());
    const name = body.repName.trim();
    const company = body.repCompanyName?.trim() || null;

    const existing = await db.select().from(syndicationReps)
      .where(eq(syndicationReps.companyId, ctx.companyId));
    const match = existing.find((r) => r.repName.toLowerCase() === name.toLowerCase());
    if (match) {
      if (company && company !== match.repCompanyName) {
        await db.update(syndicationReps)
          .set({ repCompanyName: company })
          .where(eq(syndicationReps.id, match.id));
      }
      return NextResponse.json({ ok: true, data: { ...match, repCompanyName: company ?? match.repCompanyName } });
    }
    const [row] = await db.insert(syndicationReps).values({
      companyId: ctx.companyId,
      repName: name,
      repCompanyName: company,
    }).returning();
    return NextResponse.json({ ok: true, data: row });
  } catch (e) { return apiError(e); }
}

/** DELETE — remove a directory entry by id (?id=...). */
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    await db.delete(syndicationReps)
      .where(and(eq(syndicationReps.id, id), eq(syndicationReps.companyId, ctx.companyId)));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
