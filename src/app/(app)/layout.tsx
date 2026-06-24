import { pageRequireTenant } from '@/lib/auth/context';
import { AppShell } from '@/components/sidebar';
import { getTenantBranding } from '@/lib/branding';
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
      {children}
    </AppShell>
  );
}
