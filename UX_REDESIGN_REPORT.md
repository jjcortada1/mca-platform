# MCA Platform — UI/UX Redesign Report

Premium SaaS feel, customizable branding, consistent feedback throughout.
No backend logic broken. No features removed. Single migration adds 5 columns.

---

## 1. Files changed

### New files
| File | Purpose |
|---|---|
| `src/lib/branding/index.ts` | Branding helper — fetches per-tenant or public branding with fallbacks |
| `src/app/api/branding/public/route.ts` | Public-cached endpoint serving branding to login page |
| `src/components/toast.tsx` | `<ToastProvider>` + `useToast()` hook for success/error/info messages |
| `public/favicon.svg` | Default favicon (overridden by tenant logo if set) |

### Schema (1 migration)
| File | Change |
|---|---|
| `src/lib/db/schema.ts` | Added 5 nullable columns to `companies`: `productName`, `displayName`, `logoUrl`, `primaryColor`, `emailSignature` |

### Settings API
| File | Change |
|---|---|
| `src/app/api/settings/company/route.ts` | GET returns 5 new branding fields; PATCH validates and persists them (HSL regex on primaryColor, URL on logoUrl) |

### UI primitives
| File | Change |
|---|---|
| `src/components/ui/primitives.tsx` | Added: `PasswordInput` with show/hide toggle, `Skeleton`, `EmptyState`, `PageHeader`, `SectionHeader`. Polished `Button` (loading spinner, active scale), `Input` (taller, better focus), `Card` (subtle shadow transition) |
| `src/app/globals.css` | Refined palette, typography stack (Inter Tight + JetBrains Mono), better scrollbars, autofill fix, `.kpi-tile` and `.nav-item-*` helper classes, shimmer animation |

### Auth pages (redesigned)
| File | Change |
|---|---|
| `src/app/login/page.tsx` | Centered single-column layout; brand mark from logoUrl OR auto-generated initial; show/hide password; inline error in rose alert box; footer with display name |
| `src/app/forgot-password/page.tsx` | Matches login design; success state with check icon; back-to-sign-in link |
| `src/app/reset-password/page.tsx` | Matches login design; uses `PasswordInput` for both fields; client-side validation; success state with auto-redirect |

### Internal app
| File | Change |
|---|---|
| `src/app/layout.tsx` | Async `generateMetadata()` pulls product name from branding for browser title; injects `--primary` / `--accent` / `--ring` CSS variables from tenant branding; wraps in `<ToastProvider>` |
| `src/app/(app)/layout.tsx` | Fetches tenant branding via `getTenantBranding()` and passes to sidebar |
| `src/components/sidebar.tsx` | Branded header (logo or initial mark + product name); nav grouped into sections (Workflow / Data / Tools / Admin); polished active state (`bg-primary/10 text-primary` instead of solid fill); user avatar with initial |
| `src/app/(app)/dashboard/page.tsx` | New `kpi-tile` cards with colored icon badges; subtle hover; quick-action grid replaces inline link list |
| `src/app/(app)/settings/page.tsx` | New "Branding" tab as first tab; tabs grouped into 4 sections (Brand / Email / Financial / Team) with section labels; all sections converted from `alert()` to toast notifications; commission rules cast string-to-number for new API contract |

### User-facing pages — toast feedback added
| File | Change |
|---|---|
| `src/app/(app)/funded-board/page.tsx` | `alert()` → `toast.error()` / `toast.success()` |
| `src/app/(app)/funders/page.tsx` | Same |
| `src/app/(app)/active-deals/page.tsx` | Same; delete now shows toast feedback too |
| `src/app/(app)/info/page.tsx` | Same |

### Setup script
| File | Change |
|---|---|
| `scripts/setup.js` | Now only persists managed env vars (DATABASE_URL, NEXTAUTH_*, ENCRYPTION_KEY, SEED_*, SYSTEM_SMTP_*) to `.env.local`. Previously polluted .env.local with the entire shell environment. |

**Total: 17 files changed, 4 files added.**

---

## 2. UI improvements made

