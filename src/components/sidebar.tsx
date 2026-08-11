'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useEffect, useState } from 'react';
import {
  ShoppingBag, Send, Inbox, Briefcase, Users, TrendingUp, Calculator, BookOpen, FileText,
  Settings, LogOut, Building2, DollarSign, Menu, X, UserCircle, ClipboardList,
  Handshake, Gift, FileSignature, Table2, ChevronDown,
  PanelLeftOpen, PanelLeftClose, Trophy, Banknote, ReceiptText, Layers, BarChart3,
  ShieldCheck, Gavel,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NotificationBell } from '@/components/notification-bell';
import { BrandMark } from '@/components/brand-mark';
import { resolveIcon } from '@/lib/sidebar-icons';
import type { SessionUser } from '@/lib/auth/context';
import type { Branding } from '@/lib/branding';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  perm: string;
}

/**
 * Master list of every left-nav item the app exposes.
 *
 * Exported so the Settings → Sidebar order page can render a draggable list
 * of them all (and so the API endpoint has a canonical set of valid keys to
 * validate against).
 *
 * Order here = the DEFAULT order. Companies that haven't customized their
 * sidebar see this order. Once the admin saves a custom order on the
 * Sidebar Order settings page, that order replaces this default for every
 * user in the company.
 */
export const ALL_NAV_ITEMS: NavItem[] = [
  // /deal-shop is the unified shop+submit page. Criteria, matching, funder
  // selection, AND the send form all live on the one page now — the
  // separate /submit route was retired in favor of a single-screen flow.
  // /submit redirects to /deal-shop so any old bookmarks still resolve.
  { href: '/deal-shop',    label: 'Shop & Submit',  icon: ShoppingBag, perm: 'deals.shop' },
  // Underwriting — drop in bank statements and get an instant MCA scrub
  // (existing positions, cash-flow health, red flags). Runs entirely on
  // local code in the browser; no AI credits and nothing is uploaded.
  { href: '/underwriting', label: 'Underwriting',   icon: ShieldCheck, perm: 'deals.shop' },
  // NY court record search — public civil index lookup for defaults and
  // judgments against a merchant or an owner.
  { href: '/court-search', label: 'Court Search',   icon: Gavel,       perm: 'deals.shop' },
  { href: '/funded-email', label: 'Funded Email',   icon: Send,        perm: 'deals.submit' },
  // Send Application — Dropbox Sign: name + email → signature request.
  { href: '/esign',        label: 'Send Application', icon: FileSignature, perm: 'deals.submit' },
  { href: '/submissions',  label: 'Submissions',    icon: Inbox,       perm: 'submissions.view' },
  { href: '/active-deals', label: 'Active Deals',   icon: Briefcase,   perm: 'active_deals.view' },
  // Distinct icons on purpose — these two sat adjacent with the SAME icon
  // and users couldn't tell the leaderboard from the real portfolio.
  { href: '/funded-board', label: 'Funded Board',   icon: Trophy,      perm: 'active_deals.view' },
  { href: '/portfolio',    label: 'Funded Deals',   icon: TrendingUp,  perm: 'active_deals.view' },
  // Syndication — a shared board where deals open for syndication are posted
  // with full terms, and reps put in how much they want to participate.
  { href: '/syndication',  label: 'Syndication',    icon: Handshake,   perm: 'deals.view' },
  { href: '/commissions',  label: 'Commissions',    icon: DollarSign,  perm: 'commissions.view' },
  { href: '/payments',     label: 'Payments',       icon: Banknote,    perm: 'commissions.manage' },
  { href: '/accounting',   label: 'Accounting',     icon: ReceiptText, perm: 'commissions.manage' },
  { href: '/preview',      label: 'View as…',       icon: Users,       perm: 'commissions.manage' },
  { href: '/funders',      label: 'Funders',        icon: Users,       perm: 'funders.view' },
  // Funder Intel — per-funder win/offer/approval analytics, derived
  // automatically from submissions + offers + funded deals.
  { href: '/funder-analytics', label: 'Funder Intel', icon: BarChart3, perm: 'funders.view' },
  { href: '/calculator',   label: 'Calculator',     icon: Calculator,  perm: 'calculator.use' },
  // Reverse Consolidation Sheet — builds a branded, printable offer for a
  // weekly-disbursement consolidation. Pure presentation tool (no DB writes).
  { href: '/reverse-consolidation', label: 'Reverse Consolidation', icon: Layers, perm: 'calculator.use' },
  // Doc Request — generates a clean copy-paste message for requesting
  // contracts from a funder. Lives under the same "General / Resources"
  // bucket as Calculator + Info. No persistence; pure formatter UI.
  { href: '/doc-request',  label: 'Doc Request',    icon: FileText,    perm: 'calculator.use' },
  // Bonuses — which funders are running bonuses, the window, and conditions.
  { href: '/bonuses',      label: 'Bonuses',        icon: Gift,        perm: 'deals.view' },
  // Worksheets — personal Google-Sheets-style tracking, separate from all
  // deal/funded analytics, shareable per-sheet across companies.
  { href: '/worksheets',   label: 'Worksheets',     icon: Table2,      perm: 'deals.view' },
  { href: '/info',         label: 'Info',           icon: BookOpen,    perm: 'info.view' },
  // Tasks — company + broker to-dos with teams/leaders. Gated by the most
  // basic permission every user has so the tab shows for everyone.
  { href: '/tasks',        label: 'Tasks',          icon: ClipboardList, perm: 'deals.view' },
];

