import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/account/signature — returns the caller's current signature.
 * PUT  /api/account/signature — replaces it (empty string → clear).
 *
 * Scoped to the caller only; reps never see or edit another rep's signature.
 */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const [me] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
    return NextResponse.json({ data: { emailSignature: me?.emailSignature ?? '' } });
  } catch (e) { return apiError(e); }
}

const schema = z.object({
  // 5000 chars is plenty for a multi-line signature with a logo URL.
  emailSignature: z.string().max(5000),
});

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    const body = schema.parse(await req.json());
    const value = body.emailSignature.trim().length === 0 ? null : body.emailSignature;
    await db.update(users)
      .set({ emailSignature: value, updatedAt: new Date() })
      .where(eq(users.id, ctx.user.id));
    return NextResponse.json({ ok: true, data: { emailSignature: value ?? '' } });
  } catch (e) { return apiError(e); }
}