### Pre-login page
- **Centered single column** instead of cramped 2-column with side panel
- **Neutral SaaS aesthetic** — no Cortada-specific copy, clean enough to be any company
- **Brand mark** — falls back to a tasteful initial-letter chip in the primary color when no logo is set
- **Subtle radial gradient background** at low opacity for depth without noise
- **Footer line** with display name + "Secure login"

### Login form
- **Show/hide password** via eye icon embedded in the field
- **Forgot password link** below a divider — present but not distracting
- **Inline error** in a rose-tinted box with icon (replaces flat red text)
- **Loading state** on Sign In button (spinner + label change)
- **Better spacing** — generous padding, comfortable line-heights
- **Mobile-responsive** — stays centered, scales gracefully

### Internal layout
- **Branded sidebar header** with logo or initial-letter mark + product name + display name
- **Nav grouped into sections** (Workflow, Data, Tools, Admin) — easier to scan than one flat list
- **Subtler active state** — `primary/10` background tint with primary text, not solid fill (less aggressive)
- **User avatar circle** with initial in footer
- **Sticky sidebar** with proper scroll handling
- **Wider content area** — `max-w-[1400px]` with generous lateral padding
- **Consistent page header** via `<PageHeader />` primitive across pages

### Premium touches
- **Toast notifications** — success/error/info with slide-in animation, auto-dismiss
- **Loading buttons** with spinner + disabled state
- **Polished inputs** — taller (h-10), proper focus ring, autofill style fix
- **Refined colors** — warmer off-white background, smoother muted tones
- **Inter Tight + JetBrains Mono fonts** with feature-settings for cleaner numerals
- **Active-scale on buttons** — they feel pressed, not just colored
- **Subtle hover shadows** on cards
- **Refined scrollbars** with proper border treatment
- **Tabular numbers** baked in everywhere money/percentages live

### Dashboard
- **KPI tiles** with colored icon badges (blue/violet/emerald/amber)
- **3xl numerals** with tabular-nums for alignment
- **Quick-action grid** — 4 cards for shop/submit/calculator/funders
- **Welcome line** with rep's first name

---

## 3. Settings/customization added

### New "Branding" tab (first tab in Settings)
- **Identity:** product name (browser tab + sidebar) + display name (login page + footer)
- **Logo URL:** with live preview (handles broken URLs gracefully)
- **Primary color:** 7 named presets (Deep Teal, Cobalt, Royal Indigo, Forest, Burgundy, Slate, Charcoal) plus a custom HSL input with live color swatch preview
- **Email signature:** multi-line textarea — appended to deal submission emails

### Tab reorganization
Settings tabs now grouped under section labels:
- **Brand** — Branding
- **Email** — Email mode, SMTP, Email fields
- **Financial** — Commission rules
- **Team** — Users, Funder tiers

### Continued: existing customizable controls
All previously-configurable settings remain unchanged:
- Email mode (per-rep vs shared)
- SMTP (with verify connection button)
- Default CC emails (per-company global CCs)
- Structured submission email fields
- Funder tiers (CRUD)
- Commission rules (factor rate brackets)
- Users + per-user permission grid

---

## 4. Database / schema changes

**One migration. Five new nullable columns on `companies`. No data backfill required.**

```sql
ALTER TABLE companies
  ADD COLUMN product_name      varchar(100),
  ADD COLUMN display_name      varchar(200),
  ADD COLUMN logo_url          text,
  ADD COLUMN primary_color     varchar(30),
  ADD COLUMN email_signature   text;
```

These are applied automatically when you run `npm run db:push` (also runs as part of `npm run setup`).

When values are NULL, the app falls back to:
- `productName` → "MCA Platform"
- `displayName` → company.name
- `logoUrl` → null (renders initial-letter mark instead)
- `primaryColor` → "184 70% 22%" (deep teal)
- `emailSignature` → null

So existing deployments work without setting anything.

---

## 5. What you need to run / update

### If this is a fresh upload to Replit
Same flow as before:
1. Upload `mca-platform.zip`
2. Shell: `unzip -o mca-platform.zip && cp -rf mca-platform/. . && rm -rf mca-platform mca-platform.zip index.js`
3. Tools → Database → Create database (PostgreSQL)
4. Click Run

The setup script automatically pushes the schema with the new branding columns.