/** Default categories when nothing is saved — restores the original sections. */
export const DEFAULT_CATEGORIES: { id: string; label: string; items: string[] }[] = [
  {
    id: 'workflow', label: 'Workflow',
    items: ['/deal-shop', '/underwriting', '/court-search', '/funded-email', '/esign', '/submissions', '/active-deals', '/funded-board', '/portfolio', '/syndication'],
  },
  {
    id: 'commissions', label: 'Commissions',
    items: ['/commissions', '/payments', '/accounting', '/preview'],
  },
  {
    id: 'sheets', label: 'Sheets',
    items: ['/worksheets'],
  },
  {
    id: 'resources', label: 'Resources',
    items: ['/funders', '/funder-analytics', '/bonuses', '/calculator', '/reverse-consolidation', '/doc-request', '/info', '/tasks'],
  },
];

/**
 * Apply a saved order (href[]) to the master list. Items in the saved order
 * appear first in the saved sequence; items NOT in the saved order are
 * appended in their default order at the end. That way new nav items added
 * to the app in a future release show up automatically without an admin
 * needing to re-edit their order.
 */
function applyOrder(items: NavItem[], savedOrder: string[] | null): NavItem[] {
  if (!savedOrder || savedOrder.length === 0) return items;
  const byHref = new Map(items.map((i) => [i.href, i]));
  const seen = new Set<string>();
  const result: NavItem[] = [];
  for (const href of savedOrder) {
    const it = byHref.get(href);
    if (it && !seen.has(href)) {
      result.push(it);
      seen.add(href);
    }
  }
  for (const it of items) {
    if (!seen.has(it.href)) result.push(it);
  }
  return result;
}

/**
 * Resolve a final categorized sidebar from the saved config + master list.
 *
 * Priority order:
 *   1. If admin saved categories, use those. Items not in any category get
 *      appended to a final "Other" bucket (so new app releases auto-surface).
 *   2. Else if admin saved a flat order, treat it as one un-labeled section.
 *   3. Else use the hardcoded DEFAULT_CATEGORIES.
 *
 * The function ALSO filters each section's items down to ones the user
 * actually has permission to see, dropping empty sections.
 */
