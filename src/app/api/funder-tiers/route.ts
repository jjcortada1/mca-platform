import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { funderTiers } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import { createTierSchema } from '@/lib/validation/schemas';

export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const list = await db.select().from(funderTiers)
      .where(eq(funderTiers.companyId, ctx.companyId))
      .orderBy(asc(funderTiers.sortOrder), asc(funderTiers.name));
    return NextResponse.json({ tiers: list, data: list });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    if (!hasPermission(ctx.user, 'funders.edit')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = createTierSchema.parse(await req.json());
    const [t] = await db.insert(funderTiers).values({
      companyId: ctx.companyId, name: body.name, sortOrder: body.sortOrder,
    }).returning();
    return NextResponse.json({ tier: t });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
