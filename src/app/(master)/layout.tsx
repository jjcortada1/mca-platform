import Link from 'next/link';
import { pageRequireMaster } from '@/lib/auth/context';
import { Building2, Users as UsersIcon, ArrowLeft } from 'lucide-react';
import { SignOutButton } from '@/components/sign-out-button';
import { getPublicBranding } from '@/lib/branding';

export default async function MasterLayout({ children }: { children: React.ReactNode }) {
  const user = await pageRequireMaster();
  const branding = await getPublicBranding();
  const initial = (branding.displayName || branding.productName || 'M').charAt(0).toUpperCase();
  const userInitial = (user.name || user.email || 'U').charAt(0).toUpperCase();

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-60 border-r border-border bg-card flex flex-col shrink-0 h-screen sticky top-0">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 px-4 py-4 border-b border-border hover:bg-muted/40 transition-colors"
        >
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoUrl} alt={branding.displayName} className="h-8 w-8 rounded-md object-contain" />
          ) : (
            <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center shrink-0">
              <span className="text-sm font-bold tracking-tight">{initial}</span>
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight truncate">{branding.productName}</div>
            <div className="text-[11px] text-muted-foreground truncate">Master admin</div>
          </div>
        </Link>

        <nav className="flex-1 px-3 py-4">
          <div className="mb-5">
            <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Master
            </div>
            <div className="space-y-0.5">
              <Link href="/master" className="nav-item nav-item-inactive">
                <Building2 className="h-4 w-4" /> <span>Companies</span>
              </Link>
              <Link href="/master/funders" className="nav-item nav-item-inactive">
                <UsersIcon className="h-4 w-4" /> <span>Default funders</span>
              </Link>
            </div>
          </div>
          <div>
            <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Back
            </div>
            <div className="space-y-0.5">
              <Link href="/dashboard" className="nav-item nav-item-inactive">
                <ArrowLeft className="h-4 w-4" /> <span>To main app</span>
              </Link>
            </div>
          </div>
        </nav>

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2.5 px-2 py-2 mb-1">
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0 ring-1 ring-border">
              <span className="text-xs font-semibold text-foreground/70">{userInitial}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{user.name}</div>
              <div className="text-[11px] text-muted-foreground truncate">{user.email}</div>
            </div>
          </div>
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="max-w-[1400px] mx-auto px-6 py-8 lg:px-10 lg:py-10">{children}</div>
      </main>
    </div>
  );
}