function resolveCategories(
  allItems: NavItem[],
  savedCategories: { id: string; label: string; items: string[] }[] | null,
  savedOrder: string[] | null,
  canSee: (item: NavItem) => boolean,
): { id: string; label: string; items: NavItem[] }[] {
  const byHref = new Map(allItems.map((i) => [i.href, i]));

  let raw: { id: string; label: string; items: string[] }[];
  if (savedCategories && savedCategories.length) {
    raw = savedCategories;
  } else if (savedOrder && savedOrder.length) {
    // Legacy flat-order tenants: render as a single un-labeled section.
    raw = [{ id: 'menu', label: '', items: savedOrder }];
  } else {
    raw = DEFAULT_CATEGORIES;
  }

  // Track which items have been placed so we can append unplaced ones.
  const placed = new Set<string>();
  const resolved = raw.map((cat) => {
    const items = cat.items
      .map((h) => byHref.get(h))
      .filter((i): i is NavItem => !!i)
      .filter((i) => {
        if (placed.has(i.href)) return false;
        if (!canSee(i)) return false;
        placed.add(i.href);
        return true;
      });
    return { id: cat.id, label: cat.label, items };
  });

  // Anything we didn't place goes into an Other bucket so new nav items
  // surface automatically when added in future releases.
  const leftover = allItems.filter((i) => !placed.has(i.href) && canSee(i));
  if (leftover.length) {
    resolved.push({ id: '_other', label: 'Other', items: leftover });
  }

  // Drop empty sections (every item filtered out by permissions).
  return resolved.filter((cat) => cat.items.length > 0);
}

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
  // ONE config fetch + ONE tasks poll for the whole shell — shared by the
  // desktop rail/wide sidebar and the mobile drawer.
  const sidebarConfig = useSidebarConfig(user);

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
        <Sidebar user={user} branding={branding} config={sidebarConfig} />
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
        {/* Drawer — SOLID background (was translucent bg-muted/30, which made
            the menu hard to read over page content on mobile). */}
        <div
          className={cn(
            'absolute inset-y-0 left-0 w-[280px] max-w-[85vw] bg-card border-r border-border flex flex-col transition-transform duration-200 shadow-2xl',
            open ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <SidebarBody user={user} branding={branding} config={sidebarConfig} onNavigate={() => setOpen(false)} closable onClose={() => setOpen(false)} />
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <MobileTopBar user={user} branding={branding} onOpenMenu={() => setOpen(true)} />

        <main className="flex-1 overflow-auto">
          {/* Content column: 1280 on laptops, up to 1440 on large monitors so
              data-dense tables get room instead of squeezing. Vertical rhythm
              tightened slightly (py-12 read as empty at the top of lists). */}
          <div className="max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-9">
            {children}
          </div>
        </main>
      </div>

      {/* Global search removed by request (the ⌘K palette is unmounted;
          the component is preserved in the codebase if it's ever wanted
          back). */}
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
          <BrandMark logoUrl={branding.logoUrl} name={branding.productName || branding.displayName} size={32} rounded="md" />
          <div className="text-sm font-semibold tracking-tight truncate max-w-[140px]">
            {branding.productName}
          </div>
        </Link>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <div className="h-8 w-8 rounded-lg bg-foreground text-background flex items-center justify-center text-xs font-semibold">
            {userInitial}
          </div>
        </div>
      </div>
    </header>
  );
}

/* ============================================================
   SHARED SIDEBAR CONFIG — one hook drives BOTH the desktop icon
   rail and the mobile drawer, so permissions, per-company order,
   overrides, feature access, hides, and the tasks badge can never
   drift between the two. Called ONCE in AppShell and passed down —
   never in both children (that doubled every fetch + the tasks
   poll, i.e. duplicate API requests on a timer).
   ============================================================ */
export interface SidebarConfig {
  visibleSections: { id: string; label: string; items: NavItem[] }[];
  myOpenTasks: number;
  isAdmin: boolean;
}

