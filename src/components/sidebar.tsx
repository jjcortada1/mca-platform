'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useEffect, useState } from 'react';
import {
  ShoppingBag, Send, Inbox, Briefcase, Users, TrendingUp, Calculator, BookOpen,
  Settings, LogOut, Building2, DollarSign, Menu, X,
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
      { href: '/funded-board', label: 'Funded Board', icon: TrendingUp, perm: 'active_deals.view' },
      { href: '/portfolio', label: 'Portfolio', icon: TrendingUp, perm: 'active_deals.view' },
    ],
  },
  {
    title: 'Commissions',
    items: [
      { href: '/commissions', label: 'Commissions', icon: DollarSign, perm: 'commissions.view' },
      { href: '/payments', label: 'Payments', icon: DollarSign, perm: 'commissions.manage' },
      { href: '/accounting', label: 'Accounting', icon: DollarSign, perm: 'commissions.manage' },
      { href: '/preview', label: 'View as…', icon: Users, perm: 'commissions.manage' },
    ],
  },
  {
    title: 'Resources',
    items: [
      { href: '/funders', label: 'Funders', icon: Users, perm: 'funders.view' },
      { href: '/calculator', label: 'Calculator', icon: Calculator, perm: 'calculator.use' },
      { href: '/info', label: 'Info', icon: BookOpen, perm: 'info.view' },
    ],
  },
];

/* ============================================================
   APP SHELL — handles desktop sidebar + mobile drawer + top bar.
   The Sidebar component below is the pure nav body shared by both.
   ============================================================ */
export function AppShell({
  user,
  branding,
  children,
}: {
  user: SessionUser;
  branding: Branding;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close drawer when route changes
  useEffect(() => { setOpen(false); }, [pathname]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar — always visible on lg+ */}
      <div className="hidden lg:flex">
        <Sidebar user={user} branding={branding} />
      </div>

      {/* Mobile drawer — slides in from left */}
      <div
        className={cn(
          'lg:hidden fixed inset-0 z-50 transition-opacity duration-200',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
        {/* Drawer */}
        <div
          className={cn(
            'absolute inset-y-0 left-0 w-[280px] max-w-[85vw] bg-muted/30 border-r border-border flex flex-col transition-transform duration-200 shadow-xl',
            open ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <SidebarBody user={user} branding={branding} onNavigate={() => setOpen(false)} closable onClose={() => setOpen(false)} />
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <MobileTopBar user={user} branding={branding} onOpenMenu={() => setOpen(true)} />

        <main className="flex-1 overflow-auto">
          <div className="max-w-[1280px] mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-12">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ============================================================
   MOBILE TOP BAR — hamburger + logo + user avatar.
   Only renders below lg.
   ============================================================ */
function MobileTopBar({
  user,
  branding,
  onOpenMenu,
}: {
  user: SessionUser;
  branding: Branding;
  onOpenMenu: () => void;
}) {
  const userInitial = (user.name || user.email || 'U').charAt(0).toUpperCase();
  return (
    <header className="lg:hidden sticky top-0 z-30 bg-card/95 backdrop-blur border-b border-border">
      <div className="flex items-center justify-between px-4 h-14">
        <button
          onClick={onOpenMenu}
          aria-label="Open menu"
          className="-ml-2 p-2 rounded-md hover:bg-muted transition-colors"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/dashboard" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={branding.logoUrl || '/brand/cortada-icon.png'}
            alt={branding.displayName}
            className="h-8 w-8 rounded-md object-contain bg-card border border-border p-0.5"
            onError={(e) => {
              const el = e.currentTarget;
              if (!el.src.endsWith('/brand/cortada-icon.png')) {
                el.src = '/brand/cortada-icon.png';
              }
            }}
          />
          <div className="text-sm font-semibold tracking-tight truncate max-w-[140px]">
            {branding.productName}
          </div>
        </Link>
        <div className="h-8 w-8 rounded-lg bg-foreground text-background flex items-center justify-center text-xs font-semibold">
          {userInitial}
        </div>
      </div>
    </header>
  );
}

/* ============================================================
   DESKTOP SIDEBAR (visible on lg+) — fixed width column.
   ============================================================ */
export function Sidebar({ user, branding }: { user: SessionUser; branding: Branding }) {
  return (
    <aside className="w-60 border-r border-border bg-muted/30 flex flex-col shrink-0 h-screen sticky top-0">
      <SidebarBody user={user} branding={branding} />
    </aside>
  );
}

/* ============================================================
   SIDEBAR BODY — shared nav body for both desktop + drawer.
   ============================================================ */
function SidebarBody({
  user,
  branding,
  onNavigate,
  closable,
  onClose,
}: {
  user: SessionUser;
  branding: Branding;
  onNavigate?: () => void;
  closable?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const isAdmin = user.role === 'company_admin' || user.role === 'master_admin';
  const userInitial = (user.name || user.email || 'U').charAt(0).toUpperCase();

  return (
    <>
      {/* Brand header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-2.5 min-w-0 flex-1 hover:opacity-80 transition-opacity"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={branding.logoUrl || '/brand/cortada-icon.png'}
            alt={branding.displayName}
            className="h-9 w-9 rounded-lg object-contain bg-card border border-border p-1 shadow-[0_1px_2px_0_hsl(222_47%_11%/0.04)] shrink-0"
            onError={(e) => {
              const el = e.currentTarget;
              if (!el.src.endsWith('/brand/cortada-icon.png')) {
                el.src = '/brand/cortada-icon.png';
              }
            }}
          />
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight truncate leading-tight">{branding.productName}</div>
            <div className="text-[10.5px] text-muted-foreground truncate mt-0.5">{branding.displayName}</div>
          </div>
        </Link>
        {closable && (
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="p-1.5 rounded-md hover:bg-muted transition-colors lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

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
                      onClick={onNavigate}
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
                onClick={onNavigate}
                className={cn('nav-item', pathname.startsWith('/settings') ? 'nav-item-active' : 'nav-item-inactive')}
              >
                <Settings className="h-4 w-4" />
                <span>Settings</span>
              </Link>
              <Link
                href="/master"
                onClick={onNavigate}
                className={cn('nav-item', pathname.startsWith('/master') ? 'nav-item-active' : 'nav-item-inactive')}
              >
                <Building2 className="h-4 w-4" />
                <span>Companies</span>
              </Link>
            </div>
          </div>
        )}
      </nav>

      {/* User footer */}
      <div className="border-t border-border p-2.5">
        <div className="flex items-center gap-2.5 px-2 py-1.5 mb-1">
          <div className="h-8 w-8 rounded-lg bg-foreground text-background flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold">{userInitial}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate leading-tight">{user.name}</div>
            <div className="text-[10.5px] text-muted-foreground truncate mt-0.5">{user.email}</div>
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
    </>
  );
}
