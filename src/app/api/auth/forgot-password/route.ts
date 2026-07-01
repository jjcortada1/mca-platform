import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db/client';
import { users, passwordResets } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { forgotPasswordSchema } from '@/lib/validation/schemas';
import { apiError } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { sendAccountEmail } from '@/lib/email/account-email';

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

    // Deliver via system email, or fall back to the user's / company's own
    // SMTP so a reset link still arrives when no dedicated email service is
    // configured (the exact case that was silently failing before).
    const res = await sendAccountEmail(user.id, {
      subject: 'Reset your password',
      text: `Hi ${user.name},\n\nReset your password using the link below (valid for 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, ignore this email and your account stays unchanged.`,
    });

    // Enumeration-safe: always return a plain ok — never reveal whether the
    // email exists or whether delivery worked. If NO transport could deliver
    // (no system service AND no SMTP anywhere), log the reset link to the
    // SERVER console as an operator backstop. That keeps it out of the HTTP
    // response (so it can't be harvested by anyone typing an email) while
    // still giving the operator a way in via their Replit logs. In practice
    // the company/user SMTP fallback delivers it, so this rarely fires.
    if (!res.delivered) {
      console.warn(
        `[forgot-password] Could not email a reset link to ${user.email}. ` +
        `No email transport is configured. One-time link (valid 1h): ${resetUrl}`
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
