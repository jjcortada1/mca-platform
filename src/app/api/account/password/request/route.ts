import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db/client';
import { users, verificationCodes } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { sendSystemEmail, generateNumericCode, verificationCodeEmail } from '@/lib/email/system';
import { z } from 'zod';

export const runtime = 'nodejs';

const schema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(200, 'New password is too long'),
});

const PURPOSE = 'password_change';

/**
 * POST /api/account/password/request
 *
 * Step 1 of the 2-step password change:
 *  - Verifies the user's CURRENT password.
 *  - Hashes the NEW password and stashes it (never plaintext).
 *  - Emails a 6-digit code to the user's account email.
 *  - Does NOT change the password yet — that happens at /confirm.
 */
export async function POST(req: NextRequest) {
  try {
    const sessionUser = await requireUser();

    // Throttle: max 5 code requests per user per 10 min
    const rl = rateLimit(`pwchange-req:${sessionUser.id}`, { max: 5, windowMs: 10 * 60_000 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many requests. Try again in ${rl.retryAfterSec}s.` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }

    const body = schema.parse(await req.json());

    const [user] = await db.select().from(users).where(eq(users.id, sessionUser.id)).limit(1);
    if (!user) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    // Verify current password
    const ok = await bcrypt.compare(body.currentPassword, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
    }

    // Don't allow "new == current"
    const same = await bcrypt.compare(body.newPassword, user.passwordHash);
    if (same) {
      return NextResponse.json(
        { error: 'New password must be different from your current password.' },
        { status: 400 }
      );
    }

    // Clear any prior unused codes for this purpose
    await db.delete(verificationCodes).where(
      and(eq(verificationCodes.userId, user.id), eq(verificationCodes.purpose, PURPOSE))
    );

    // Generate + store code (hashed) and the hashed NEW password as payload
    const code = generateNumericCode(6);
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const newPasswordHash = await bcrypt.hash(body.newPassword, 12);
    const expiresAt = new Date(Date.now() + 10 * 60_000); // 10 minutes

    await db.insert(verificationCodes).values({
      userId: user.id,
      purpose: PURPOSE,
      codeHash,
      payload: newPasswordHash,
      expiresAt,
    });

    // Email the code
    const { subject, text } = verificationCodeEmail(user.name, code, 'change your password');
    const result = await sendSystemEmail({ to: user.email, subject, text });

    // Mask the email for display: j***@domain.com
    const masked = maskEmail(user.email);

    return NextResponse.json({
      ok: true,
      sentTo: masked,
      // When system SMTP isn't configured (dev), tell the client so it can show
      // a helpful note. The code is in the server console in that case.
      emailConfigured: !result.dev,
    });
  } catch (e) {
    return apiError(e);
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(1, local.length - 1))}@${domain}`;
}
