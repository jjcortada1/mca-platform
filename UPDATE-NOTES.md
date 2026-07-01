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
