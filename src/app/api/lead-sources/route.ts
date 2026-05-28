import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { leadSources } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import type { SessionUser } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { z } from 'zod';

export const runtime = 'nodejs';

function isAdmin(u: SessionUser) {
  return u.role === 'company_admin' || u.role === 'master_admin' || hasPermission(u, 'commissions.manage');
}

export async function GET() {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    const rows = await db.select().from(leadSources)
      .where(eq(leadSources.companyId, ctx.companyId))
      .orderBy(desc(leadSources.createdAt));
    return NextResponse.json({ leadSources: rows, data: rows });
  } catch (e) { return apiError(e); }
}

const schema = z.object({
  name: z.string().min(1).max(200),
  contactEmail: z.string().email().optional().nullable().or(z.literal('')),
  contactPhone: z.string().max(50).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    const body = schema.parse(await req.json());
    const [row] = await db.insert(leadSources).values({
      companyId: ctx.companyId,
      name: body.name.trim(),
      contactEmail: body.contactEmail || null,
      contactPhone: body.contactPhone || null,
      notes: body.notes || null,
      isActive: body.isActive ?? true,
    }).returning();
    return NextResponse.json({ ok: true, leadSource: row });
  } catch (e) { return apiError(e); }
}
