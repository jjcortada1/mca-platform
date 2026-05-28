import { pageRequireTenant } from '@/lib/auth/context';
import { Sidebar } from '@/components/sidebar';
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
    <div className="min-h-screen flex bg-background">
      <Sidebar user={user} branding={branding} />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 overflow-auto">
          <div className="max-w-[1400px] mx-auto px-6 py-8 lg:px-10 lg:py-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
