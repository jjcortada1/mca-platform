import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db/client';
import { users, passwordResets } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { forgotPasswordSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = forgotPasswordSchema.parse(await req.json());

    const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    // Always succeed silently to avoid leaking which emails exist
    if (!user || !user.isActive) return NextResponse.json({ ok: true });

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.insert(passwordResets).values({ userId: user.id, tokenHash, expiresAt });

    const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    // Send via system SMTP if configured
    if (process.env.SYSTEM_SMTP_HOST && process.env.SYSTEM_SMTP_USER) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SYSTEM_SMTP_HOST,
          port: parseInt(process.env.SYSTEM_SMTP_PORT ?? '587', 10),
          secure: process.env.SYSTEM_SMTP_PORT === '465',
          auth: { user: process.env.SYSTEM_SMTP_USER, pass: process.env.SYSTEM_SMTP_PASS },
        });
        await transporter.sendMail({
          from: process.env.SYSTEM_SMTP_FROM || process.env.SYSTEM_SMTP_USER,
          to: user.email,
          subject: 'Reset your MCA Platform password',
          text: `Hi ${user.name},\n\nReset your password using the link below (valid for 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
        });
        transporter.close();
      } catch (err) {
        console.error('[forgot-password] email send failed', err);
        // Still return ok — don't leak failure
      }
    } else {
      // No system SMTP — log token to console for dev
      console.log(`[DEV] Password reset for ${user.email}: ${resetUrl}`);
    }

    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
