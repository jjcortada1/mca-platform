# Update — August 2026 (round 32) — Underwriting reads PDF statements

## Drop in the bank's PDF, exactly as it comes
The Underwriting tab now reads **PDF statements directly** — the file the
merchant downloads from online banking, no conversion, no CSV export, no
copy-paste. Drag in all three months at once.

It still uses **no AI credits**, and the PDF is still **never uploaded**:
the text is pulled out of the file in your browser and analyzed there.

### What it handles
- **Multi-page statements.** Pages are read in order and stitched together,
  including rows that continue across a page break.
- **Statements with no minus signs.** Most banks never print one — they
  group rows under **"Deposits and Additions"** and **"Electronic
  Withdrawals"** and let the heading carry the meaning. The reader now
  follows those headings, so withdrawals are never mistaken for revenue.
  Dozens of heading variations are recognized (Checks Paid, ATM & Debit
  Card Withdrawals, Fees and Service Charges, Money In / Money Out, and so
  on).
- **Dates with no year.** PDF rows print "03/02", so the year is taken from
  the statement header ("March 01, 2026 through March 31, 2026"), and a
  statement that crosses New Year rolls the year forward correctly.
- **A running balance as a cross-check.** When the statement carries a
  balance column, every deposit/withdrawal direction is verified against
  how the balance actually moved, and any that disagree are corrected. If
  that happens you get a note saying how many.
- **Tight columns.** When a long description runs flush into the amount
  with no gap, the amount is still read correctly.
- **Two dates per row** (posted date and effective date) — common on
  business checking statements.
- **Subtotal lines ignored**, so "Total Deposits and Additions" is never
  counted as a transaction.

### What it can't read
**Scanned or photographed statements.** A scan is a picture of a page with
no text inside it — there is nothing to extract. You get a clear message
saying so rather than a wrong answer. Ask the merchant for the statement
downloaded straight from online banking. Password-protected PDFs also need
the password removed first, and the message says that too.

CSV is still supported and is marginally better when you have it, since a
CSV export always carries a running balance. The paste tab is still there
as a last resort for an unusual layout.

