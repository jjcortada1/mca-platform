# Connecting Gmail to Cortada

This lets Cortada send **as you** — mail lands in your real Gmail Sent
folder and threads correctly when a funder replies — and is the foundation
for reply capture and the in-app inbox.

Existing SMTP settings keep working. A user with no connected mailbox sends
exactly as before, so this can be rolled out one person at a time.

---

## 1. Create the Google Cloud OAuth client

1. Go to <https://console.cloud.google.com/> and create a project (or pick
   an existing one).
2. **APIs & Services → Library** → enable **Gmail API**.
3. **APIs & Services → OAuth consent screen**:
   - **User type**: choose **Internal** if everyone who will connect a
     mailbox is on your Google Workspace domain. Internal apps skip
     Google's verification review entirely — this is by far the easier
     path. Choose **External** only if reps outside your Workspace need to
     connect (see the warning in section 4).
   - Fill in app name, support email, and developer contact.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized redirect URI**: `https://YOUR-DOMAIN/api/email/google/callback`
     (must match exactly, including https and no trailing slash)
5. Copy the **Client ID** and **Client secret**.

## 2. Add the environment variables

In Replit → Secrets (or your `.env`):

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
```

Two variables that must already be set and are reused here:

```
NEXTAUTH_URL=https://YOUR-DOMAIN     # builds the OAuth redirect URI
ENCRYPTION_KEY=<64-char hex>         # encrypts the stored tokens
```

Restart the app after adding them.

## 3. Connect a mailbox

**My account → Connected email → Connect Gmail.** Google asks for
permission, then returns you to the account page. Once connected, that
user's outgoing mail can go through Gmail instead of SMTP.

Each user connects their own mailbox — Cortada never asks for anyone's
password, and access can be revoked at any time from
<https://myaccount.google.com/permissions> or the Disconnect button.

## 4. Read access (reply capture and the inbox)

Sending uses the `gmail.send` scope, which any OAuth app may request.

Reply capture and the in-app inbox need `gmail.readonly`, which Google
classifies as a **restricted scope**:

- **Internal Workspace app** — usable immediately, no review.
- **External app** — Google requires app verification, which includes a
  security assessment and can take weeks. Budget for this before promising
  the inbox to users outside your Workspace.

Use **Add read access** on a connected mailbox to re-consent with the
extra permission.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `redirect_uri_mismatch` | The URI in Google Cloud doesn't exactly match `NEXTAUTH_URL` + `/api/email/google/callback`. |
| "Reconnect needed" appears later | The user revoked access, the password changed, or `ENCRYPTION_KEY` was rotated. Click Reconnect. |
| "Google email isn't set up on this server" | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are missing or the app wasn't restarted. |
| Connection works then dies after an hour | Google returned no refresh token. Cortada always requests `access_type=offline` + `prompt=consent`; if this happens, disconnect and reconnect. |

## Security notes

- Access and refresh tokens are encrypted at rest (AES-256-GCM) with the
  same key used for SMTP passwords.
- The OAuth `state` is bound to both a one-time httpOnly cookie and the
  signed-in user id, so a mailbox can't be attached to someone else's
  account.
- Disconnecting revokes the grant at Google before deleting the row.