function useSidebarConfig(user: SessionUser): SidebarConfig {
  const isAdmin = user.role === 'company_admin' || user.role === 'master_admin';

  // Open tasks assigned to me — drives the red badge on the Tasks item.
  const [myOpenTasks, setMyOpenTasks] = useState(0);
  useEffect(() => {
    if (user.role === 'lead_source') return;
    let cancelled = false;
    const check = () => {
      fetch('/api/tasks', { cache: 'no-store' })
        .then((r) => r.ok ? r.json() : null)
        .then((j) => {
          if (cancelled || !j) return;
          const meId = j.me?.id;
          const count = (j.data ?? []).filter((t: { status: string; assignedToUserId: string | null }) =>
            t.status !== 'completed' && (t.assignedToUserId === meId || t.assignedToUserId === null)
          ).length;
          setMyOpenTasks(count);
        })
        .catch(() => {});
    };
    check();
    const iv = setInterval(check, 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [user.role]);

  // Saved config from the company (order, categories, overrides, gates).
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);
  const [savedCategories, setSavedCategories] = useState<{ id: string; label: string; items: string[] }[] | null>(null);
  const [itemOverrides, setItemOverrides] = useState<Record<string, { label?: string; icon?: string }> | null>(null);
  const [enabledNavItems, setEnabledNavItems] = useState<string[] | null>(null);
  const [hiddenNavItems, setHiddenNavItems] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/sidebar-order', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const o = j?.data?.order;
        const c = j?.data?.categories;
        const ov = j?.data?.itemOverrides;
        const en = j?.data?.enabledNavItems;
        const hid = j?.data?.hiddenNavItems;
        if (Array.isArray(o)) setSavedOrder(o);
        if (Array.isArray(c)) setSavedCategories(c);
        if (ov && typeof ov === 'object') setItemOverrides(ov);
        if (Array.isArray(en)) setEnabledNavItems(en);
        if (Array.isArray(hid)) setHiddenNavItems(hid);
      })
      .catch(() => { /* fall through to default order */ });
    return () => { cancelled = true; };
  }, []);

  const itemsWithOverrides: NavItem[] = ALL_NAV_ITEMS.map((item) => {
    const ov = itemOverrides?.[item.href];
    if (!ov) return item;
    return {
      ...item,
      label: ov.label || item.label,
      icon: resolveIcon(ov.icon, item.icon as Parameters<typeof resolveIcon>[1]),
    };
  });

  const visibleSections = resolveCategories(
    itemsWithOverrides,
    savedCategories,
    savedOrder,
    // Visible when: the user has the permission (admins pass everything)
    // AND the feature is enabled for this company (platform-owner control)
    // AND the company admin hasn't hidden it (self-service control).
    // EXCEPTIONS: /worksheets is personal + cross-company (never hidden by
    // company gates); /syndication is a company-wide board by design — the
    // APIs allow every non-lead-source user, so the tab must too.
    (item) =>
      (isAdmin || user.permissions.includes(item.perm) || item.href === '/syndication') &&
      (item.href === '/worksheets' || enabledNavItems === null || enabledNavItems.includes(item.href)) &&
      (item.href === '/worksheets' || !hiddenNavItems || !hiddenNavItems.includes(item.href)),
  );

  return { visibleSections, myOpenTasks, isAdmin };
}

/* ============================================================
   DESKTOP ICON RAIL (visible on lg+) — the command-center nav.
   Slim rail of icons with flyout labels; active item gets an
   accent glow + indicator bar. All gating/order/overrides come
   from the same hook as the mobile drawer. Section boundaries
   render as hairline separators.
   ============================================================ */
