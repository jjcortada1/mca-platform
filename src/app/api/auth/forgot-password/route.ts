import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db/client';
import { users, passwordResets } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { forgotPasswordSchema } from '@/lib/validation/schemas';
import { apiError } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { sendSystemEmail } from '@/lib/email/system';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = forgotPasswordSchema.parse(await req.json());
    const email = body.email.toLowerCase().trim();

    // Throttle reset requests per email: 5 / 15 min
    const rl = rateLimit(`forgot:${email}`, { max: 5, windowMs: 15 * 60_000 });
    if (!rl.allowed) {
      // Still return ok to avoid leaking, but skip the work
      return NextResponse.json({ ok: true });
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    // Always succeed silently to avoid leaking which emails exist
    if (!user || !user.isActive) return NextResponse.json({ ok: true });

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.insert(passwordResets).values({ userId: user.id, tokenHash, expiresAt });

    const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    // Sent from the system account, delivered to the user's email. No per-user
    // SMTP needed — a locked-out user must be able to receive this regardless.
    await sendSystemEmail({
      to: user.email,
      subject: 'Reset your password',
      text: `Hi ${user.name},\n\nReset your password using the link below (valid for 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, ignore this email and your account stays unchanged.`,
    });

    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