### If you're upgrading an existing deployment
1. Upload the new `mca-platform.zip`
2. Shell: `unzip -o mca-platform.zip && cp -rf mca-platform/. . && rm -rf mca-platform mca-platform.zip`
3. **Force the schema push** to add the new columns:
   ```bash
   rm .setup-complete
   ```
4. Click Stop → Run

The setup script will detect the missing marker, push the schema (additive — won't drop existing data), and skip seeding (no duplicates created).

---

## 6. Testing checklist

### Pre-login
- [ ] Visit `/login` while signed out → centered card, brand mark visible
- [ ] No company set yet → falls back to "MCA Platform" name and initial-letter mark
- [ ] After setting `productName` and `logoUrl` in Branding settings + refresh → login page shows new logo and name
- [ ] Sign in with wrong credentials → inline rose error box appears
- [ ] Sign in button shows spinner while loading
- [ ] Eye icon on password field toggles visibility
- [ ] Forgot password link routes to `/forgot-password`
- [ ] Mobile (narrow viewport) → still centered, no horizontal scroll

### Forgot/reset password
- [ ] Submit forgot-password form → success card with "Check your inbox"
- [ ] Visit reset-password without token → form still shows (no error until submit)
- [ ] Try password under 8 chars → inline error
- [ ] Try mismatched confirm → inline error
- [ ] Successful reset → success card auto-redirects to /login after 2s

### Logged-in app
- [ ] Sidebar shows product name + display name + logo/initial
- [ ] Nav items grouped into Workflow / Data / Tools / Admin sections
- [ ] Active page in sidebar uses subtle `primary/10` tint, not solid fill
- [ ] User avatar circle in footer shows correct initial
- [ ] Sign out works
- [ ] Dashboard shows 4 KPI tiles with colored icon badges
- [ ] KPI numbers are tabular-aligned (e.g. $1,234 doesn't wobble)
- [ ] Quick-action cards have hover state with primary color tint

### Settings → Branding
- [ ] Tab is first in the Settings nav
- [ ] Set productName + Save → toast appears, browser tab title updates after refresh
- [ ] Set logoUrl to a valid image URL → preview swatch appears
- [ ] Click a color preset → swatch updates, custom HSL input fills in
- [ ] Type custom HSL like `300 60% 40%` → swatch shows that color, save accepts
- [ ] Type invalid HSL like `not a color` → save rejects with error toast showing format hint
- [ ] After saving primary color + refresh → all primary buttons / active nav items use new color

### Settings → other tabs
- [ ] Tabs grouped under Brand / Email / Financial / Team labels
- [ ] Email mode save → toast (not alert)
- [ ] SMTP save → toast
- [ ] Commission rules: edit a threshold, save → toast, no NaN crash on calculator
- [ ] Email fields: add a field, save → toast
- [ ] Users: create user → toast, modal closes
- [ ] Tiers: create tier → toast, delete tier still uses `confirm()` (intentional)

### Critical user flows
- [ ] Funded board: log entry → success toast, list refreshes
- [ ] Funders: edit funder → success toast
- [ ] Active deals: edit deal → success toast (no more 405)
- [ ] Active deals: delete deal → confirm + success toast
- [ ] Info: create entry → success toast
- [ ] Calculator: enter values → results update instantly (no API call, no crash)

### Premium feel checks
- [ ] No `alert()` popups anywhere (except `confirm()` on destructive actions)
- [ ] All save buttons have loading spinners while saving
- [ ] All inputs have proper focus rings
- [ ] No layout jumps when toasts appear (they overlay top-right)
- [ ] No raw "Saved." or "Save failed" text — all goes through toast
- [ ] Sidebar stays sticky on scroll
- [ ] Tables have hover row highlighting

---

## What I did NOT change

Per your brief: no random new features, no backend logic broken, no features removed.

- All 30+ API routes work exactly as before (only `/api/settings/company` added 5 fields)
- All matching/calculator/SMTP/seed logic untouched
- All data already in your DB stays, with branding fields defaulting to NULL → fallback values
- Funder/tier model unchanged (the redesign you mentioned for funder-per-tier-program is a future change, not part of this pass)
- Industries are still fixed in `src/lib/constants.ts` (same future-change category)

These are the next things to tackle when you're ready — they're real schema changes, not UI polish.
