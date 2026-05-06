import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { companies, users, funders } from '@/lib/db/schema';
import { eq, count } from 'drizzle-orm';
import { z } from 'zod';
import { requireMasterAdmin } from '@/lib/auth/context';
import { handle, ok, notFound } from '@/lib/api/response';

const patchSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  isActive: z.boolean().optional(),
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
