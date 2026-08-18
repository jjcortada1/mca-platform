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
/**
 * Resolve which company this request should read and write.
 *
 * Normally the user's own company. When the platform owner has DEMO MODE
 * switched on, it resolves to their demo company instead — which is how
 * the entire app fills with fake data without a single query being
 * rewritten: every route already scopes by whatever this returns.
 *
 * Deliberately a DB read rather than a session claim, so toggling demo
 * mode takes effect on the next request instead of after a re-login.
 */
export async function resolveCompanyId(user: SessionUser): Promise<string | null> {
  if (!user.companyId) return null;
  try {
    const { db } = await import('@/lib/db/client');
    const { users } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const [row] = await db
      .select({ demoMode: users.demoMode, demoCompanyId: users.demoCompanyId })
      .from(users).where(eq(users.id, user.id)).limit(1);
    if (row?.demoMode && row.demoCompanyId) return row.demoCompanyId;
  } catch {
    // If the lookup fails, fall through to the real company. Demo mode
    // failing closed (showing real data to the operator) is safe; failing
    // open would not be.
  }
  return user.companyId;
}

export async function requireTenantContext(): Promise<{
  user: SessionUser;
  companyId: string;
}> {
  const user = await requireUser();
  if (!user.companyId) {
    throw new ForbiddenError('Master admins cannot access tenant data');
  }
  const companyId = await resolveCompanyId(user);
  if (!companyId) throw new ForbiddenError('No company for this user');
  return { user, companyId };
}

/**
 * Requires the PLATFORM OPERATOR: either a true master_admin, or a
 * company_admin of the platform-owner company (the operator's own
 * brokerage — flagged via companies.is_platform_owner, backfilled to the
 * oldest company). This is who can create/manage tenant companies and
 * master default funders. Admins of CLIENT companies are rejected, so
 * onboarding other brokerages never exposes the master surface to them.
 */
export async function requireMasterAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role === 'master_admin') return user;
  if (user.role === 'company_admin' && user.companyId && (await isPlatformOwnerCompany(user.companyId))) {
    return user;
  }
  throw new ForbiddenError('Platform owner only');
}

/**
 * Is this company the platform owner? Small helper shared by API + page gates.
 *
 * Exported so owner-only FEATURE pages (not just the master surface) can
 * apply the same test. Pass the user's real `companyId` — never a
 * demo-resolved one — when the gate should be independent of demo mode.
 */
export async function isPlatformOwnerCompany(companyId: string): Promise<boolean> {
  try {
    const { db } = await import('@/lib/db/client');
    const { companies } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const [c] = await db
      .select({ isPlatformOwner: companies.isPlatformOwner })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    return !!c?.isPlatformOwner;
  } catch {
    return false;
  }
}

/**
 * Requires admin role. Both `company_admin` and `master_admin` qualify.
 * Use this on any page or API that contains backend / multi-user information
 * (other reps' data, lead sources, commission rules, sheets sync, etc.).
 */
export async function requireCompanyAdmin(): Promise<{ user: SessionUser; companyId: string }> {
  const user = await requireUser();
  const isAdmin = user.role === 'company_admin' || user.role === 'master_admin';
  if (!isAdmin || !user.companyId) {
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
  const companyId = await resolveCompanyId(user);
  if (!companyId) redirect('/master');
  return { user, companyId };
}

export async function pageRequireMaster(): Promise<SessionUser> {
  const user = await pageRequireUser();
  // Master pages (multi-company control surface) admit the platform
  // operator: master_admin, or company_admin of the platform-owner
  // company. Client-company admins manage their own tenant via /settings
  // and are redirected away. Mirrors requireMasterAdmin (API side).
  if (user.role === 'master_admin') return user;
  if (user.role === 'company_admin' && user.companyId && (await isPlatformOwnerCompany(user.companyId))) {
    return user;
  }
  redirect('/dashboard');
}
