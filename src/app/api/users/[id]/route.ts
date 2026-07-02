import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db/client';
import { users, permissions, leadSources } from '@/lib/db/schema';
import { and, eq, ne, count } from 'drizzle-orm';
import { z } from 'zod';
import { requireCompanyAdmin } from '@/lib/auth/context';
import { updateUserSchema } from '@/lib/validation/schemas';
import { apiError } from '@/lib/api/errors';
import { titleCaseName } from '@/lib/utils';

/**
 * Safety: company_admin must NOT be able to modify or delete a master_admin.
 * Returns true if the caller is allowed to act on the target user.
 *
 * Rules:
 *   - Master admin: can act on anyone (including other master admins, except
 *     they cannot delete themselves).
 *   - Company admin: can act on company_admin / rep / lead_source within
 *     their own company. CANNOT touch a master_admin.
 */
function canActOn(callerRole: string, targetRole: string | null): boolean {
  if (callerRole === 'master_admin') return true;
  if (callerRole === 'company_admin') {
    return targetRole !== 'master_admin';
  }
  return false;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireCompanyAdmin();
    const body = updateUserSchema.parse(await req.json());

    const [target] = await db.select().from(users)
      .where(and(eq(users.id, params.id), eq(users.companyId, ctx.companyId))).limit(1);
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Privilege escalation guard: company_admin can't touch a master_admin.
    if (!canActOn(ctx.user.role, target.role)) {
      return NextResponse.json({ error: 'You cannot modify this user.' }, { status: 403 });
    }

    // Lockout guard: deactivating the LAST active admin in a company would
    // lock everyone out of settings. Refuse.
    if (body.isActive === false && target.isActive &&
        (target.role === 'company_admin' || target.role === 'master_admin')) {
      const [{ c }] = await db.select({ c: count() }).from(users).where(and(
        eq(users.companyId, ctx.companyId),
        eq(users.isActive, true),
        ne(users.id, target.id),
      ));
      const otherActiveAdmins = await db.select().from(users).where(and(
        eq(users.companyId, ctx.companyId),
        eq(users.isActive, true),
        ne(users.id, target.id),
      ));
      const anyOtherAdmins = otherActiveAdmins.some((u) => u.role === 'company_admin' || u.role === 'master_admin');
      if (!anyOtherAdmins) {
        return NextResponse.json({ error: 'Cannot deactivate the last active admin. Promote someone else first.' }, { status: 400 });
      }
      // c referenced to avoid lint warning
      void c;
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = titleCaseName(body.name);
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (Object.keys(updates).length) {
      updates.updatedAt = new Date();
      await db.update(users).set(updates)
        .where(and(eq(users.id, params.id), eq(users.companyId, ctx.companyId)));
    }

    if (body.permissions !== undefined) {
      await db.delete(permissions).where(eq(permissions.userId, params.id));
      if (body.permissions.length) {
        await db.insert(permissions).values(body.permissions.map((k) => ({ userId: params.id, permissionKey: k })));
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

const fullUpdateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  email: z.string().email().toLowerCase().trim().optional(),
  // master_admin can demote/promote anyone including assigning master_admin.
  // company_admin can NOT assign master_admin (checked at runtime below).
  role: z.enum(['master_admin', 'company_admin', 'rep', 'lead_source']).optional(),
  isActive: z.boolean().optional(),
  permissions: z.array(z.string()).optional(),
  // Optional — only changes the password when a non-empty value is sent
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  leadSourceId: z.string().uuid().optional().nullable(),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  // Full user update (name/email/role/isActive/permissions/password).
  // Password is only changed when a non-empty value is provided.
  try {
    const ctx = await requireCompanyAdmin();
    const body = fullUpdateSchema.parse(await req.json());

    const [target] = await db.select().from(users)
      .where(and(eq(users.id, params.id), eq(users.companyId, ctx.companyId))).limit(1);
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Privilege escalation guard
    if (!canActOn(ctx.user.role, target.role)) {
      return NextResponse.json({ error: 'You cannot modify this user.' }, { status: 403 });
    }
    // company_admin cannot promote anyone TO master_admin either.
    if (body.role === 'master_admin' && ctx.user.role !== 'master_admin') {
      return NextResponse.json({ error: 'Only a master admin can assign the master admin role.' }, { status: 403 });
    }

    // Self-lockout guards:
    //   1. Demoting yourself out of admin → would lock you out
    //   2. Deactivating yourself → ditto
    if (params.id === ctx.user.id) {
      if (body.role !== undefined && body.role !== 'company_admin' && body.role !== 'master_admin') {
        return NextResponse.json({ error: 'You cannot demote your own admin role.' }, { status: 400 });
      }
      if (body.isActive === false) {
        return NextResponse.json({ error: 'You cannot deactivate your own account.' }, { status: 400 });
      }
    }

    // Last-admin guard: don't let an action leave the company without any
    // active admin. This covers role demotion AND deactivation in one shot.
    const isLosingAdmin =
      (body.role !== undefined && body.role !== 'company_admin' && body.role !== 'master_admin' &&
       (target.role === 'company_admin' || target.role === 'master_admin')) ||
      (body.isActive === false && target.isActive &&
       (target.role === 'company_admin' || target.role === 'master_admin'));
    if (isLosingAdmin) {
      const others = await db.select().from(users).where(and(
        eq(users.companyId, ctx.companyId),
        eq(users.isActive, true),
        ne(users.id, target.id),
      ));
      const anyOtherAdmins = others.some((u) => u.role === 'company_admin' || u.role === 'master_admin');
      if (!anyOtherAdmins) {
        return NextResponse.json({
          error: 'Cannot leave the company without an active admin. Promote someone else first.',
        }, { status: 400 });
      }
    }

    // If email is changing, ensure it's not taken by someone else
    if (body.email && body.email !== target.email) {
      const [clash] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
      if (clash) return NextResponse.json({ error: 'Email already in use' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = titleCaseName(body.name);
    if (body.email !== undefined) updates.email = body.email;
    if (body.role !== undefined) updates.role = body.role;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.password) updates.passwordHash = await bcrypt.hash(body.password, 12);

    if (Object.keys(updates).length) {
      updates.updatedAt = new Date();
      await db.update(users).set(updates)
        .where(and(eq(users.id, params.id), eq(users.companyId, ctx.companyId)));
    }

    if (body.permissions !== undefined) {
      await db.delete(permissions).where(eq(permissions.userId, params.id));
      if (body.permissions.length) {
        await db.insert(permissions).values(
          body.permissions.map((k) => ({ userId: params.id, permissionKey: k }))
        );
      }
    }

    // Lead source linking: when a user is (or becomes) a lead_source, point the
    // chosen lead source at this user and clear any other links to it.
    if (body.leadSourceId !== undefined) {
      // Unlink this user from any lead source first
      await db.update(leadSources).set({ userId: null })
        .where(and(eq(leadSources.companyId, ctx.companyId), eq(leadSources.userId, params.id)));
      if (body.leadSourceId) {
        await db.update(leadSources).set({ userId: params.id })
          .where(and(eq(leadSources.id, body.leadSourceId), eq(leadSources.companyId, ctx.companyId)));
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireCompanyAdmin();
    if (params.id === ctx.user.id) {
      return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 });
    }

    const [target] = await db.select().from(users)
      .where(and(eq(users.id, params.id), eq(users.companyId, ctx.companyId))).limit(1);
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Privilege guard: company_admin cannot delete master_admin.
    if (!canActOn(ctx.user.role, target.role)) {
      return NextResponse.json({ error: 'You cannot delete this user.' }, { status: 403 });
    }

    // Last-admin guard
    if (target.role === 'company_admin' || target.role === 'master_admin') {
      const others = await db.select().from(users).where(and(
        eq(users.companyId, ctx.companyId),
        eq(users.isActive, true),
        ne(users.id, target.id),
      ));
      const anyOtherAdmins = others.some((u) => u.role === 'company_admin' || u.role === 'master_admin');
      if (!anyOtherAdmins) {
        return NextResponse.json({ error: 'Cannot delete the last active admin.' }, { status: 400 });
      }
    }

    await db.delete(users).where(and(eq(users.id, params.id), eq(users.companyId, ctx.companyId)));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
