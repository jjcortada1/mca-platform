import { pageRequireTenant } from '@/lib/auth/context';
import { AppShell } from '@/components/sidebar';
import { getTenantBranding } from '@/lib/branding';
import { FundingCelebration } from '@/components/funding-celebration';
import { redirect } from 'next/navigation';

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
