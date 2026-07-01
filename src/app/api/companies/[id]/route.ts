import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { companies, users, funders } from '@/lib/db/schema';
import { eq, count } from 'drizzle-orm';
import { z } from 'zod';
import { requireMasterAdmin } from '@/lib/auth/context';
import { handle, ok, notFound, badRequest, noContent } from '@/lib/api/response';

const patchSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  isActive: z.boolean().optional(),
  // Feature access: list of nav hrefs this company may use. null = all.
  enabledNavItems: z.array(z.string().max(100)).max(100).nullable().optional(),
});

export const GET = handle(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  await requireMasterAdmin();
  const [c] = await db.select().from(companies).where(eq(companies.id, params.id));
  if (!c) return notFound('Company not found');
  const [u] = await db.select({ c: count() }).from(users).where(eq(users.companyId, c.id));
  const [f] = await db.select({ c: count() }).from(funders).where(eq(funders.companyId, c.id));
  return ok({
    id: c.id, name: c.name, slug: c.slug, isActive: c.isActive, emailMode: c.emailMode,
    createdAt: c.createdAt, userCount: u?.c ?? 0, funderCount: f?.c ?? 0,
    enabledNavItems: (c.enabledNavItems as string[] | null) ?? null,
  });
});

export const PATCH = handle(async (req: NextRequest, { params }: { params: { id: string } }) => {
  await requireMasterAdmin();
  const body = patchSchema.parse(await req.json());
  const [updated] = await db
    .update(companies)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(companies.id, params.id))
    .returning();
  if (!updated) return notFound('Company not found');
  return ok({ id: updated.id, name: updated.name, isActive: updated.isActive });
});

/**
 * DELETE — permanently remove a company and ALL its data. Every tenant
 * table references companies.id with ON DELETE CASCADE, so a single delete
 * cleans up users, funders, deals, submissions, commissions, etc.
 *
 * Guardrails:
 *   - Only the platform operator (requireMasterAdmin) can do this.
 *   - The platform-owner company can NEVER be deleted (it's the operator's
 *     own account and the master surface itself).
 *   - Requires the exact company name echoed back (?confirm=<name>) so a
 *     stray click can't wipe a tenant.
 */
export const DELETE = handle(async (req: NextRequest, { params }: { params: { id: string } }) => {
  await requireMasterAdmin();
  const [c] = await db.select().from(companies).where(eq(companies.id, params.id)).limit(1);
  if (!c) return notFound('Company not found');
  if (c.isPlatformOwner) {
    return badRequest('The platform-owner company cannot be deleted.');
  }
  const confirm = new URL(req.url).searchParams.get('confirm');
  if (confirm !== c.name) {
    return badRequest('Confirmation text does not match the company name.');
  }
  await db.delete(companies).where(eq(companies.id, c.id));
  return noContent();
});
