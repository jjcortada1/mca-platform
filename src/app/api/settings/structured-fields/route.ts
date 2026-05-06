import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { structuredEmailFields } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { requireTenantContext, requireCompanyAdmin } from '@/lib/auth/context';
import { z } from 'zod';

export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const fields = await db.select().from(structuredEmailFields)
      .where(eq(structuredEmailFields.companyId, ctx.companyId))
      .orderBy(asc(structuredEmailFields.sortOrder));
    return NextResponse.json({ data: fields });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}

const putSchema = z.object({
  fields: z.array(z.object({
    fieldLabel: z.string().min(1).max(100),
    fieldKey: z.string().min(1).max(100),
    sortOrder: z.number().int(),
  })).max(50),
});

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireCompanyAdmin();
    const body = putSchema.parse(await req.json());

    await db.delete(structuredEmailFields).where(eq(structuredEmailFields.companyId, ctx.companyId));
    if (body.fields.length) {
      await db.insert(structuredEmailFields).values(body.fields.map((f, i) => ({
        companyId: ctx.companyId,
        fieldLabel: f.fieldLabel,
        fieldKey: f.fieldKey,
        sortOrder: i,
      })));
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
