import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db/client';
import { companies, users, permissions } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { requireMasterAdmin } from '@/lib/auth/context';
import { handle, ok, created, badRequest, notFound } from '@/lib/api/response';
import { ALL_REP_PERMISSIONS } from '@/lib/db/schema';
import { titleCaseName } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Master-level user management for ANY company. Lets the platform operator
 * add reps/admins to a tenant, set their role + permissions, and see who
 * the admins are — without having to log in as that company.
 *
 * All routes require the platform operator (requireMasterAdmin, which also
 * admits the owner-company admins).
 */

async function assertCompany(id: string) {
  const [c] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  return c ?? null;
}

/** GET — list a company's users with roles + permissions. */
export const GET = handle(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  await requireMasterAdmin();
  const company = await assertCompany(params.id);
  if (!company) return notFound('Company not found');

  const list = await db.select().from(users).where(eq(users.companyId, company.id));
  const ids = list.map((u) => u.id);
  const permRows = ids.length
    ? await db.select().from(permissions).where(inArray(permissions.userId, ids))
    : [];
  const permsByUser = new Map<string, string[]>();
  for (const p of permRows) {
    const arr = permsByUser.get(p.userId) ?? [];
    arr.push(p.permissionKey);
    permsByUser.set(p.userId, arr);
  }

  return ok({
    company: { id: company.id, name: company.name },
    data: list.map((u) => ({
      id: u.id, email: u.email, name: u.name, role: u.role,
      isActive: u.isActive, lastLoginAt: u.lastLoginAt,
      permissions: permsByUser.get(u.id) ?? [],
    })),
  });
});

const createSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  name: z.string().min(2).max(200),
  role: z.enum(['company_admin', 'rep', 'lead_source']),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  permissions: z.array(z.string()).default([]),
});

/** POST — add a user to this company. */
export const POST = handle(async (req: NextRequest, { params }: { params: { id: string } }) => {
  await requireMasterAdmin();
  const company = await assertCompany(params.id);
  if (!company) return notFound('Company not found');

  const body = createSchema.parse(await req.json());

  // Email is globally unique (a person who is BOTH a company user AND a
  // lead source needs two separate emails — each logs into its own portal
  // by role, with no collision).
  const [exists] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
  if (exists) return badRequest('That email is already in use. Use a different email for this login.');

  const hash = await bcrypt.hash(body.password, 12);
  const [u] = await db.insert(users).values({
    companyId: company.id,
    email: body.email,
    name: titleCaseName(body.name),
    passwordHash: hash,
    role: body.role,
  }).returning();

  const permsToInsert = body.permissions.length
    ? body.permissions
    : body.role === 'rep' ? ALL_REP_PERMISSIONS : [];
  if (permsToInsert.length && body.role !== 'company_admin') {
    // company_admin implicitly has every permission — no rows needed.
    await db.insert(permissions).values(permsToInsert.map((k) => ({ userId: u.id, permissionKey: k })));
  }

  return created({ id: u.id, email: u.email, role: u.role });
});
