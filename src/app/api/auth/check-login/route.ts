import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { users, permissions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { rateLimit } from '@/lib/api/rate-limit';

/**
 * Validates credentials and checks if 2FA is required.
 * Returns user data if credentials are valid, indicating whether 2FA is needed.
 *
 * Request body:
 *   { email: string, password: string }
 *
 * Response:
 *   { success: true, userId: string, twoFactorRequired: boolean, ... }
 *   { success: false, error: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password required' },
        { status: 400 }
      );
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    // Rate limit login attempts
    const rl = rateLimit(`login:${normalizedEmail}`, { max: 10, windowMs: 5 * 60_000 });
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many attempts. Please wait a few minutes and try again.' },
        { status: 429 }
      );
    }

    const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    if (!user || !user.isActive) {
      return NextResponse.json(
        { success: false, error: 'Email or password is incorrect.' },
        { status: 401 }
      );
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json(
        { success: false, error: 'Email or password is incorrect.' },
        { status: 401 }
      );
    }

    // Load permissions
    const perms = await db
      .select({ key: permissions.permissionKey })
      .from(permissions)
      .where(eq(permissions.userId, user.id));

    return NextResponse.json({
      success: true,
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      companyId: user.companyId,
      permissions: perms.map((p) => p.key),
      twoFactorEnabled: user.twoFactorEnabled,
    });
  } catch (err) {
    console.error('[check-login]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to verify credentials' },
      { status: 500 }
    );
  }
}
