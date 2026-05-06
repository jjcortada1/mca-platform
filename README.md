# Cortada MCA Platform

Single-tenant deal-shopping and submission tool for Cortada Capital Group.

---

## Login

| Email | Password |
|---|---|
| `jj@cortadacapitalgroup.com` | `Flinjcorta1` |

This single login has full control. Lands at `/dashboard` after first boot.

---

## Deploy on Replit (3 minutes)

### 1. Upload to Replit

1. https://replit.com → **+ Create Repl** → pick **Node.js** → Create
2. In the Files panel (left sidebar), three-dot menu → **Upload file** → upload `mca-platform.zip`
3. Open the **Shell** tab at the bottom and paste:

```bash
unzip -o mca-platform.zip && cp -rf mca-platform/. . && rm -rf mca-platform mca-platform.zip index.js && ls -la
```

You should see `package.json`, `.replit`, `src/`, `scripts/`, etc.

### 2. Get a database — pick ONE option

**Option A: Use Replit's built-in Postgres (easiest)**
1. Left sidebar → **Tools** → **Database**
2. Click **Create database** → pick **PostgreSQL**
3. Replit auto-sets `DATABASE_URL` for you. Done.

**Option B: Use Neon (free tier, also fine)**
1. https://neon.tech → sign up → **Create a project** → copy the connection string
2. Left sidebar → **🔒 Secrets** → **+ New Secret** → Key: `DATABASE_URL` → paste the string

### 3. Click Run

The green **Run** button at the top.

First boot takes ~2 minutes:
- Installs dependencies
- Generates encryption key + session secret
- Pushes schema to your database
- Seeds 5 sample funders, 4 tiers, default commission rules, 2 sample deals, 1 submission, 1 funded entry, 1 info entry
- Starts the dev server

When the webview shows the login page, **you're done**.

### 4. Sign in

Use the credentials above.

---

## What's in the app

| Tab | Purpose |
|---|---|
| Dashboard | KPI overview, MTD totals |
| Shop Deals | Pure research — enter deal details, see qualifying funders by tier |
| Submit Deal | Send deal to selected funders. One separate email per funder |
| Submissions | Track responses (approved/declined/no response) per funder per deal |
| Active Deals | Edit deal records, change status |
| Funders | Funder directory — emails, contacts, restricted states/industries |
| Funded Board | Log funded deals, see MTD totals |
| Calculator | Forward MCA + Reverse calculator (instant client-side) |
| Info | Knowledge base for SOPs, ISO docs, deal notes |
| Settings | Email mode, SMTP, commission rules, structured fields, users, tiers |
| Master | Add additional MCA companies if you ever expand beyond Cortada |

---

## Configure SMTP (required to send emails)

1. **Settings → Email mode** — pick:
   - **Per-rep**: each user uses their own SMTP (recommended for teams)
   - **Shared**: everyone sends from one company SMTP
2. **Settings → SMTP** — fill in credentials
   - For Gmail: host `smtp.gmail.com`, port `587`, username = your Gmail, password = an **app password** (https://myaccount.google.com/apppasswords — NOT your regular Gmail password)
   - From: `Your Name <you@gmail.com>`
3. Click **Verify connection** — green check = working
4. Click **Save**

Now Submit Deal will send. Each funder gets a separate email. Failed sends show with the exact SMTP error per recipient.

---

## Day-to-day flow

```
Shop Deals → enter criteria → see qualifying funders by tier
                                    ↓
                              Submit Deal → pick funders → send
                                    ↓
                              Submissions → track responses
                                    ↓
                              Funded Board → log when funded
```

---

## Updating to a new build

1. Upload the new `mca-platform.zip` to Replit (replaces the old one)
2. In Shell:
   ```bash
   unzip -o mca-platform.zip && cp -rf mca-platform/. . && rm -rf mca-platform mca-platform.zip
   npm install
   ```
3. Click **Stop**, then **Run**

The seed is idempotent — won't recreate anything that exists. To wipe and re-seed, delete `.setup-complete` first:
```bash
rm .setup-complete
```

---

## Troubleshooting

**"Invalid run command"**
The `.replit` file is missing or corrupted. Run in Shell: `cat .replit` — if it's empty or doesn't exist, the upload didn't include it. Re-upload the zip and re-extract.

**"DATABASE_URL is not set"**
Either set up Replit's built-in Postgres (Tools → Database) or add a Neon `DATABASE_URL` in Secrets.

**Login says "invalid credentials"**
Look at the Console output for the `LOGIN CREDENTIALS` banner from first boot. If you set custom env vars, those override the defaults.

**SMTP test fails**
For Gmail you must use an **app password** (https://myaccount.google.com/apppasswords) — not your regular password. Requires 2-step verification.

**Production deploy fails**
Click Run first to make sure dev mode works. Then click Deploy. The Build command is auto-set in `.replit`.

---

## Architecture

- **Next.js 14** App Router + TypeScript
- **Postgres** via `postgres-js` (works with Replit DB, Neon, Supabase, anywhere)
- **Drizzle ORM**
- **NextAuth** with credentials provider (JWT sessions)
- **Tailwind** + custom shadcn-style primitives
- **Nodemailer** for SMTP
- AES-256-GCM for SMTP credential encryption at rest

15 tables, 30+ API routes, 13 pages.
