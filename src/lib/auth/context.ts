import { getServerSession } from 'next-auth';
import { authOptions } from './options';
import { redirect } from 'next/navigation';

export type Role = 'master_admin' | 'company_admin' | 'rep' | 'lead_source';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  companyId: string | null;
  permissions: string[];
}

export class AuthError extends Error {
  constructor(message: string, public status = 401) {
    super(message);
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
  }
}

/**
 * Returns the current session user, or null if not signed in.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return session.user as SessionUser;
}

/**
 * Requires an authenticated session. Throws AuthError if not signed in.
 * Use in API routes / server actions.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new AuthError('Not authenticated');
  return user;
}

/**
 * THE TENANT GATE.
 *
 * Returns the current user along with a non-null companyId.
 * Master admins do NOT have a companyId — calling this from a master_admin session
 * will throw, which is exactly what we want for any deal/funder/submission code path.
 *
 * Every API route that touches tenant data MUST start with:
 *   const ctx = await requireTenantContext();
 * and use ctx.companyId in every where-clause.
 */
export async function requireTenantContext(): Promise<{
  user: SessionUser;
  companyId: string;
}> {
  const user = await requireUser();
  if (!user.companyId) {
    throw new ForbiddenError('Master admins cannot access tenant data');
  }
  return { user, companyId: user.companyId };
}

/**
 * Requires master admin OR company admin role.
 *
 * Originally master-admin-only — relaxed to also allow company_admin since this
 * deployment is single-tenant (Cortada). Company admins can create new companies
 * and manage master default funders. The role distinction stays in the database
 * for future multi-tenant expansion, but permissions are unified at the call site.
 */
export async function requireMasterAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'master_admin' && user.role !== 'company_admin') {
    throw new ForbiddenError('Admin only');
  }
  return user;
}

/**
 * Requires company admin (or master admin acting on a specific company, NOT used for tenant data).
 */
export async function requireCompanyAdmin(): Promise<{ user: SessionUser; companyId: string }> {
  const user = await requireUser();
  if (user.role !== 'company_admin' || !user.companyId) {
    throw new ForbiddenError('Company admin only');
  }
  return { user, companyId: user.companyId };
}

/**
 * Permission check. Company admins implicitly have all permissions.
 */
export function hasPermission(user: SessionUser, key: string): boolean {
  if (user.role === 'company_admin') return true;
  return user.permissions.includes(key);
}

export async function requirePermission(key: string): Promise<{ user: SessionUser; companyId: string }> {
  const ctx = await requireTenantContext();
  if (!hasPermission(ctx.user, key)) {
    throw new ForbiddenError(`Missing permission: ${key}`);
  }
  return ctx;
}

/**
 * Page-level helpers — for server components. Redirect on auth failure.
 */
export async function pageRequireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

export async function pageRequireTenant(): Promise<{ user: SessionUser; companyId: string }> {
  const user = await pageRequireUser();
  if (!user.companyId) redirect('/master');
  return { user, companyId: user.companyId };
}

export async function pageRequireMaster(): Promise<SessionUser> {
  const user = await pageRequireUser();
  // Both master_admin and company_admin can access master pages (single-tenant simplification)
  if (user.role !== 'master_admin' && user.role !== 'company_admin') redirect('/dashboard');
  return user;
}
