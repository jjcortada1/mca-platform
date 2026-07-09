# Update — July 2026 (round 20) — Worksheets

## Worksheets (new "Sheets" section in the sidebar)
- **Google-Sheets-style personal sheets** for tracking deals you work with
  people at other companies — completely **separate from your funded deals,
  funded volume, and every analytic** (own storage, feeds nothing).
- **Multiple sheets as tabs** across the top, just like Google Sheets. Add a
  sheet with +, rename it inline, delete it (with confirm).
- **Customizable columns** per sheet: rename, add, remove, and reorder from
  the Columns panel. Defaults: Deal, Partner/Company, Amount, Status, Notes.
- **Spreadsheet editing**: click any cell and type — saves as you go. Add
  rows at the bottom; delete rows on hover. Live-updates every 45s so shared
  viewers see changes.
- **Per-sheet sharing by email** — view-only or can-edit. The email must
  already have an account in the system, and **accounts at other companies
  work** — that's the point. They see ONLY the sheet(s) you shared, nothing
  else of yours, and they get a notification when you share.

---

# Update — July 2026 (round 19) — design-system overhaul

**Zero functional change.** No API, database, permission, calculation, or
workflow was touched — this round is purely the design system every screen
is built from, so the whole app upgrades at once with no data risk.

## What changed visually
- **Navigation**: active items now carry a subtle accent rail (in your
  company's color) + soft fill — you always know where you are at a glance.
  The sidebar reads as a recessed rail; the content area reads as the page.
- **Loading**: the bare "Loading…" text on Active Deals, Submissions,
  Funders, Syndication, Bonuses, Funded Board, and Tasks is replaced with
  **skeleton loaders** that hold the page's shape while data arrives.
- **Toasts**: redesigned — neutral card, colored accent rail, proper
  elevation, correct in dark mode, screen-reader announced.
- **Status chips**: success/warning/destructive badges now render correctly
  in dark mode (translucent tints instead of washed-out pastels).
- **Empty states**: refined icon treatment + typography.
- **Layout**: on large monitors the content column expands to 1440px so
  data-dense tables breathe instead of squeezing; vertical rhythm tightened.

This builds on the existing system (Inter type stack, shadow/motion tokens,
refined buttons/inputs/cards/dialogs, premium login) — everything now runs
through one consistent language.

---

# Update — July 2026 (round 18)

## Funded deals — pause payments
- Each funded deal can now be **paused**: tick "Pause payments" in the deal
  editor and the deal shows an amber **⏸ Paused + date** chip right on the
  row. You can also record a **temporary modified payment** — amount, until
  date, and a note (e.g. "half payments, hurricane") — shown as a chip too.

## Performance visibility
- The **dashboard and Funded Board are now scoped by role**: admins see the
  whole company, team leaders see their team's numbers, and every rep sees
  only their own performance (KPIs, deltas, and the 6-month chart included).

## Active Deals — offers
- Offer term is **days/weeks only** (months removed).
- Every offer has a **Funder picker** (add form + editable on each offer),
  and the funder's name now leads the offer summary on the row.
- Adding/editing/deleting an offer **updates the row summary instantly**.
- The expanded view is **half the height**: merchant info (deal name, first/
  last, cell, email) compact on the LEFT, offers on the RIGHT.

## Funders
- **Clicking a funder now opens the quick view** (contacts + key criteria).
  The full editor is behind an explicit **Edit** button — on the row and
  inside the quick view.
- The restricted-states picker now uses **your states from Settings** (when
  you've defined them); industries already sync. Credit/revenue/positions/
  deal types from Settings already drive the Shop & Submit form.

## Send Application — now a link, not an API
- Reworked per your spec: enter a name + email → they get an email FROM YOU
  (your connected sending account + signature) with subject
  **"<Your company> Application"** and a body of
  "Hi <first name>, here is a link to our application. Please complete it
  ASAP so I can get working on your file now." + **your application link**.
- The saved body is editable in **Settings → Application link** (plus the
  link itself); reps can add a personal note per send. No Dropbox Sign
  account needed.

## Settings
- The settings **nav and the open panel scroll independently** on desktop.
- **Email swap**: change any user's email in Settings → Reps & admins →
  Email field — password, permissions, deals, commissions all stay; only
  the login email changes. (Works for reps and company admins.)

## Merchant Funding Estimator
- Friendlier flow: **step 1 "What you see on the statement"** (two numbers)
  and **step 2 "Fine-tune (optional)"**, plus a clear starting hint on the
  results side before you've typed anything.

---

# Update — July 2026 (round 17)

## Notifications — real desktop + phone push
- Notifications are now delivered as **real OS notifications on your
  computer and phone**, even when the app tab is closed. Click the bell →
  "Enable desktop alerts" once per device. (iPhone: add the site to your
  home screen first — Apple requires that for web push.)
- **More triggers**: you now get notified for **new offers** on your deals,
  **task assignments**, **submission status changes** (funder approved/
  declined), deal updates, and funded approvals — always to the rep AND
  their team leader.
- The bell dropdown no longer opens off-screen from the sidebar.

## Live auto-refresh everywhere
- Active Deals, Submissions, Funded Deals, Funded Board, Syndication, and
  Bonuses now **refresh themselves in the background** (~30–45s) so
  everyone sees everyone's changes without reloading. Refresh pauses while
  you're typing or editing a row — it never wipes what you're entering.

## Send Application — Dropbox Sign integration (new tab)
- New **Send Application** page: type a name + email → Dropbox Sign emails
  them your application template for signature. Recent sends listed below.
- Admin setup in **Settings → E-sign applications**: paste your Dropbox
  Sign API key (stored encrypted), the template ID, and the template's
  signer role name. Test mode toggle included.

## Fixes
- **Saved email signature now shows** when you open the signature editor
  (a loading race left the box blank even though a signature was saved).
- **Active Deals**: the Offer column now shows ALL logged offers before
  expanding (★ = accepted, [RC] = reverse consolidation), and the CSV
  export includes an "All Offers (full details)" column.

---

# Update — July 2026 (round 16)

## Syndication
- **Available amount**: when posting a deal, set how much is open for
  syndication — a **dollar amount or a percent** of the funding (toggle $/%).
  Entries are **capped**: once it's filled, the deal shows "Full" and no one
  can over-commit (you get "Only $X still available" if you try).
- **Collapsed by default**: each deal is a slim row (name, funding,
  available, committed) that **expands** for the full terms, entries, and
  the add-me-in form.
- **Compact entries**: company and amount sit side by side on one tight line
  (rep name in small text), with a total row.
- **Copy**: one line per entry — `Company $Amount`. No dashes.
- **Early payoff** field now just says "Early payoff" — tick it and it says
  "Yes — describe below" with the details box.

## Reverse consolidation marking
- **Offers** (Active Deals → offers): each offer has a **Reverse
  consolidation** checkbox (and shows a violet RC badge). Toggleable on
  existing offers too.
- **Funded Deals**: the deal editor now has a **Deal type** selector
  (Standard MCA / Reverse consolidation) — marking it RC switches the deal's
  commission to the draw-based treatment.

---

# Update — July 2026 (round 15) — refinements

## Syndication
- **No more expanding rows** — every deal is a card with all terms visible
  up front (funding, term, rate, commission, fee, early payoff, funder,
  position, committed %) plus a progress bar toward the funding amount.
- **Dollar amounts add commas as you type** (posting a deal and putting your
  amount in).
- **Rep directory**: pick your name from a saved list and your company
  auto-fills — just type the amount and "Add me in". New names typed once
  are saved to the directory automatically.
- **Copy** now copies ONLY the syndication lines: each rep's **company and
  amount** (one per line). Nothing else.

## Sidebar consolidation
- **My account** and **Companies** no longer take up sidebar spots — both
  live under **Settings** now. Admins: Settings → "My account" tab (top) and
  Settings → "Companies" (platform owner only). Reps: their Settings entry
  opens their personal account settings directly.

## CC everywhere: the + button
- Shop & Submit "Additional CC" and My Account "Always CC" now use a **+
  button**: type an email, press + (or Enter), it chips below. No commas.

## Other fixes you asked for
- **Credit dropdown** now runs **low → high** (Below 600 first, Above 700
  last).
- **Calculator (daily)**: term now goes up to **360 business days**.
- **Active Deals CSV export** now includes the **offer** (amount + notes).
- **Funded Deals analytics follow the rep filter** — pick a rep and the
  totals, status pie, and monthly volume chart show just their book; "All"
  still shows the whole company.

---

# Update — July 2026 (round 14) — structural upgrade

**Data preservation:** every change in this round is ADDITIVE. New features
get their own new tables (syndication, bonuses, notifications, approvals);
no existing table, column, or row is modified or deleted. All your deals,
submissions, commissions, funders, users, and settings are untouched.

## Syndication (new sidebar tab)
- A shared board where deals open for syndication are posted with full terms:
  deal name, funding amount, term, rate, commission, fee, early payoff
  (+details), funder, position #, and notes.
- Reps put their **name, company, and the amount** they want to syndicate.
- **Copy** button on every deal copies the whole capture — terms + every
  rep's entry + total committed — ready to paste anywhere.
- Poster/admin can close or reopen a deal; totals and % committed shown live.

## Bonuses (new sidebar tab)
- Post which **funders are running bonuses**: the bonus, the conditions to
  qualify, and either a start/end window or "running" (ongoing).
- Everyone sees the board with clear Active / Upcoming / Ended / Running
  status; admins add and edit.

## Notifications (bell + your actual screen)
- A **bell** now lives in the sidebar (and mobile top bar). When a deal
  assigned to a rep is updated, **the rep AND their team leader** get a
  notification saying **exactly what changed** (status, offer, funder, etc.).
- Click "Enable desktop alerts" once and updates also pop up as **real
  browser notifications on your screen**, even when you're in another tab.

## Funded email → admin approval
- Sending a funded email now **automatically submits it for approval** to
  log as a funded deal — nothing is logged until an **admin approves**.
- Admins see a queue at the top of Funded Deals; they can **modify every
  detail** (deal, rep, amount, rate, funder, gross commission, split %)
  before approving. Approving marks the deal funded, assigns the rep, and
  **creates the rep's commission** in one shot. Rep gets notified.

## Submit flow
- Deal details/notes are captured **only on the deal** now — they no longer
  copy into the submission's notes/offer field (that field is reserved for
  logging the funder's offer).
- **Multiple CCs** on Shop & Submit: press Enter/comma after each address, or
  paste a whole comma-separated list — every address becomes a chip.

## Screens
- **Active Deals** is now a clean line-per-deal table: Date · Rep · Deal
  name · Cell · Email · Funder · Offer (+ status + expand for full editing).
- **Funded Board**: filter by **any specific month** (dropdown), on top of
  the This Month / This Week / All Time chips.
- **Calculator (Merchant Funding Estimator)**: term now displays in
  **business days when Daily** is selected (weeks when Weekly), and the
  "Likely MCA structures" panel is **collapsed by default** with the best
  match summarized — expand to see the full ranked list.

## Premium feel
- The **dashboard is now an analytics home**: every KPI shows its
  month-over-month change, plus a **6-month funded-volume chart** with
  amounts on each bar.
- Subtle brand-tinted depth added across pages (inherits each company's
  color).

---

# Update — July 2026 (round 13)

## Deal details are captured again on submit (for re-shopping)
- When you submit a deal, the **deal details** you enter in the submission
  intake (open balances, prior history, recent fundings, and your notes) are
  now **saved onto the deal** — even the first time you shop a brand-new deal.
  Previously this only saved for deals that already existed, so a fresh deal's
  details weren't captured. Now when you re-shop it to more funders, everything
  pre-fills.
- Your **offer notes stay separate** — the intake details are stored as the
  deal's captured submission details, not mixed into your offer notes.

## No more parentheses in the submission email
- The intake summary in the outgoing email no longer uses parentheses or
  placeholder text. Empty fields are simply left out, and rate/term now read
  plainly (e.g. "ABC funded $50,000 at 1.4 / 6 months on 2026-01-15") instead
  of being wrapped in "( )".

---

# Update — July 2026 (round 12) — THE data-loss fix

## Root cause found (this is the one that actually wiped data)
Your Replit run command is `npm run setup && npm start`. The **setup script**
was running **`drizzle-kit push --force`** on boot — a command that force-
rewrites the database to match the code and **can drop tables/columns and wipe
data with no prompt** — followed by re-seeding the default "Cortada" data.

It was supposed to run only once (guarded by a `.setup-complete` marker file),
but **when you upload a new zip and delete the old files, you delete that
marker** — so the destructive push + reseed ran again on the next boot. That's
why data vanished, the app "went back to Cortada," and everyone was locked out.

## The fix — setup can no longer touch an existing database
- Setup now **asks the database whether it already has data** before doing
  anything. If the database already exists, it **skips the schema push and the
  seed entirely** and leaves your data completely untouched. The destructive
  first-time path now runs **only against a brand-new, empty database**.
- Removed `--force` from the `db:push` script so a forced, data-dropping push
  can't be triggered by accident.
- Schema changes for existing databases are handled the safe way: the app adds
  any new columns/tables **additively** at startup (never dropping anything),
  backed by the destructive-statement guard added last round.
- New uploads **no longer include `.replit`**, so an upload can never overwrite
  your Replit config or database connection.

## Security: rotate your database password
Your `.replit` had the Neon database password written in plain text inside the
repo. We removed it (the connection should live in **Replit → Secrets**, not in
a committed file). Because it was previously committed, please:
1. In **Neon**, reset the database password (rotate the credentials).
2. In **Replit → Tools → Secrets**, set `DATABASE_URL` to the new connection
   string. Remove any `DATABASE_URL` line from `.replit`.

## Where your data lives / how to never lose it again
- Your data lives in **Neon Postgres** (a real managed database) — that's the
  correct place for it. Keep using Neon.
- Turn on **Neon's Point-in-Time Restore / backups** (you already used this to
  recover — it's your strongest safety net; Neon can roll the database back to
  any moment in its retention window).
- Use the in-app **Settings → Data & backups** (added last round): daily
  automatic snapshots, one-click JSON/CSV export, and an optional emailed copy
  for an off-site backup you control.

---

# Update — July 2026 (round 11)

## Data safety + automatic backups
- **Updates never wipe data.** Schema changes are strictly add-only, and a
  built-in guard now **blocks any destructive database operation** (drop /
  truncate / delete / clear) from ever running at startup. Your users, deals,
  commissions, funders, submissions, and settings are preserved across every
  update. DATABASE_URL is never changed and no new database is created.
- **Automatic daily backups.** A full snapshot of your company's data is
  saved automatically once a day (kept as the most recent 14 restore points).
  Nothing is overwritten — it's an extra safety net.
- **Settings → Data & backups** (admins) now has:
  - **Back up now** — take a snapshot on demand.
  - **Backup history** — download any recent snapshot as a JSON file.
  - **Download full backup (JSON)** — one file with everything.
  - **Export to CSV** — one click per dataset (Deals, Commissions, Funders,
    Users, Submissions, Lead sources, Tasks) for Google Sheets / Excel.
  - **Email a copy** (optional) — each automatic backup is emailed to an
    address you set, for off-site safety (uses your connected sending email).
  - A toggle to turn automatic backups on/off.
- Backups **redact passwords and SMTP credentials** so a downloaded/emailed
  file can't leak secrets.

## Protecting your data on upload (important)
- The one thing that protects your data during a Replit upload is the
  **`.env`** file — it holds your database connection. **Never delete or
  replace `.env`** when uploading a new build. If data ever looks "gone"
  after an upload, it almost always means the connection changed, not that
  the data was deleted — don't re-enter anything; the original data is still
  in your database.

---

# Update — July 2026 (round 10)

## IMPORTANT — fixes the "everyone locked out / tab says Cortada" problem
- Root cause: when a code upload failed to **build** on Replit (a hand-written
  TypeScript type not matching the database), Replit kept serving the old
  code — which looked like everyone being locked out and the browser tab
  reverting to "Cortada".
- Fixed the three specific type mismatches that kept recurring
  (Active Deals, Tasks, Funded Deals pages).
- Added a permanent guard so a type/lint nit can **never again fail the build
  and take the app offline** — uploads now always build and deploy. (This is
  why you kept having to fix things in Replit by hand; you won't anymore.)
- **After you upload this zip and republish, logins and per-company tab names
  come back to normal.**

## Always CC — multiple addresses
- My Account → **Always CC** now takes **more than one email**. Type an
  address and press **Enter, comma, or semicolon** to turn it into a chip;
  add as many as you like, and click the **×** on any chip to remove it.
- Every address you list is automatically CC'd on the deals you submit.
  (Still your own setting — it never applies to emails someone else sends.)

## Mobile layout
- Fixed sideways-scrolling / cramped screens on phones:
  - Page action buttons now **wrap** onto the next line instead of running
    off the edge.
  - Wide tables (e.g. Funders) **scroll horizontally on their own** instead
    of stretching the whole page.
  - Added a global guard so a stray wide element can never drag the entire
    page into a horizontal scroll.

---

# Update — July 2026 (round 9)

## Reverse consolidation commissions (draw-based)
- When you Move a deal to funded, pick **Deal type: Reverse consolidation**.
- That deal's broker commission is treated as **paid over time**: it stays
  **pending** and shows a panel with **Paid $X of $Y**, **Remaining $Z**, and
  a progress bar — it doesn't get paid upfront.
- Each week when the broker draws against it, log a payment on that deal's
  commission (Log payment). Paid goes up, Remaining goes down, and it stays
  pending until it's fully drawn. Example: $10K total, log a $1K draw →
  shows Paid $1,000 / Remaining $9,000, still pending.

## Login
- Fixed the **show/hide password** eye on the sign-in screen (it could be
  blocked by focus-steal or a browser's own reveal icon).

---

# Update — July 2026 (round 8)

## Deal shop / intake
- Open balances now carry only **Funder + Balance** (rate/term removed).
- **State** dropdown lists only states that some funder actually restricts.
- Intake form is more **compact**.

## Branding
- Each company's **accent color** now applies throughout their app (not the
  owner's).
- The persistent search bar was removed from the dashboard; **⌘K** still
  works (and a search icon is in the mobile top bar).

## 2FA
- The account page now shows the **real** on/off state (was always saying
  "disabled" even when on).

## Reverse MCA calculator (upgraded engine)
- New engine searches funding × factor × fee × term to find the closest
  realistic MCA that reproduces your entered payment. Clean funding + common
  factors/fees/terms score higher; optional deposit is a sanity check.
- A **"Likely MCA structures"** panel shows the top 3–6 scenarios — each with
  funding, factor, fee $, net to merchant, total payback, term, payment,
  # payments, and how far its payment is from what you entered — plus a
  confidence label (Very likely / Strong / Possible / Low) and a plain-English
  "why this pick." The existing sliders/flow are unchanged.

## Funded email
- Optionally **attach a deal** (prefills recipient + fields) and **pick a rep**.
- After sending, it **asks** whether to log it as a funded deal (never
  automatic) — marks the deal funded + assigns the rep, then opens Funded
  Deals to fill in anything missing.
- (Lead-source filtering by commission already lives on the Commissions page.)

## Bulk import
- **Funded Deals** and **Commissions** now have **Bulk import**: download a
  simple CSV template, upload, see a **preview** of exactly what will be
  created (headers auto-map; reps match by name/email; commissions match to
  deals by name), then **Confirm** to commit. Unmatched/invalid rows are
  flagged and skipped.

---

# Update — July 2026 (round 7) — UX & polish

## Confirmations
- Every "are you sure?" now appears as a **centered dialog** (or a toast for
  errors) — nothing pops at the top of the browser anymore. Covers deletes
  and confirms across the whole app.

## Mobile
- The side menu is now **solid white** (was see-through and hard to read).
- Smoother transitions; reduced-motion is respected.

## Logos
- Logos now show reliably: if a company hasn't uploaded one (or it fails to
  load), a clean **lettermark** (their initial on the brand color) shows
  instead of a broken image.

## Search
- The search opens as a **side-docked panel** flush to the sidebar, not a
  box in the middle of the screen.

## Names & forms
- First/last names are auto-capitalized (John, not john / JOHN) everywhere
  they're saved. Emails are left exactly as typed.
- **Clear all** button added to the Funded Email form (Shop & Submit already
  had one).

## Feel
- Smooth in-page scrolling and subtle, consistent button/press animations
  for a more premium feel.

---

# Update — July 2026 (round 6)

## Global search
- A **Search box** at the top of the sidebar (or press **⌘K / Ctrl-K**
  anywhere) searches across deals, funders, people, and lead sources.
  Results are scoped to what you're allowed to see, grouped by type, and
  keyboard-navigable — Enter jumps straight to the item.

## Teams
- You already create teams + team leaders + reps under the **Tasks** tab
  ("Teams" button, admin only).
- **Team leaders now see their reps' deals and submissions** across
  Active Deals and Submissions — but **not commissions** (each rep's pay
  stays private to them and admins). Reassigning deals stays admin-only.

---

# Update — July 2026 (round 5)

- Browser tab shows each company's own name after login.

---

# Update — July 2026 (round 4)

## Security (important)
- **Password reset now actually sends.** Same root cause as the 2FA
  lockout — it only tried a system email service you don't have. All
  security emails (reset link, 2FA code, password-change code) now fall
  back to your connected SMTP (the account you send deals with), so they
  arrive. If nothing can send, the reset link is written to the server
  log as an operator backstop (never returned in the page, to stay safe).
- **Fixed a 2FA login bug + closed a login bypass.** The code that checked
  your 2FA code had a SQL bug that would reject every code; fixed. And the
  final login step now requires a one-time, single-use token proving the
  code was verified — a user ID alone can no longer create a session.

## Companies (master area)
- **Delete a company** — type-to-confirm; removes all its data. The owner
  company can't be deleted.
- **Manage any company's users** — a "Users" panel per company: add
  reps/admins, set role + permissions, reset a password (for lockouts),
  suspend, and **change who the admin is** (change a user's role to Admin).
  Guards stop you removing a company's last admin.
- **Lead source vs company admin**: emails are unique, so a person who is
  both uses two logins (two emails) that each open their own portal by
  role — no conflict.

## Charts (Funded Deals)
- Donut no longer bleeds one color into the next (clean gaps between
  segments).
- Monthly funding-volume bars now show the dollar amount above each bar.

## Submissions
- **Filter by month or all-time** (dropdown built from your data).

## Audit notes
- Industries / states / positions already use a single "Name" box (no
  separate value + label) — you'll see that once this build is live.
- Credit and revenue ranges keep a separate value because funders match
  against it, so renaming the label never breaks matching.

---

# Update — July 2026 (round 3)

## Sending
- **Live progress bar** — sending a deal now shows a 0→100% bar with
  "Sending 4 of 12" and the funder each email just went to.
- **~3× faster sends** — emails go out over 3 parallel connections
  instead of one at a time.
- **Re-shopping auto-CCs the rep** — shopping a deal to more funders
  when it's assigned to a rep and was already submitted once pre-checks
  the rep CC (still un-tickable).
- **"Clear all"** on Shop & Submit wipes the entire form — criteria,
  notes, intake, selections, attachments, and the saved draft.
- The post-send "stay here / view Submissions" prompt is still there
  after every fully-successful send.

## Security & accounts
- **2FA is now ON for every account automatically** (one-time switch —
  anyone can still turn theirs off in My Account). Safe because login
  proceeds without the code when no email service can deliver one.
- Password model confirmed: users change their own password in
  My Account (this replaces whatever they were given); you can always
  override it from Settings → user editor → "New password" if someone
  is locked out.

## Signature
- Logo upload removed — paste your signature with its logo straight
  from Gmail into the one editor. (A previously-uploaded logo still
  shows with a Remove button.)
- **"Send me a test email"** button — emails you a sample so you can
  verify exactly how your signature looks in a real inbox.

## Tasks
- **Assignment notifications** — brokers see a red badge with the count
  of their open tasks on the Tasks tab in the sidebar (refreshes every
  minute).

## Companies
- **Per-company feature access** — on the Companies page, each company
  row has an "Access" button: check/uncheck which features (tabs) that
  company can use. Unchecked tabs vanish for all their users.
- **New companies inherit your deal-profile options** — credit ranges,
  revenue ranges, industries, positions, and deal types copy from your
  setup (or from the company whose funder list you copy), so their
  dropdowns work day one.

---

# Update — July 2026 (round 2)

## Fixed in this round

- **2FA lockout** — verification codes now send through your own
  connected email account (the same SMTP you shop deals with) when no
  system email service is set up. And if NO email can be delivered at
  all, login proceeds with just your password instead of locking you
  out. Enabling 2FA now tells you exactly how codes will be delivered.
- **Email signature — one place, Gmail-style** — My Account → Email
  signature is now a rich editor: copy your signature inside Gmail,
  paste it in, and it shows fonts/colors/images exactly as they'll
  send. Logo upload and link live in the same card. The unused
  company-wide signature box in Settings is gone (it was never used
  when sending — that was the confusion). Also fixed the real bug where
  pasted HTML signatures were sent as visible code instead of formatted
  text.
- **Companies tab now visible to you** — your admin login now sees
  "Companies" in the sidebar's Admin section. From there you create a
  new company, set their admin login, and choose their funder list:
  start empty, copy YOUR list as their base, or platform defaults.
  Admins of client companies never get access to this.

---

# Update — July 2026 (round 1)

## How to apply this update on Replit

1. In Replit, delete the old code folders/files — but do **NOT** delete
   `.env` or `.replit` (those hold your secrets and Replit config).
2. Upload everything from this zip into the workspace root.
3. Republish the deployment.

The database updates itself automatically the first time the new code
starts (see "Self-healing database" below) — no migration commands needed.

## What's fixed

- **Submissions not sending** — root cause found: the code expected new
  database columns (added for 2FA) that the database never got, so every
  user lookup crashed, which broke login checks and email sending. The app
  now aligns the database with the code automatically on every startup, so
  this entire class of breakage is gone for future updates too.
- **Losing everything you typed on refresh** — the Shop & Submit form
  (deal name, notes, intake, funder selections, manual funders, CCs,
  match filters) now auto-saves as you type and restores after a refresh
  or a failed send. It clears itself only after a fully-successful send.
  (Attachments are the one thing browsers don't allow restoring.)
- **Whole page scrolling while browsing funders** — the funder results
  panel on Shop & Submit now scrolls independently; the intake form on
  the left stays put.

## What's new

- **Tasks + Teams** (new "Tasks" tab in the sidebar)
  - Admins create teams, check off members, and crown team leaders.
  - Tasks can be company-wide (everyone sees them) or assigned to a
    specific broker (visible to that broker, their team leader, and admins).
  - Status flow: Open → Handling (shows who claimed it) → Completed,
    with optional due dates and overdue highlighting.
- **Neutral login page** — no company branding before sign-in, so every
  company on the platform gets its own identity inside the app only.
- **Company creation: funder list choice** — when creating a new company
  you now choose: start empty, copy an existing company's funder list as
  their base, or platform defaults.
- **Simpler funder CSV import** — the default template is now just
  4 columns (name, submission_email, tiers, notes). Column names are
  flexible ("Funder", "Email", "Phone" etc. all work). The full template
  with every advanced column is still available in the import window.

## Already in place (verify after update)

- **Email 2FA** — turn it on per-user in My Account → Two-factor
  authentication. Login then requires a 6-digit emailed code.
- **Self-service password change** — My Account → Change password
  (verified by emailed code; nothing hard-coded).
- **Email signature** — paste your Gmail signature with its fonts
  (HTML preserved + sanitized), upload a logo, and set a link.

## Self-healing database

`src/lib/db/bootstrap.ts` runs at server boot and applies any missing
columns/tables (all statements are IF NOT EXISTS — safe to run every
start). When future updates add database fields, they're added there
too, so uploading a new zip can never break the running database again.
