import { db } from '@/lib/db/client';
import { deals } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { visibleRepIds } from '@/lib/auth/team-scope';
import type { requireTenantContext } from '@/lib/auth/context';

/**
 * Shared per-deal access rule (same logic as deals/[id]/route.ts):
 * admins pass; lead sources are always blocked; reps must be the deal's
 * assignedRepId; team leaders pass for deals assigned to reps in their
 * scope. Returns 404 (not 403) for out-of-scope deals so their existence
 * isn't revealed.
 *
 * Used by every deal-scoped sub-resource (offers, etc.) so a rep who
 * learns another rep's deal id — e.g. from the syndication board, which
 * exposes dealId to the whole company — still can't read or write that
 * deal's data.
 */
export async function ensureDealAccess(
  ctx: Awaited<ReturnType<typeof requireTenantContext>>,
  dealId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [d] = await db
    .select({ id: deals.id, assignedRepId: deals.assignedRepId })
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.companyId, ctx.companyId), eq(deals.isDeleted, false)))
    .limit(1);
  if (!d) return { ok: false, status: 404, error: 'Not found' };
  const isAdmin = ctx.user.role === 'master_admin' || ctx.user.role === 'company_admin';
  if (isAdmin) return { ok: true };
  if (ctx.user.role === 'lead_source') return { ok: false, status: 403, error: 'Forbidden' };
  if (d.assignedRepId === ctx.user.id) return { ok: true };
  if (d.assignedRepId) {
    const scope = await visibleRepIds(ctx.user.id);
    if (scope.includes(d.assignedRepId)) return { ok: true };
  }
  return { ok: false, status: 404, error: 'Not found' };
}
