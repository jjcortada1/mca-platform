import { redirect } from 'next/navigation';
import { pageRequireTenant } from '@/lib/auth/context';

/**
 * SERVER-SIDE GUARD for /settings.
 *
 * Settings contains backend information — other users, lead sources,
 * commission rules, sheet sync configs, etc. ONLY admins (company_admin or
 * master_admin) may see this route. Anyone else is redirected to their own
 * personal settings page.
 *
 * This guard runs before the page renders, so non-admins NEVER load a byte
 * of the settings UI — not even the client bundle.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { user } = await pageRequireTenant();
  const isAdmin = user.role === 'company_admin' || user.role === 'master_admin';
  if (!isAdmin) {
    // Non-admins go to their personal "My Account" page instead.
    redirect('/account');
  }
  return <>{children}</>;
}
