import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { commissionRules } from '@/lib/db/schema';
import { asc, eq } from 'drizzle-orm';
import { requireCompanyAdmin, requireTenantContext } from '@/lib/auth/context';
import { z } from 'zod';
import { apiError } from '@/lib/api/errors';

export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const rows = await db
      .select()
      .from(commissionRules)
      .where(eq(commissionRules.companyId, ctx.companyId))
      .orderBy(asc(commissionRules.sortOrder));
    // Postgres numeric columns come back as strings — cast to numbers for the UI
    const data = rows.map((r) => ({
      ...r,
      threshold: Number(r.threshold),
      commissionPct: Number(r.commissionPct),
    }));
    return NextResponse.json({ data });
  } catch (e) {
    return apiError(e);
  }
}

const putSchema = z.object({
  rules: z.array(z.object({
    threshold: z.string().or(z.number()),
    commissionPct: z.string().or(z.number()),
    sortOrder: z.number().int(),
  })).max(20),
});

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireCompanyAdmin();
    const body = putSchema.parse(await req.json());
    await db.delete(commissionRules).where(eq(commissionRules.companyId, ctx.companyId));
    if (body.rules.length > 0) {
      await db.insert(commissionRules).values(
        body.rules.map((r) => ({
          companyId: ctx.companyId,
          threshold: String(r.threshold),
          commissionPct: String(r.commissionPct),
          sortOrder: r.sortOrder,
        }))
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
