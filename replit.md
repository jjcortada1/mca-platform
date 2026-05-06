# Cortada MCA Platform

Deal-shopping and submission tool for MCA (Merchant Cash Advance) companies — tracks deals, funders, submissions, and funded entries.

## Run & Operate

| Command | Purpose |
|---|---|
| `npm run setup && npm run dev` | First boot — migrates DB, seeds data, starts dev server |
| `npm run dev` | Start dev server (port 5000) |
| `npm run build` | Production build |
| `npm run db:push` | Push schema changes to DB |
| `npm run db:seed` | Re-seed (idempotent) |

**Required env vars:** `DATABASE_URL` (auto-set by Replit Postgres)  
**Auto-generated on first boot:** `ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` (written to `.env.local`)  
**Optional:** `SYSTEM_SMTP_*` for password-reset emails

**Login:** `jj@cortadacapitalgroup.com` / `Flinjcorta1`

## Stack

- **Next.js 14** App Router + TypeScript
- **Drizzle ORM** with Postgres (`postgres-js`)
- **NextAuth v4** — credentials provider, JWT sessions
- **Tailwind CSS** + custom shadcn-style primitives (`src/components/ui/primitives.tsx`)
- **Nodemailer** for SMTP; AES-256-GCM for encrypting SMTP creds at rest
- **Zod** for validation

## Where things live

```
src/
  app/
    (app)/          # Authenticated app pages (dashboard, funders, calculator, etc.)
    (master)/       # Master-admin pages (manage multiple companies)
    api/            # 30+ API routes
    login/          # Public auth pages
  components/       # Sidebar, toast, session-provider, UI primitives
  lib/
    db/             # schema.ts, client.ts, seed.ts, migrate.ts
    auth/           # NextAuth options + context
    calculator/     # MCA forward + reverse logic
    matching/       # Deal-shop funder matching engine
    email/          # SMTP wrapper
    branding/       # Company branding helpers
data/
  default-funders.ts  # Master default funder list
scripts/
  setup.js          # First-boot idempotent setup script
```

## Architecture decisions

- **Single-tenant by default:** One company (Cortada) is seeded; master admin can add more via `/master`
- **`.setup-complete` marker file:** Setup script skips DB push + seed on subsequent boots for speed; delete it to re-run
- **Encryption at rest:** SMTP passwords encrypted with AES-256-GCM using `ENCRYPTION_KEY` — changing the key after data is saved breaks existing creds
- **Per-rep vs. shared SMTP:** Configurable in Settings; per-rep mode lets each user supply their own credentials
- **Funder tiers:** Deals are matched to funders by configurable tier criteria (credit score, revenue, etc.)

## Product

- **Deal Shop** — enter deal criteria, see qualifying funders ranked by tier
- **Submit Deal** — send deal packages to selected funders (one email per funder)
- **Submissions** — track per-funder responses (approved / declined / no response)
- **Active Deals** — manage in-flight deals and statuses
- **Funded Board** — log closed deals, track MTD totals
- **Calculator** — forward MCA + reverse calculator (client-side, instant)
- **Info** — internal knowledge base (SOPs, ISO docs, deal notes)
- **Settings** — SMTP, commission rules, structured fields, users, funder tiers
- **Master** — provision additional MCA companies

## User preferences

_Populate as you build_

## Gotchas

- Port **5000** is required for Replit webview (dev and prod both use `-p 5000`)
- Never change `ENCRYPTION_KEY` after SMTP creds are saved — they become unrecoverable
- Delete `.setup-complete` to force a full re-setup (schema push + seed) on next boot
- Gmail SMTP requires an **app password**, not the regular account password

## Pointers

- Schema: `src/lib/db/schema.ts`
- Seed: `src/lib/db/seed.ts`
- Matching engine: `src/lib/matching/engine.ts`
- Funder repository: `src/lib/funders/repository.ts`
