import { NextResponse } from 'next/server';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { listMailboxes } from '@/lib/email/mailbox';
import { googleConfigured, hasReadScope } from '@/lib/email/google';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/email/accounts — the caller's connected mailboxes. */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const rows = await listMailboxes(ctx.user.id);
    return NextResponse.json({
      configured: googleConfigured(),
      data: rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        emailAddress: r.emailAddress,
        displayName: r.displayName,
        status: r.status,
        lastError: r.lastError,
        canRead: hasReadScope(r.scope),
        sendEnabled: r.sendEnabled,
        connectedAt: r.createdAt,
      })),
    });
  } catch (e) { return apiError(e); }
}
