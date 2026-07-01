import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/context';
import { db } from '@/lib/db/client';
import { users, companies } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isSystemEmailConfigured } from '@/lib/email/system';

/**
 * Toggle 2FA on/off for the current user.
 *
 * Request body:
 *   { enabled: boolean }
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('*'); // Any authenticated user can toggle their own 2FA
    const body = await req.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }

    await db
      .update(users)
      .set({ twoFactorEnabled: enabled })
      .where(eq(users.id, ctx.user.id));

    // When enabling, tell the user how the code will actually reach them.
    // If NO transport exists, be explicit that login will skip the code
    // until email is set up — 2FA never locks anyone out.
    let message = enabled ? '2FA has been enabled' : '2FA has been disabled';
    if (enabled && !isSystemEmailConfigured()) {
      const [me] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      let hasSmtp = !!me?.smtpConfig;
      if (!hasSmtp && me?.companyId) {
        const [company] = await db.select().from(companies).where(eq(companies.id, me.companyId)).limit(1);
        hasSmtp = !!company?.smtpConfig;
      }
      message = hasSmtp
        ? '2FA enabled. Codes will be emailed to you through your connected email account.'
        : '2FA enabled, but no email is connected yet — logins will skip the code until your email SMTP is set up (My Account → My email SMTP).';
    }

    return NextResponse.json({
      success: true,
      message,
    });
  } catch (err) {
    console.error('[toggle-2fa]', err);
    return NextResponse.json(
      { error: 'Failed to update 2FA settings' },
      { status: 500 }
    );
  }
}
