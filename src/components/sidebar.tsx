'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  ShoppingBag, Send, Inbox, Briefcase, Users, TrendingUp, Calculator, BookOpen,
  Settings, LogOut, Building2, DollarSign,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionUser } from '@/lib/auth/context';
import type { Branding } from '@/lib/branding';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  perm: string;
}

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Workflow',
    items: [
      { href: '/deal-shop', label: 'Shop Deals', icon: ShoppingBag, perm: 'deals.shop' },
      { href: '/submit', label: 'Submit Deal', icon: Send, perm: 'deals.submit' },
      { href: '/submissions', label: 'Submissions', icon: Inbox, perm: 'submissions.view' },
      { href: '/active-deals', label: 'Active Deals', icon: Briefcase, perm: 'active_deals.view' },
      { href: '/portfolio', label: 'Portfolio', icon: TrendingUp, perm: 'active_deals.view' },
    ],
  },
  {
    title: 'Commissions',
    items: [
      { href: '/commissions', label: 'Commissions', icon: DollarSign, perm: 'commissions.view' },
      { href: '/payments', label: 'Payments', icon: DollarSign, perm: 'commissions.manage' },
    ],
  },
  {
    title: 'Data',
    items: [
      { href: '/funders', label: 'Funders', icon: Users, perm: 'funders.view' },
      { href: '/funded-board', label: 'Funded Board', icon: TrendingUp, perm: 'funded_board.view' },
      { href: '/info', label: 'Knowledge Base', icon: BookOpen, perm: 'info.view' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { href: '/calculator', label: 'Calculator', icon: Calculator, perm: 'calculator.use' },
    ],
  },
];

export function Sidebar({ user, branding }: { user: SessionUser; branding: Branding }) {
  const pathname = usePathname();
  const isAdmin = user.role === 'company_admin' || user.role === 'master_admin';
  const initial = (branding.displayName || branding.productName || 'M').charAt(0).toUpperCase();
  const userInitial = (user.name || user.email || 'U').charAt(0).toUpperCase();

  return (
    <aside className="w-60 border-r border-border bg-card flex flex-col shrink-0 h-screen sticky top-0">
      {/* Brand header */}
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
          <div className="text-[11px] text-muted-foreground truncate">{branding.displayName}</div>
        </div>
      </Link>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section) => {
          const visible = section.items.filter((it) => isAdmin || user.permissions.includes(it.perm));
          if (visible.length === 0) return null;
          return (
            <div key={section.title} className="mb-5">
              <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {section.title}
              </div>
              <div className="space-y-0.5">
                {visible.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(item.href + '/');
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn('nav-item', active ? 'nav-item-active' : 'nav-item-inactive')}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}

        {isAdmin && (
          <div className="mb-5">
            <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Admin
            </div>
            <div className="space-y-0.5">
              <Link
                href="/settings"
                className={cn(
                  'nav-item',
                  pathname.startsWith('/settings') ? 'nav-item-active' : 'nav-item-inactive'
                )}
              >
                <Settings className="h-4 w-4" />
                <span>Settings</span>
              </Link>
              <Link
                href="/master"
                className={cn(
                  'nav-item',
                  pathname.startsWith('/master') ? 'nav-item-active' : 'nav-item-inactive'
                )}
              >
                <Building2 className="h-4 w-4" />
                <span>Companies</span>
              </Link>
            </div>
          </div>
        )}
      </nav>

      {/* User footer */}
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
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="w-full nav-item nav-item-inactive"
        >
          <LogOut className="h-4 w-4" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
