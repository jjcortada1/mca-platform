# Account Security — Change Password with 2-Step Email Verification

This adds proper, app-grade account security. Changing your password now works the way real apps do: confirm your current password, then enter a 6-digit code emailed to you before the change takes effect.

---

## What was built

### The flow (Settings → Security)
1. You enter your **current password** + **new password** (twice).
2. The system verifies your current password is correct.
3. It emails a **6-digit code** to your account email.
4. You enter the code.
5. Only then does the password actually change — and you get a "your password was changed" confirmation email.

If the code is wrong, you get 5 attempts. Codes expire in 10 minutes. You can resend a code. Nothing changes until the code is confirmed, so a half-finished attempt never leaves your account in a weird state.

### Security properties
- Current password required (can't change it from a hijacked-but-unlocked session without knowing the old password).
- New password is hashed immediately and stashed — never stored in plaintext while waiting for the code.
- The emailed code is stored only as a SHA-256 hash.
- Rate limited: 5 code requests / 10 min, 10 confirm attempts / 10 min.
- "New must differ from current" enforced.
- Confirmation email on success so you'd know instantly if someone else changed it.

---

## IMPORTANT: You must configure system email for codes to actually send

The verification code is sent using **platform-level SMTP** (separate from the per-funder SMTP you use to send deals). If you don't configure it, the flow still works but the code prints to the **server console** instead of emailing — fine for testing, not for real use.

### Set these in Replit Secrets (lock icon)

Using Gmail as the example (works well; use an **App Password**, not your normal password):

| Key | Value |
|---|---|
| `SYSTEM_SMTP_HOST` | `smtp.gmail.com` |
| `SYSTEM_SMTP_PORT` | `587` |
| `SYSTEM_SMTP_USER` | `youraddress@gmail.com` |
| `SYSTEM_SMTP_PASS` | your 16-char Gmail App Password |
| `SYSTEM_SMTP_FROM` | `Cortada Capital <youraddress@gmail.com>` (optional) |

**Getting a Gmail App Password:** Google Account → Security → 2-Step Verification (must be on) → App passwords → generate one for "Mail." Use that 16-character string as `SYSTEM_SMTP_PASS`.

Also make sure `NEXTAUTH_URL` is set to your real Repl URL (e.g. `https://your-repl.username.repl.co`) so the forgot-password reset links point to the right place.

After adding the secrets, click **Stop → Run**. No code change needed — the app reads them at runtime.

---

## Deploying this update

1. Upload `mca-platform.zip` (Files panel → ⋮ → Upload file)
2. In the Shell:
   ```bash
   unzip -o mca-platform.zip && cp -rf mca-platform/. . && rm -rf mca-platform mca-platform.zip && rm -f .setup-complete
   ```
3. Click **Stop → Run**

**Why `rm .setup-complete` this time:** there's a new database table (`verification_codes`), so the setup script needs to run `drizzle-kit push` to create it. Deleting the marker forces that. It's a **non-destructive, additive** change — your existing data (logins, funders, deals, everything) is untouched. The new table is created; nothing is dropped.

---

## About your hardcoded login — now you can fix it permanently

Once this is deployed and `SYSTEM_SMTP_*` is configured:

1. Log in with your current credentials.
2. Go to **Settings → Security**.
3. Change your password to something new and strong.
4. Confirm via the emailed code.

Your live password is now something only you know, set through the app — **not** the value baked into the seed file. Even though the seed file still contains the original default (used only when first creating the account on a brand-new database), your actual account password is whatever you set here, stored as a bcrypt hash in the database.

If you ever forget it: use **"Forgot password"** on the login page — it emails you a reset link (also via SYSTEM_SMTP, valid 1 hour).

---

## Files changed

| File | Change |
|---|---|
| `src/lib/db/schema.ts` | New `verification_codes` table |
| `src/lib/email/system.ts` | **New** — centralized system-email sender + code generator |
| `src/app/api/account/password/request/route.ts` | **New** — step 1: verify current pw, email code |
| `src/app/api/account/password/confirm/route.ts` | **New** — step 2: verify code, commit new pw |
| `src/app/(app)/settings/page.tsx` | New **Security** tab with the 2-step UI (now the default tab) |
| `src/app/api/auth/forgot-password/route.ts` | Refactored to use the shared system-email helper + rate limiting |

No schema data is lost. One new table added.

---

## Testing checklist

### Without SMTP configured (quick test)
- [ ] Settings → Security → enter current + new password → Send code
- [ ] Check the **Replit console** — you'll see `[DEV system-email] ... Your verification code: 123456`
- [ ] Enter that code → password changes → success toast
- [ ] Log out, log in with the NEW password → works
- [ ] Log in with the OLD password → rejected

### With SMTP configured (real)
- [ ] Add `SYSTEM_SMTP_*` secrets, restart
- [ ] Settings → Security → change password → code arrives in your **email inbox**
- [ ] Enter code → password changes → you also receive a "your password was changed" email
- [ ] Wrong code 5 times → locked, must restart
- [ ] Code after 10 minutes → "expired, start again"
- [ ] Forgot password on login page → reset link arrives by email

### Regression
- [ ] All other Settings tabs still load
- [ ] Login, deal shop, funders, active deals, funded board, calculator all work
- [ ] Sending deals to multiple funders still isolates each funder (from the prior hardening pass)
