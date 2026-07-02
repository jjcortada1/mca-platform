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