export function Sidebar({ user, branding, config }: { user: SessionUser; branding: Branding; config: SidebarConfig }) {
  const pathname = usePathname();
  const { visibleSections, myOpenTasks, isAdmin } = config;
  const userInitial = (user.name || user.email || 'U').charAt(0).toUpperCase();
  const settingsActive = pathname.startsWith('/settings') || pathname.startsWith('/account') || pathname.startsWith('/master');

  // Rail ⇄ wide layout — expand back to the classic full-label sidebar any
  // time; the choice persists per browser.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    try { setWide(localStorage.getItem('sidebar:layout') === 'wide'); } catch { /* default rail */ }
  }, []);
  function setLayout(next: boolean) {
    setWide(next);
    try { localStorage.setItem('sidebar:layout', next ? 'wide' : 'rail'); } catch { /* private mode */ }
  }

  if (wide) {
    return (
      <aside className="w-60 border-r border-border bg-muted/40 flex flex-col shrink-0 h-screen sticky top-0">
        <SidebarBody
          user={user}
          branding={branding}
          config={config}
          onCollapseRail={() => setLayout(false)}
        />
      </aside>
    );
  }

  return (
    <aside className="w-[68px] border-r border-border bg-secondary/70 backdrop-blur flex flex-col items-center shrink-0 h-screen sticky top-0 py-3 z-40">
      {/* Brand */}
      <Link
        href="/dashboard"
        title={`${branding.productName} — ${branding.displayName}`}
        className="mb-1 hover:opacity-80 transition-opacity"
      >
        <BrandMark logoUrl={branding.logoUrl} name={branding.productName || branding.displayName} size={38} rounded="lg" />
      </Link>
      <button
        onClick={() => setLayout(true)}
        title="Expand sidebar (full labels)"
        className="mb-1 p-1.5 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
      >
        <PanelLeftOpen className="h-4 w-4" />
      </button>

      {/* Nav — grouped icons with hairline separators between sections. */}
      <nav className="flex-1 w-full overflow-y-auto scrollbar-none flex flex-col items-center gap-0.5 py-2">
        {visibleSections.map((section, si) => (
          <div key={section.id} className="w-full flex flex-col items-center gap-0.5">
            {si > 0 && <div className="my-1.5 h-px w-7 bg-border" />}
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/');
              const Icon = item.icon;
              return (
                <RailItem key={item.href} href={item.href} label={item.label} active={active}>
                  <Icon className="h-[18px] w-[18px]" />
                  {item.href === '/tasks' && myOpenTasks > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[15px] h-[15px] px-0.5 rounded-full bg-rose-500 text-white text-[9px] font-bold leading-none ring-2 ring-secondary">
                      {myOpenTasks > 99 ? '99' : myOpenTasks}
                    </span>
                  )}
                </RailItem>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Utility cluster — global search + theme toggle removed by request
          (the app is single-theme: the dark command center). */}
      <div className="flex flex-col items-center gap-1 pt-2 border-t border-border w-full">
        <NotificationBell compact align="left" />
        <RailItem href={isAdmin ? '/settings' : '/account'} label="Settings" active={settingsActive}>
          <Settings className="h-[18px] w-[18px]" />
        </RailItem>

        {/* User — hover for name/email + sign out. */}
        <div className="relative group mt-1">
          <div className="h-9 w-9 rounded-lg bg-foreground text-background flex items-center justify-center text-xs font-semibold cursor-default">
            {userInitial}
          </div>
          <div className="absolute left-full bottom-0 ml-2 hidden group-hover:block group-focus-within:block z-50">
            <div className="rounded-lg border border-border bg-popover text-popover-foreground shadow-xl p-3 w-52 animate-dropdown-in">
              <div className="text-sm font-medium truncate">{user.name}</div>
              <div className="text-[11px] text-muted-foreground truncate mb-2">{user.email}</div>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** One icon on the rail — flyout label on hover, glow + bar when active. */
function RailItem({
  href, label, active, children,
}: {
  href: string; label: string; active: boolean; children: React.ReactNode;
}) {
  return (
    <div className="relative group w-full flex justify-center">
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r-full bg-primary" />
      )}
      <Link
        href={href}
        className={cn(
          'relative p-2.5 rounded-lg transition-all',
          active
            ? 'text-primary bg-primary/15 glow-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        )}
      >
        {children}
      </Link>
      {/* Flyout label */}
      <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1 rounded-md bg-popover text-popover-foreground border border-border shadow-lg text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50">
        {label}
      </span>
    </div>
  );
}

/* ============================================================
   SIDEBAR BODY — shared nav body for both desktop + drawer.
   ============================================================ */
function SidebarBody({
  user,
  branding,
  config,
  onNavigate,
  closable,
  onClose,
  onCollapseRail,
}: {
  user: SessionUser;
  branding: Branding;
  config: SidebarConfig;
  onNavigate?: () => void;
  closable?: boolean;
  onClose?: () => void;
  /** Desktop wide mode only — collapses back to the icon rail. */
  onCollapseRail?: () => void;
}) {
  const pathname = usePathname();
  const { visibleSections, myOpenTasks, isAdmin } = config;
  const userInitial = (user.name || user.email || 'U').charAt(0).toUpperCase();

  // Collapsible sections — collapsed set persists per-browser so the nav
  // opens exactly how the user left it. The active page's item stays
  // visible even inside a collapsed section, so you never lose your place.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem('sidebar:collapsed-sections');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setCollapsedSections(new Set(arr.filter((x) => typeof x === 'string')));
      }
    } catch { /* first visit / blocked storage — start expanded */ }
  }, []);
  function toggleSection(id: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem('sidebar:collapsed-sections', JSON.stringify(Array.from(next))); } catch { /* private mode */ }
      return next;
    });
  }

  return (
    <>
      {/* Brand header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-2.5 min-w-0 flex-1 hover:opacity-80 transition-opacity"
        >
          <BrandMark logoUrl={branding.logoUrl} name={branding.productName || branding.displayName} size={36} rounded="lg" />
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight truncate leading-tight">{branding.productName}</div>
            <div className="text-[10.5px] text-muted-foreground truncate mt-0.5">{branding.displayName}</div>
          </div>
        </Link>
        {closable ? (
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="p-1.5 rounded-md hover:bg-muted transition-colors lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <div className="flex items-center gap-0.5">
            <NotificationBell compact align="left" />
            {onCollapseRail && (
              <button
                onClick={onCollapseRail}
                title="Collapse to icon rail"
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Nav — categorized sections, order + labels controlled by
          Settings → Sidebar order. Sections with no visible items are
          dropped automatically. */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {visibleSections.map((section) => {
          const isCollapsed = !!section.label && collapsedSections.has(section.id);
          return (
          <div key={section.id} className="mb-5">
            {section.label && (
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full flex items-center justify-between px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-muted-foreground transition-colors group/section"
                title={isCollapsed ? 'Expand section' : 'Collapse section'}
              >
                <span>{section.label}</span>
                <ChevronDown className={cn(
                  'h-3 w-3 opacity-0 group-hover/section:opacity-100 transition-all',
                  isCollapsed && '-rotate-90 opacity-60'
                )} />
              </button>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/');
                // Collapsed sections hide everything except the page you're
                // currently on, so context never disappears.
                if (isCollapsed && !active) return null;
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
                    {item.href === '/tasks' && myOpenTasks > 0 && (
                      <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold leading-none">
                        {myOpenTasks > 99 ? '99+' : myOpenTasks}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
          );
        })}

        {/* One Settings entry for everyone.
            Admins → /settings (which now contains My account + Companies).
            Non-admins → /account (their personal settings: signature, SMTP,
            password, 2FA, always-CC). My Account and Companies no longer get
            their own sidebar spots. */}
        <div className="mb-5">
          <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {isAdmin ? 'Admin' : 'Personal'}
          </div>
          <div className="space-y-0.5">
            <Link
              href={isAdmin ? '/settings' : '/account'}
              onClick={onNavigate}
              className={cn(
                'nav-item',
                (pathname.startsWith('/settings') || pathname.startsWith('/account') || pathname.startsWith('/master'))
                  ? 'nav-item-active' : 'nav-item-inactive'
              )}
            >
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </Link>
          </div>
        </div>
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
