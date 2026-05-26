import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db/client';
import { users, verificationCodes } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { sendSystemEmail } from '@/lib/email/system';
import { z } from 'zod';

export const runtime = 'nodejs';

const schema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

const PURPOSE = 'password_change';
const MAX_ATTEMPTS = 5;

/**
 * POST /api/account/password/confirm
 *
 * Step 2 of the 2-step password change:
 *  - Looks up the pending code for this user.
 *  - Validates: not expired, not used, under attempt cap, matches.
 *  - On success: writes the stashed new password hash, marks code used,
 *    and sends a "your password was changed" confirmation email.
 */
export async function POST(req: NextRequest) {
  try {
    const sessionUser = await requireUser();

    // Throttle confirm attempts (separate from request throttle)
    const rl = rateLimit(`pwchange-confirm:${sessionUser.id}`, { max: 10, windowMs: 10 * 60_000 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many attempts. Try again in ${rl.retryAfterSec}s.` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }

    const body = schema.parse(await req.json());

    // Most recent pending code for this purpose
    const [vc] = await db
      .select()
      .from(verificationCodes)
      .where(and(eq(verificationCodes.userId, sessionUser.id), eq(verificationCodes.purpose, PURPOSE)))
      .orderBy(desc(verificationCodes.createdAt))
      .limit(1);

    if (!vc || vc.usedAt) {
      return NextResponse.json({ error: 'No active verification request. Start again.' }, { status: 400 });
    }
    if (vc.expiresAt < new Date()) {
      await db.delete(verificationCodes).where(eq(verificationCodes.id, vc.id));
      return NextResponse.json({ error: 'Code expired. Start again.' }, { status: 400 });
    }
    if (vc.attempts >= MAX_ATTEMPTS) {
      await db.delete(verificationCodes).where(eq(verificationCodes.id, vc.id));
      return NextResponse.json({ error: 'Too many incorrect attempts. Start again.' }, { status: 400 });
    }

    const codeHash = crypto.createHash('sha256').update(body.code).digest('hex');
    if (codeHash !== vc.codeHash) {
      await db.update(verificationCodes)
        .set({ attempts: vc.attempts + 1 })
        .where(eq(verificationCodes.id, vc.id));
      const left = MAX_ATTEMPTS - (vc.attempts + 1);
      return NextResponse.json(
        { error: `Incorrect code.${left > 0 ? ` ${left} attempt${left === 1 ? '' : 's'} left.` : ''}` },
        { status: 400 }
      );
    }

    if (!vc.payload) {
      await db.delete(verificationCodes).where(eq(verificationCodes.id, vc.id));
      return NextResponse.json({ error: 'Verification payload missing. Start again.' }, { status: 400 });
    }

    // Commit: payload IS the already-hashed new password
    await db.update(users)
      .set({ passwordHash: vc.payload, updatedAt: new Date() })
      .where(eq(users.id, sessionUser.id));

    await db.update(verificationCodes).set({ usedAt: new Date() }).where(eq(verificationCodes.id, vc.id));
    // Clean up any other codes for this purpose
    await db.delete(verificationCodes).where(
      and(eq(verificationCodes.userId, sessionUser.id), eq(verificationCodes.purpose, PURPOSE))
    );

    // Notify (best-effort) — a "your password was changed" email is standard for real apps
    const [user] = await db.select().from(users).where(eq(users.id, sessionUser.id)).limit(1);
    if (user) {
      await sendSystemEmail({
        to: user.email,
        subject: 'Your password was changed',
        text:
          `Hi ${user.name},\n\n` +
          `Your password was just changed.\n\n` +
          `If this was you, no action is needed. If this WASN'T you, reset your password immediately using "Forgot password" on the login page and contact your administrator.\n`,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
