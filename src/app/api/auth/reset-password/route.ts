import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db/client';
import { users, passwordResets } from '@/lib/db/schema';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { resetPasswordSchema } from '@/lib/validation/schemas';
import { apiError } from '@/lib/api/errors';

export async function POST(req: NextRequest) {
  try {
    const body = resetPasswordSchema.parse(await req.json());
    const tokenHash = crypto.createHash('sha256').update(body.token).digest('hex');

    const [reset] = await db
      .select()
      .from(passwordResets)
      .where(
        and(
          eq(passwordResets.tokenHash, tokenHash),
          gt(passwordResets.expiresAt, new Date()),
          isNull(passwordResets.usedAt),
        )
      )
      .limit(1);

    if (!reset) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 });

    const passwordHash = await bcrypt.hash(body.password, 12);
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, reset.userId));
    await db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, reset.id));

    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
