import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { infoEntries, users } from '@/lib/db/schema';
import { eq, desc, inArray } from 'drizzle-orm';
import { requirePermission, requireTenantContext, hasPermission } from '@/lib/auth/context';
import { infoEntrySchema } from '@/lib/validation/schemas';

export async function GET() {
  try {
    const ctx = await requirePermission('info.view');
    const entries = await db.select().from(infoEntries)
      .where(eq(infoEntries.companyId, ctx.companyId))
      .orderBy(desc(infoEntries.updatedAt));

    const creatorIds = Array.from(new Set(entries.map((e) => e.createdBy).filter(Boolean) as string[]));
    const creators = creatorIds.length
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, creatorIds))
      : [];
    const creatorMap = new Map(creators.map((c) => [c.id, c.name]));

    return NextResponse.json({
      entries: entries.map((e) => ({
        id: e.id, title: e.title, body: e.body, category: e.category,
        createdBy: e.createdBy, createdByName: e.createdBy ? creatorMap.get(e.createdBy) : null,
        createdAt: e.createdAt, updatedAt: e.updatedAt,
      })),
      data: entries.map((e) => ({
        id: e.id, title: e.title, body: e.body, category: e.category,
        createdBy: e.createdBy, createdByName: e.createdBy ? creatorMap.get(e.createdBy) : null,
        createdAt: e.createdAt, updatedAt: e.updatedAt,
      })),
    });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    if (!hasPermission(ctx.user, 'info.edit')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = infoEntrySchema.parse(await req.json());
    const [e] = await db.insert(infoEntries).values({
      companyId: ctx.companyId,
      title: body.title,
      body: body.body,
      category: body.category ?? null,
      createdBy: ctx.user.id,
    }).returning();
    return NextResponse.json({ entry: e });
  } catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 400 }); }
}