## Under the hood
- Added `pdfjs-dist` (Mozilla's PDF engine, the one Firefox itself uses) —
  **run `npm install` after unzipping** to pull it in. It loads only when
  you actually drop in a PDF, and it falls back to a main-thread parse if
  the background worker can't start, so it works regardless of hosting
  setup.
- The regression suite (`npm run test:underwriting`) now builds real
  multi-page PDFs in two different bank layouts — one signed only by
  section headings, one with a running balance and no sections — extracts
  them, and checks the scrub reaches the right answer on both: correct
  deposit/withdrawal split, positions found, payroll not flagged as an
  advance, NSF counted, and the statement year inferred.

---

# Update — August 2026 (round 31) — Underwriting tab (bank-statement MCA scrub) + a build-breaking bug found and fixed

## NEW: Underwriting (sidebar → Workflow, right under Shop & Submit)
Drop in bank statements and get an instant underwriting read on the deal.

**It runs on plain code, not AI.** You asked for it not to burn live AI
credits, so there is no API call anywhere in it — the whole thing is a
funder-name dictionary, recurring-payment math, and a fixed rule set. Same
statements always produce the same answer, and an underwriter can re-derive
every number by hand.

**The statements never leave the computer.** The file is read in the
browser, analyzed in the browser, and thrown away when the tab closes.
Nothing is uploaded, nothing is written to the database, no deal record is
touched.

### What it tells you
- **Existing MCAs.** Finds stacked positions two ways: by matching the bank
  descriptor against a dictionary of ~110 known funders (Rapid, OnDeck,
  Fora, Kapitus, Credibly, Everest, Libertas, Bitty, Fox, and so on), and
  by spotting the shape of an advance — a fixed amount debiting every
  business day or every week. Payroll, rent, insurance, taxes, cards,
  software, and fuel cards are on an exclusion list so they never get
  mistaken for a position.
- **Each position broken down**: funder, payment amount, cadence, number of
  debits, first and last date, per-day and per-month burden, and a
  confidence level with the exact reasons it was flagged (click any row to
  expand).
- **Estimated original advance, factor, term, and payback** — reverse-solved
  from the payment using the same engine as the Reverse Calculator. When a
  funding deposit from that funder lands inside the statement window, the
  real number replaces the estimate and the remaining balance becomes exact.
- **Cash flow**: deposits, deposit count, "true revenue" (deposits minus
  transfers, refunds, and advance proceeds), withdrawals, and net — month by
  month, with a chart.
- **Bank behavior**: NSF and overdraft items, negative days, lowest balance,
  and average daily balance (weighted by days actually covered).
- **The underwriting box**: eight standard checks scored pass / watch / fail
  against the usual benchmarks.
- **A graded verdict** (A through Decline, 0–100) with the specific red
  flags and strengths behind it — never just a number with no reasoning.
- **Room for new money**: a conservative estimate of what the file supports,
  computed from revenue, the grade's holdback ceiling, and the existing
  payments already coming out. It says $0 and explains why when the merchant
  is tapped out.

### Getting statements in
- **Upload** the transaction export from the merchant's online banking —
  `.csv`, `.xlsx`, `.xls`, `.tsv`, or `.txt`. Load all three months at once;
  overlapping periods are de-duplicated automatically.
- **Paste from PDF** if that's all you have — paste the transaction lines
  and it reads date, description, amount, and running balance off each line.
- Columns are detected automatically (including split debit/credit columns,
  and files where every amount is positive — direction is then worked out
  from the running balance). If a bank's format is unusual, the file shows a
  **map the columns manually** control instead of failing.
- **Copy summary** and **Download report** produce a clean text scrub you can
  drop straight into an email to a funder or into the deal notes.

## FIXED: the app could not build
While type-checking the new work, the whole project turned out to be
**syntactically broken** — `src/components/sidebar.tsx` was missing a closing
brace on the nav-section loop, introduced back on July 9 with the
collapsible-sidebar-sections change. TypeScript stopped parsing at that
point, which means every build since then would have failed. One brace,
fixed, and the project parses clean again. Nothing about how the sidebar
behaves changed.

## Also
- `npm run test:underwriting` — a regression suite that builds synthetic
  statements with known answers and checks the scrub reproduces them:
  positions found, ordinary recurring bills NOT flagged as advances, cadence
  and payment amounts correct, NSF counting, the paste parser, the
  balance-inferred direction logic, and duplicate merging.
- Nothing existing was touched: no schema change, no API change, no
  permission change, no calculation change. The Underwriting tab uses the
  same permission as Shop & Submit and obeys the sidebar order/visibility
  settings like every other tab.

---

# Update — August 2026 (round 30) — Light theme, permanently

## The system is LIGHT now — everywhere, for everyone
- The app renders in the **light theme only**: clean white surfaces with the
  dark-navy monochrome buttons and accents. No toggle, no stored
  preference, no dark mode.
- Native controls (scrollbars, date pickers, dropdowns) are also locked to
  light so they can't render dark on computers set to OS dark mode.
- Everything from the recent rounds carries over unchanged — the icon rail
  (with the expand-to-wide option), monochrome buttons, unique icons,
  Funder Intel, storage usage, silent refreshes, and all fixes.

---

# Update — August 2026 (round 29) — Funder Intel, storage usage, single dark theme, and the audit's Phase 1 fixes

## NEW: Funder Intel (sidebar → Resources)
- A full analytics section for funder performance, **built automatically
  from data you already have** — nothing extra to type: submissions sent /
  approved / declined per funder, approval rate, offers made with average
  offer size and factor, **deals won and funded volume**, and win rate.
- Ranked by wins with a volume bar per funder, a "top funder" callout,
  period filters (30 days / 90 days / 12 months / all time), and an
  active-only toggle. Requires the same permission as the Funders tab.

## NEW: Storage usage (Settings → Backup → Storage usage)
- See how many **MB/GB of database storage each company uses** and the
  total. Per-company bars, record counts, and an expandable breakdown of
  each company's largest tables. Company admins see their own company; as
  the platform owner you see every company plus the true database total.

## Dark/light switcher removed
- The app is now **one theme: the dark command center**, always. The
  toggle is gone from the rail, wide sidebar, and mobile bar, and no
  preference is stored. (If you ever want light-only instead, it's a
  one-line flip — say the word.)

## Audit Phase 1 — five of the six critical findings fixed
- **Commission double-booking fixed**: approving a funded email now checks
  for an existing commission on the deal and never books a second one (the
  admin sees a note instead), and an unlinked approval attaches to an
  existing funded deal with the same name rather than creating a duplicate.
- **Commissions page dark-theme bug fixed**: invalid CSS variable usage
  made table headers invisible and selects borderless — now valid.
- **Calculator commission drift fixed**: the Deal Calculator now uses the
  same shared commission engine as the server (proper rounding guard, 12%
  cap, and defaults if the rules fetch fails — no more silent 0%).
- **Crash guard**: an API error can no longer white-screen Active Deals or
  Funders.
- **Error-message leak closed**: the secondary API error handler no longer
  echoes raw internal error text on server errors.
- (The sixth finding — pointing the dashboard at deals instead of the
  manual board — is deliberately deferred to Phase 2, since changing where
  those numbers come from deserves its own careful round.)

## Structure & cleanup from the audit
- **Unique sidebar icons**: Funded Board now has a trophy, Payments a
  banknote, Accounting a receipt, Reverse Consolidation layers — no more
  three-items-one-icon guessing.
- Dashboard quick actions fixed: one "Shop & submit" tile linking straight
  to the page (no more redirect flash through a retired route) + a Funder
  Intel shortcut.
- Deleted verified dead code: the unmounted global search + its API route,
  the retired redirect-to-a-redirect stub, orphaned calculator API routes,
  and the dead refinance hand-off block (~500 lines gone). `/submit` is now
  a server-side redirect for old bookmarks (no flash).

## Doc Request
- (From the previous round) "Is this a refi?" toggle — Yes makes the
  message open with "Send refi docs for $X".

---

# Update — July 2026 (round 28) — Doc Request refi option + full system audit delivered

## Doc Request — refi toggle
- New **"Is this a refi?"** Yes/No toggle at the top of the form. Choosing
  Yes changes the generated message to open with **"Send refi docs for $X"**
  instead of "Send docs for $X".

## Full system audit — three independent passes, all findings verified
- A consultant-style audit of all 28 pages, 100+ API routes, and shared
  libraries is delivered as a styled report (shared separately) and a
  condensed copy in the repo: **AUDIT-2026-07.md**.
- Headlines: **6 critical bugs** (including a commission double-booking path
  and a dashboard reading two conflicting funded sources), the **funded
  workflow requiring up to 4 manual entries per deal**, ~300 light-only
  color classes breaking on the dark theme, ~700+ lines of verified dead
  code, and a phased fix plan. The security/data core passed.
- No fixes from the audit were applied yet — the report is the deliverable;
  fixes proceed per the phased plan on approval.

---

# Update — July 2026 (round 27) — Invisible background refreshes: the blinking is fixed at the source

## What was actually causing the blinking (traced, not guessed)
- **Timed skeleton swaps** — Submissions, Active Deals, and Funded Board
  flipped their page-level loading flag on every background refresh (every
  30–45s), swapping the entire table for a loading skeleton and back. That
  was THE periodic flash, and it also collapsed the page height (scroll
  jumps). Commissions and Funders did the same thing after every save.
- **A real full-page reload** — approving a funded deal ran a browser
  reload of the whole Funded Deals page (white flash + scroll reset).
- **Duplicate polling** — the new shell fetched the sidebar config and
  polled open tasks twice (rail + mobile drawer), doubling those API calls
  on a timer.

## The fixes
- **Silent refresh everywhere**: background refreshes and post-save reloads
  keep the existing content on screen and replace only the data once the
  new request succeeds. Loading skeletons now appear ONLY the first time a
  page loads. Applied to Submissions, Active Deals, Funded Board,
  Commissions, Funders, and the syndications panel on funded deals.
- **No more full reloads**: approving a funded deal updates the list in
  place — scroll position, filters, and expanded rows stay put.
- **One poll for the shell**: sidebar config + task-badge polling now runs
  exactly once, shared by the rail and the mobile drawer.
- Already-safe behaviors confirmed while tracing: refreshes only tick on
  visible tabs, skip while you're typing, pause while a row is expanded or
  a form is open, and worksheets never let a background sync overwrite
  unsaved cell edits.

## Regression tests (run with `npm run test:stability`)
- A plain-Node test suite now enforces the anti-blink rules on the source
  itself and fails the moment a change reintroduces them: no browser
  reloads in the app, no page-level loading flips on auto-refresh pages,
  the visible-tab + not-typing guards stay in the refresh hook, the shell
  polls once, and the worksheets dirty-edit guard stays intact. (It caught
  two leftover violations during this very fix — then passed clean.)
- Honest scope note: these are source-level invariants, not browser
  recordings — visually confirming "no blink" end-to-end needs a real
  browser harness the Replit deploy doesn't run. The 5-minute manual check:
  sit on Active Deals for a minute (no flash), save a commission (table
  stays), approve a funded deal (no reload), edit a deal while the refresh
  timer passes (form intact).

---

# Update — July 2026 (round 26) — Rail polish: expandable sidebar, monochrome palette, drag-only reordering, modern icons

## Sidebar — expand it back whenever you want
- The icon rail now has an **expand button** (right under your logo) that
  brings back the classic wide sidebar with full labels; a collapse button
  up top shrinks it back to the rail. Your choice sticks per browser.

## Consistent black & white — brand colors removed
- Per-company accent colors are **gone**: buttons, links, rings, and active
  states are consistent **monochrome** — near-black on white in light mode,
  white on dark in dark mode. The color picker was removed from Settings →
  Branding (logo and names still apply). Status colors (green/amber/red)
  stay semantic.

## Modern icons + drag-only reordering
- Every dated text glyph (▲▼ arrows, ✎, ✕, ★, ⏸, ↻) is replaced with the
  crisp icon set used everywhere else.
- **Wherever drag exists, the arrows are gone**: funder tiers, sidebar
  items, and now sidebar **sections** (drag the header) and **worksheet
  columns** all reorder by grip-drag only.

## Global search removed
- The system-wide search (⌘K palette and its buttons) has been removed per
  request. Each page keeps its own local search and filters.

## Funded email — type OR pick the rep
- The Rep field is a type-ahead: **pick from your reps or type any name**.
  Typing a name that matches a rep links them; any other name goes into the
  email exactly as written. Nothing is ever forced, and your typed text is
  never overwritten.

## Reverse consolidation — one page, guaranteed
- The PDF now **scales itself** (progressive densify + whole-document zoom,
  requirements in two columns when long) so even a heavy sheet — 28+
  disbursements plus a long requirements list — lands on a single page.

## Shop & Submit — tier guide is actually visible now
- The Tier guide sits at the **top of the funder panel, open by default**
  (collapsible, remembered) — visible while filling the intake form, not
  buried behind a button inside results. Reminder: descriptions come from
  Settings → Funder tiers.
- The full Shop & Submit layout rebuild is Rebuild Round 2 — next.

## Dark mode toggle
- Stays at the bottom of the rail (and in the wide sidebar's footer +
  mobile top bar), as requested.

---

# Update — July 2026 (round 25) — REBUILD ROUND 1: dark command-center shell + icon rail, plus the five mini fixes

## THE NEW SHELL (Rebuild Round 1 of the authorized teardown)
- **Dark command-center is now the default look.** Layered dark surfaces,
  blue accent, ambient glow — the full premium dark theme that was already
  engineered is now ON by default. Anyone who prefers light clicks the
  **sun/moon toggle** (bottom of the rail on desktop, top bar on mobile)
  once and their choice sticks per browser.
- **The wide text sidebar is gone on desktop** — replaced by a **slim icon
  rail**: grouped glowing icons with flyout labels on hover, an accent
  indicator + glow on the active page, your logo on top, and search (⌘K),
  notifications, theme toggle, settings, and your account (hover for
  sign-out) at the bottom. Everything the old sidebar did — permissions,
  your custom order/renames/icons, feature access, hidden tools, the tasks
  badge — drives the rail through the exact same rules. Mobile keeps the
  full-label drawer.
- Next rebuild rounds put Shop & Submit and Active Deals on the new system
  as full page rebuilds.

## The five fixes you listed
- **Funded email — rep picker in the right place**: the template field
  labeled "Rep" (down in the Information section) is now a **dropdown of
  your reps**. Picking one fills the email line AND ties the funded-deal
  approval to that rep; it stays in sync with the deal you attach.
- **Funded Deals — business name shows**: the expanded view's "Business
  name" was always blank (it read a database column that never existed);
  it now shows the deal's business name. Pause payments, payment
  modification, amount collected (% paid in), and every funding detail
  remain editable under "Edit funding details".
- **Syndication — every rep sees every posted deal**: the board's APIs were
  already company-wide, but the sidebar tab was gated on a permission some
  reps' accounts lacked — so teammates never saw the board at all. The tab
  now shows for every non-lead-source user (admins can still disable
  syndication company-wide via enable/hide).
- **Shop & Submit — tier guide**: give each tier a description in
  Settings → Funder tiers (new field), and brokers get a **"Tier guide"**
  button on the results panel explaining what each tier means while they
  shop. (Bonus bug found here: tier renames had been silently failing due
  to an API method mismatch — fixed.)
- **Reverse consolidation — always one page**: the PDF auto-densifies
  (smaller type, tighter rows, up to 4 side-by-side schedule columns, print
  margins tuned) so the sheet never spills onto a second page.

---

# Update — July 2026 (round 24) — Reverse consolidation sheet v2, date filters, calculator revamp, drag-and-drop, sidebar controls, and the missed items

## Reverse Consolidation Sheet — reworked to your spec
- Title now reads **"Reverse Consolidation — {company name}"** (no more
  "Offer"), and the "Prepared by …" footer is gone.
- **Term can be daily or weekly** (toggle at the top of the Breakdown card);
  labels follow: **Current Daily/Weekly Payment** (shown in red) and **New
  Daily/Weekly Payment** (in green), with **Savings in green** — enter it as
  a **percentage or dollar amount** (%/$ toggle), or let it auto-compute
  from current vs new payment ("40% savings").
- **Disbursements are their own count**: enter how many there are (e.g. 28)
  — the term doesn't decide it — and that many rows open up with editable
  amounts (pre-split evenly from the funding). The date column says
  **Estimated date**.
- The printed schedule is **tightened into side-by-side columns** so the
  whole sheet — breakdown, positions, schedule, requirements — fits
  together on one page.

## Funded email — built-in MCA calculator (the missed item)
- The calculator now lives **inside the funded email workflow** too: as you
  type the funding amount, rate, and term into the template fields, the
  economics strip appears below them and **payback / payment fields
  auto-fill** with the computed numbers (with commas). The moment you type
  into an auto-filled field yourself, your value wins and stays.

## Date filters — Submissions + Active Deals
- Both toolbars get the standard date filter: **Today, Yesterday, This
  Week, Last Week, This Month, Last Month, Last 7 Days, Last 30 Days,
  Specific date, Custom range**. Submissions filter on the latest funder
  send date; Active Deals on the deal's created date (the Date column).

## Deal Calculator — compact rebuild
- The big top band (payment/day, total payback, net) is **removed**. One
  clean **Deal breakdown**: Funding Amount, Origination Fee, Term, Payment,
  Cost of Capital, Net, **Funding Fee (new input)**, Commission Percentage,
  Commission Dollar Amount. Inputs and results sit side by side in a
  contained column instead of stretching across the page. Cost of capital
  now correctly includes both fees (payback − net).

## Drag-and-drop reordering
- **Funder tiers** (Settings): drag the grip to reorder — arrows stay as a
  fallback.
- **Sidebar items** (Settings → Sidebar): drag items to reorder inside a
  section.
- **Worksheet tabs**: drag Sheet 2 before Sheet 1 — the order saves
  automatically (your own sheets; shared tabs stay grouped after).

## Sidebar — hide/show tools for YOUR company
- In Settings → Sidebar, every item now has an **eye toggle**: hide a tool
  and it disappears from the sidebar for everyone in your company; show it
  again anytime. This is separate from the platform-owner feature access —
  it's your own company's control. (Worksheets can't be hidden — sheets are
  shared across companies and hiding the tab strands invited users.)

## Send Application — delete + copy link
- Every recent application now stores **the exact link that was emailed**
  and shows a **copy button** for it.
- **Delete** any recent application record (with confirmation). You can
  delete records you sent; admins can delete any.

## Worksheets — copy buttons
- Expand any row and every field has a **one-press copy button** — copy
  that exact message/value without selecting text.

## Fonts — verified consistent
- Audited every font declaration: the platform already uses **one font
  (Inter) everywhere** — navigation, tables, forms, buttons, modals,
  dashboards, mobile — plus a single monospace companion for IDs/numbers.
  Nothing inconsistent was found; no change needed.

---

# Update — July 2026 (round 23) — Enterprise Round A: funded email safety, refinance, live deal math, smarter matching, reverse consolidation sheet

## Funded email — the merchant can never be emailed by accident
- **Fixed the recipient bug**: selecting a deal used to put the merchant's
  email straight into the To field. That auto-fill is gone completely.
- **Default recipients**: on Funded email → Contacts, **star any contact**
  to make them a default — their address pre-fills the To field on every
  funded email (multiple stars = multiple recipients).
- **Backstop guard**: if a recipient or CC matches the attached deal's
  merchant email, sending stops with an explicit "This would email the
  MERCHANT" confirmation.
- **Autofill mappings fixed**: "Merchant email" fields now get the email,
  "Merchant cell/phone" the phone, "First/Last name" the right name part,
  "Business/Company/DBA" the business name, and the generic merchant-name
  fields the full name. (Before, anything containing "merchant" got the
  name — including email and cell fields — and phone was never mapped.)
- The rep selector is labeled "On behalf of rep" and still auto-picks the
  deal's assigned rep.

## Refinance — logged from the funded deal, in place
- On Funded Deals, **Refinance…** now opens a form right there: merchant
  info carries over automatically (shown read-only), you enter ONLY the new
  funding details, with the payback/payment/net math computed live as you
  type.
- On save: a **new funded deal is created directly** (it never routes back
  through Active Deals), linked to the original; the **original stays in
  Funded Deals** marked Refinanced and treated as paid off through the
  refi (optional payoff amount recorded). The rep gets a notification.
- The new deal counts as a new funded deal, per your call.

## Live deal math everywhere funding details are entered
- New shared calculation engine: total payback, payment (per business day /
  per week), fee amount, net to merchant, cost of capital ($ and %), and
  commission $ **recompute instantly as you type** — in the Mark Funded
  modal, the Funded Deals editor, and the Refinance form. Dollar values
  format with commas and two decimals.

## Shop & Submit — matching and reliability
- Renamed **Deal Profile → Deal Intake Form** and **Positions → Open
  Positions**; dropdown placeholders say **Select** instead of Pick.
- **Matching starts from your first selection** — pick just Open Positions
  and funders filter immediately; every field you add refines the results.
  Unfilled fields are skipped (never treated as $0 revenue).
- **Open-positions rule confirmed and labeled**: merchant's open positions
  ≤ funder max = eligible (2 open vs max 2 qualifies; 3 vs 2 doesn't) —
  the reasons text now spells out the comparison.
- **Industry matching fixed**: deal industries and funder restrictions are
  now compared through a normalizer (case, spacing, plurals) plus an alias
  map (Trucking≡Transportation, Restaurants≡Restaurant, Medical≡Healthcare,
  Contractor≡Construction, and more) — stored values are never rewritten,
  so nothing breaks on existing deals.
- **Credit dropdown order**: Unknown first, then Below 600, then ascending.
- **Silent send failure fixed**: pressing Send with no funders selected
  used to do nothing; now it tells you exactly what's missing. Your form
  draft still survives failures for retry.
- **No more flashing**: match results stay on screen while a refresh is in
  flight, with a **centered "Matching funders…" indicator** over the panel
  instead of a note at the bottom.

## Funders — duplicate action removed
- The funder quick view had Edit at the top and "Edit full details" at the
  bottom opening the same editor. One Edit button now, in the header.

## NEW: Reverse Consolidation Sheet (sidebar → Resources)
- Build a client-facing offer for a weekly-disbursement consolidation:
  funding, payback, rate, term, weekly payment, savings — **each line can
  be shown or hidden** with the eye toggle; rate/payback/weekly payment
  auto-derive from what you enter.
- Add the **funders and balances** being consolidated (total computed), and
  generate the **week-by-week disbursement schedule** (funding ÷ term, last
  week absorbs rounding; every amount editable; pick the first date).
- **Requirements to Fund**: starts with driver's license + voided check,
  and **auto-adds "Contracts from X"** for every funder with a balance —
  add, edit, or remove any line.
- **Generate PDF** produces a clean branded document — your company name
  and uploaded logo on top — via the browser's print-to-PDF. A live
  preview shows the offer as you build it. Nothing is stored in the
  database; your draft is kept in the browser so refreshing doesn't lose it.
- Note: if your company uses the feature-access list (master settings),
  enable "Reverse Consolidation" there to show the tab.

---

# Update — July 2026 (round 22) — Enterprise round 1: Sheets behaviors, import, sidebar, security audit

## Worksheets — drag rows to reorder
- **Grab the grip icon** next to any row number and drag the row where you
  want it (row 50 → row 3, etc.). The custom order **saves automatically**
  and is what everyone the sheet is shared with sees. If the save fails you
  get a toast so you know it may reset.

## Worksheets — inline row expansion (replaces the pop-up)
- **Double-click a row** (or click the chevron by its number) and it now
  **expands directly beneath itself** — every column as a labeled field you
  can edit, wide text included. Click the X, the chevron, or double-click
  again to collapse it. No more pop-up dialog; you stay in the grid.

## Worksheets — import from Google Sheets / Excel / CSV
- New **Import** button on every sheet you can edit. Accepts `.xlsx`, `.xls`,
  `.csv`, `.tsv`, `.ods` — export your Google Sheet as Excel or CSV and drop
  it in.
- **Column mapping with preview**: file columns are auto-matched to your
  sheet's columns by name; unmatched ones default to "Add as new column"
  (owners) and you can remap or skip any column before importing. First five
  rows preview so you can sanity-check.
- Multi-tab files: **pick which tab** to import. Toggle whether the first
  row is column names or data.
- **Append or overwrite**: append adds below your existing rows (default,
  nothing touched); overwrite replaces this sheet's rows only — owner-only,
  with an explicit confirm, and it can never touch anything outside the one
  sheet. Row and column **order from the file is preserved** exactly.
- Limits for safety: 2,000 rows per import (split bigger files), 4,000
  characters per cell.

## Sidebar — collapsible sections that remember
- **Click any section header** (Workflow, Commissions, Sheets, Resources…)
  to collapse or expand it. Your choices are **remembered per browser**, so
  the nav opens exactly how you left it.
- A collapsed section still shows the page you're currently on, so you never
  lose your place.

## Security audit (backend, all 101 API routes) — 4 issues found, all fixed
- Swept every API endpoint for tenant isolation, ownership checks on
  mutations, and role/permission enforcement. **No cross-company data leaks
  found.** Four gaps were found and fixed in this update:
- **Deal offers are now rep-scoped** (was the one real issue): the offers
  endpoints only checked the company, so a rep who learned a teammate's deal
  id (they're visible on the syndication board) could read, add, edit, or
  delete that deal's offers. Offers now enforce the exact same rule as the
  deal itself — you must be the assigned rep, their team leader, or an admin.
- **Funded-board entries** now require the funded-board permission to post
  (before, any login — even a lead source — could post), and the rep on an
  entry is always validated as a member of your company.
- **Funded email sending** now requires the same submit permission and
  per-user rate limit as deal submissions (before, any authenticated user
  could trigger sends through SMTP).
- **Company SMTP details** (host/username) in shared-email mode are now
  returned only to admins; other users just see whether email is configured.
  Passwords were never exposed.
- Confirmed safe (spot highlights): reps can't see other reps' deals,
  submissions, or commissions; lead sources see only their own payout
  figures; team leaders see only their team; all admin endpoints check role
  server-side; backups strip password hashes and SMTP credentials; worksheet
  sharing grants access to the one shared sheet and nothing else.

---

# Update — July 2026 (round 21) — Worksheets fixes

## Saving is now bulletproof
- Cell edits **auto-save as you type** (about half a second after you stop),
  plus on blur and Enter. Saves always use the latest text — no more lost
  entries.
- If a save fails, you now **see an error toast** and your text stays on
  screen for retry (before, failures were silent).
- The background refresh **never runs while you have unsaved edits**, so it
  can't wipe what you're typing.
- Leaving the page flushes any pending edits on the way out.

## Double-click to expand
- **Double-click any cell** to open it in a large editor — read or edit the
  full value without scrolling sideways. Works for view-only users too
  (read-only view).

## Resizable columns
- **Drag the right edge of any column header** to resize it. On sheets you
  own, widths are saved and everyone sees your layout.

## Shared sheets — visibility fix
- A rep at another company who was shared a sheet could open it from the
  notification but then couldn't find it again: his company's feature-access
  list was hiding the Worksheets tab. Worksheets is a personal, cross-company
  feature, so it now **always shows in the sidebar** regardless of company
  feature access.

---

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
