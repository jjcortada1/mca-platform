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
 * GET — return the user's current always-CC email (or null).
 * Every authenticated user can call this on themselves.
 */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const [me] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
    return NextResponse.json({ data: { alwaysCcEmail: me?.alwaysCcEmail ?? null } });
  } catch (e) {
    return apiError(e);
  }
}

const schema = z.object({
  // Accept empty string ("" → clear), valid email, or null
  alwaysCcEmail: z.union([
    z.string().email().max(255).toLowerCase().trim(),
    z.literal(''),
    z.null(),
  ]),
});

/**
 * PUT — update the user's always-CC email. Saved on the user's own row so
 * each rep has their own setting. Empty/null clears it.
 */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    const body = schema.parse(await req.json());
    const value = body.alwaysCcEmail && body.alwaysCcEmail.length > 0
      ? body.alwaysCcEmail
      : null;
    await db.update(users)
      .set({ alwaysCcEmail: value, updatedAt: new Date() })
      .where(eq(users.id, ctx.user.id));
    return NextResponse.json({ ok: true, data: { alwaysCcEmail: value } });
  } catch (e) {
    return apiError(e);
  }
}
