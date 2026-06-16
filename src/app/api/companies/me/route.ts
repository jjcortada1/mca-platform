import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/companies/me
 *
 * Returns the current user's company record fields that are safe to
 * surface to ANY authenticated user (rep + admin alike). We intentionally
 * exclude SMTP secrets, encrypted blobs, and anything tied to user-level
 * permissions.
 *
 * Used by:
 *   - Branding header / product name lookups
 *   - The global FundingCelebration component (needs the message + flags)
 */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const [row] = await db
      .select({
        id: companies.id,
        name: companies.name,
        productName: companies.productName,
        displayName: companies.displayName,
        logoUrl: companies.logoUrl,
        primaryColor: companies.primaryColor,
        // Celebration prefs — readable by all tenant users so the funded
        // animation looks the same regardless of role. Editable only via
        // PATCH /api/companies/[id] (admin-only).
        celebrationEnabled: companies.celebrationEnabled,
        confettiEnabled: companies.confettiEnabled,
        celebrationSoundEnabled: companies.celebrationSoundEnabled,
        celebrationMessage: companies.celebrationMessage,
      })
      .from(companies)
      .where(eq(companies.id, ctx.companyId))
      .limit(1);

    if (!row) return NextResponse.json({ company: null }, { status: 404 });
    return NextResponse.json({ company: row });
  } catch (e) { return apiError(e); }
}
