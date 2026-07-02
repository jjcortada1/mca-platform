import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db/client';
import { users, permissions, leadSources } from '@/lib/db/schema';
import { eq, inArray, and } from 'drizzle-orm';
import { requireTenantContext, requireCompanyAdmin } from '@/lib/auth/context';
import { createUserSchema } from '@/lib/validation/schemas';
import { ALL_REP_PERMISSIONS } from '@/lib/db/schema';
import { apiError } from '@/lib/api/errors';
import { titleCaseName } from '@/lib/utils';

/**
 * GET — list users in current company.
 * Any authenticated tenant user can list (used to populate rep dropdowns on
 * funded-board, active-deals, etc). Sensitive fields (permissions, hasSmtp)
 * are only included for admin callers.
 */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const list = await db.select().from(users).where(eq(users.companyId, ctx.companyId));
    const isAdmin = ctx.user.role === 'company_admin' || ctx.user.role === 'master_admin';

    const permsByUser = new Map<string, string[]>();
    const lsByUser = new Map<string, string>();
    if (isAdmin && list.length) {
      const ids = list.map((u) => u.id);
      const rows = await db.select().from(permissions).where(inArray(permissions.userId, ids));
      for (const p of rows) {
        const arr = permsByUser.get(p.userId) ?? [];
        arr.push(p.permissionKey);
        permsByUser.set(p.userId, arr);
      }
      const lsRows = await db.select({ id: leadSources.id, userId: leadSources.userId })
        .from(leadSources).where(eq(leadSources.companyId, ctx.companyId));
      for (const ls of lsRows) if (ls.userId) lsByUser.set(ls.userId, ls.id);
    }

    const result = list
      // Privacy: hide lead_source users from non-admin callers. Reps populate
      // their UI dropdowns from this endpoint; surfacing lead-source emails
      // would let a rep see who's referring deals (and indirectly who's
      // getting lead-source pay). Admins still see everyone for management.
      .filter((u) => isAdmin || u.role !== 'lead_source')
      .map((u) => {
      const base = {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        isActive: u.isActive,
      };
      if (!isAdmin) return base;
      return {
        ...base,
        lastLoginAt: u.lastLoginAt,
        hasSmtp: !!u.smtpConfig,
        permissions: permsByUser.get(u.id) ?? [],
        leadSourceId: lsByUser.get(u.id) ?? null,
      };
    });

    return NextResponse.json({ users: result, data: result });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * POST — create a new user. Company admin only.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireCompanyAdmin();
    const body = createUserSchema.parse(await req.json());

    // Defense in depth: even though createUserSchema doesn't allow
    // master_admin as a value, double-check at runtime. Only an existing
    // master_admin can mint another master_admin.
    if ((body.role as string) === 'master_admin' && ctx.user.role !== 'master_admin') {
      return NextResponse.json({ error: 'Only a master admin can create another master admin.' }, { status: 403 });
    }

    // Email uniqueness (global)
    const [exists] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (exists) return NextResponse.json({ error: 'Email already exists' }, { status: 400 });

    const hash = await bcrypt.hash(body.password, 12);
    const [u] = await db.insert(users).values({
      companyId: ctx.companyId,
      email: body.email,
      name: titleCaseName(body.name),
      passwordHash: hash,
      role: body.role,
    }).returning();

    // Default to all rep permissions if 'rep' and no permissions specified
    const permsToInsert = body.permissions.length
      ? body.permissions
      : body.role === 'rep' ? ALL_REP_PERMISSIONS : [];
    if (permsToInsert.length) {
      await db.insert(permissions).values(
        permsToInsert.map((k) => ({ userId: u.id, permissionKey: k }))
      );
    }

    // Link a lead_source login to its lead source so the portal scopes correctly.
    if (body.role === 'lead_source' && body.leadSourceId) {
      const [ls] = await db.select().from(leadSources)
        .where(and(eq(leadSources.id, body.leadSourceId), eq(leadSources.companyId, ctx.companyId))).limit(1);
      if (ls) {
        await db.update(leadSources).set({ userId: u.id }).where(eq(leadSources.id, ls.id));
      }
    }

    return NextResponse.json({ user: { id: u.id, email: u.email, role: u.role } });
  } catch (e) {
    return apiError(e);
  }
}
