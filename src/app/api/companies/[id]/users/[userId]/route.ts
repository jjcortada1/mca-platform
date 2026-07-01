import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db/client';
import { companies, users, permissions } from '@/lib/db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { z } from 'zod';
import { requireMasterAdmin } from '@/lib/auth/context';
import { handle, ok, badRequest, notFound, noContent } from '@/lib/api/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  role: z.enum(['company_admin', 'rep', 'lead_source']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
  permissions: z.array(z.string()).optional(),
});

/**
 * PATCH — update a company's user (master level): rename, change role,
 * reset password (override the one they were given), toggle active, or
 * replace their permission set. Changing role to company_admin is how you
 * "make this person the admin"; demote the old admin separately.
 */
export const PATCH = handle(async (req: NextRequest, { params }: { params: { id: string; userId: string } }) => {
  await requireMasterAdmin();
  const [company] = await db.select().from(companies).where(eq(companies.id, params.id)).limit(1);
  if (!company) return notFound('Company not found');

  const [target] = await db.select().from(users)
    .where(and(eq(users.id, params.userId), eq(users.companyId, company.id))).limit(1);
  if (!target) return notFound('User not found in this company');

  const body = patchSchema.parse(await req.json());

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) set.name = body.name;
  if (body.role !== undefined) set.role = body.role;
  if (body.isActive !== undefined) set.isActive = body.isActive;
  if (body.password) set.passwordHash = await bcrypt.hash(body.password, 12);

  // Guard: never leave a company with ZERO admins. If demoting the last
  // company_admin, refuse.
  if (body.role && body.role !== 'company_admin' && target.role === 'company_admin') {
    const others = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.companyId, company.id), eq(users.role, 'company_admin'), ne(users.id, target.id)));
    if (others.length === 0) {
      return badRequest('This is the company\'s only admin. Promote another user to admin first.');
    }
  }

  await db.update(users).set(set).where(eq(users.id, target.id));

  // Replace permission set when provided. company_admin implicitly has all,
  // so we clear explicit rows for them.
  if (body.permissions !== undefined) {
    await db.delete(permissions).where(eq(permissions.userId, target.id));
    const effectiveRole = body.role ?? target.role;
    if (effectiveRole !== 'company_admin' && body.permissions.length) {
      await db.insert(permissions).values(body.permissions.map((k) => ({ userId: target.id, permissionKey: k })));
    }
  } else if (body.role === 'company_admin') {
    // Promoted to admin → clear explicit rows (they now have everything).
    await db.delete(permissions).where(eq(permissions.userId, target.id));
  }

  return ok({ id: target.id });
});

/** DELETE — remove a user from the company. Blocks deleting the last admin. */
export const DELETE = handle(async (_req: NextRequest, { params }: { params: { id: string; userId: string } }) => {
  await requireMasterAdmin();
  const [company] = await db.select().from(companies).where(eq(companies.id, params.id)).limit(1);
  if (!company) return notFound('Company not found');

  const [target] = await db.select().from(users)
    .where(and(eq(users.id, params.userId), eq(users.companyId, company.id))).limit(1);
  if (!target) return notFound('User not found in this company');

  if (target.role === 'company_admin') {
    const others = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.companyId, company.id), eq(users.role, 'company_admin'), ne(users.id, target.id)));
    if (others.length === 0) {
      return badRequest('Can\'t delete the company\'s only admin. Promote another user first.');
    }
  }

  await db.delete(users).where(eq(users.id, target.id));
  return noContent();
});
