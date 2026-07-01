import type { Metadata } from 'next';
import { pageRequireTenant, currentUser } from '@/lib/auth/context';
import { AppShell } from '@/components/sidebar';
import { getTenantBranding } from '@/lib/branding';
import { FundingCelebration } from '@/components/funding-celebration';
import { redirect } from 'next/navigation';

/**
 * Per-tenant browser-tab title. The root layout sets a generic (owner)
 * title for the pre-login pages; inside the app we override it with the
 * LOGGED-IN user's own company name, so a rep at "Acme Capital" sees
 * "Acme Capital" in their tab — never the platform owner's brand.
 * Next.js merges nested metadata, so this title wins over the root.
 */
export async function generateMetadata(): Promise<Metadata> {
  try {
    const user = await currentUser();
    if (user?.companyId) {
      const b = await getTenantBranding(user.companyId);
      return { title: b.productName, applicationName: b.productName };
    }
  } catch { /* fall through to inherited title */ }
  return {};
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, companyId } = await pageRequireTenant();

  // Lead source accounts get ONLY their restricted payout portal — never the main app.
  if (user.role === 'lead_source') {
    redirect('/lead-source-portal');
  }

  const branding = await getTenantBranding(companyId);

  return (
    <AppShell user={user} branding={branding}>
      {/* Global funding celebration overlay — listens for 'mca:funded-deal'
          custom events dispatched by any page that marks a deal funded.
          Mounted at the app root so it renders on top of every screen,
          including the settings preview button. */}
      <FundingCelebration />
      {children}
    </AppShell>
  );
}
