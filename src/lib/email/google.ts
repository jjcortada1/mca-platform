/**
 * Google / Gmail integration.
 *
 * Talks to Google over plain HTTPS rather than pulling in the `googleapis`
 * package — the three endpoints needed here (token exchange, refresh,
 * messages.send) are small, and the SDK is a very large dependency for
 * that.
 *
 * Tokens are encrypted at rest with the same AES-256-GCM helper the SMTP
 * passwords already use, so a database dump never exposes a live mailbox.
 *
 * Scopes are requested incrementally:
 *   • gmail.send      — send as the user (mail lands in their real Sent)
 *   • gmail.readonly  — read for reply capture / inbox (stage 2)
 * gmail.readonly is a RESTRICTED scope. Google requires app verification
 * before an External OAuth app may use it; a Workspace-Internal app can
 * use it without verification but only for users in that same Workspace.
 * See docs/google-email-setup.md.
 */

import { encrypt, decrypt } from '@/lib/crypto';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';

/** Sending only — safe for an unverified External app. */
export const SCOPES_SEND = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
];

/** Adds read access, needed for reply capture and the inbox. Restricted. */
export const SCOPES_READ = [
  'https://www.googleapis.com/auth/gmail.readonly',
];

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function redirectUri(): string {
  const base = (process.env.NEXTAUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/api/email/google/callback`;
}

/**
 * Build the consent URL.
 *
 * `access_type=offline` + `prompt=consent` is what makes Google return a
 * refresh token. Without both, a reconnect returns only an access token
 * and the connection silently dies an hour later.
 */
export function buildAuthUrl(state: string, includeRead: boolean): string {
  const scopes = includeRead ? [...SCOPES_SEND, ...SCOPES_READ] : SCOPES_SEND;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
}

async function tokenRequest(body: Record<string, string>): Promise<GoogleTokens> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error_description || json.error || 'Google rejected the token request');
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (Number(json.expires_in) || 3600) * 1000),
    scope: json.scope ?? '',
  };
}

export async function exchangeCode(code: string): Promise<GoogleTokens> {
  return tokenRequest({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const t = await tokenRequest({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    grant_type: 'refresh_token',
  });
  // A refresh response omits the refresh token; keep the one we hold.
  return { ...t, refreshToken: t.refreshToken ?? refreshToken };
}

export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    // Revocation is best-effort — the row is deleted either way, so the
    // app forgets the mailbox even if Google is unreachable right now.
  }
}

/** Which Google account authorized us. */
export async function fetchProfile(accessToken: string): Promise<{ email: string; name: string | null }> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Could not read the Google profile for this account');
  const j = await res.json();
  return { email: j.email, name: j.name ?? null };
}

/* ───────────────────────── token storage ───────────────────────── */

export function encryptToken(token: string): string {
  return encrypt(token);
}

export function decryptToken(payload: string): string {
  return decrypt(payload);
}

/* ───────────────────────── sending ───────────────────────── */

export interface GmailSendInput {
  accessToken: string;
  from: string;          // "Name <a@b.com>"
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  /** Set to reply inside an existing thread. */
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

function encodeHeader(value: string): string {
  // RFC 2047 for anything outside ASCII, so accented names don't mangle.
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Build a MIME message. Multipart only when there is more than one part. */
export function buildMime(input: GmailSendInput): string {
  const boundaryAlt = `alt_${Math.random().toString(36).slice(2)}`;
  const boundaryMixed = `mix_${Math.random().toString(36).slice(2)}`;
  const hasAttachments = Boolean(input.attachments?.length);
  const hasHtml = Boolean(input.html);

  const headers: string[] = [
    `From: ${encodeHeader(input.from)}`,
    `To: ${input.to.join(', ')}`,
  ];
  if (input.cc?.length) headers.push(`Cc: ${input.cc.join(', ')}`);
  if (input.bcc?.length) headers.push(`Bcc: ${input.bcc.join(', ')}`);
  headers.push(`Subject: ${encodeHeader(input.subject)}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) headers.push(`References: ${input.references}`);
  headers.push('MIME-Version: 1.0');

  const body: string[] = [];

  const bodyPart = (): string => {
    if (!hasHtml) {
      return [
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(input.text, 'utf8').toString('base64'),
      ].join('\r\n');
    }
    return [
      `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
      '',
      `--${boundaryAlt}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(input.text, 'utf8').toString('base64'),
      '',
      `--${boundaryAlt}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(input.html ?? '', 'utf8').toString('base64'),
      '',
      `--${boundaryAlt}--`,
    ].join('\r\n');
  };

  if (!hasAttachments) {
    body.push(...headers, bodyPart());
  } else {
    body.push(
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundaryMixed}"`,
      '',
      `--${boundaryMixed}`,
      bodyPart(),
      '',
    );
    for (const a of input.attachments ?? []) {
      body.push(
        `--${boundaryMixed}`,
        `Content-Type: ${a.contentType || 'application/octet-stream'}; name="${a.filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${a.filename}"`,
        '',
        a.content.toString('base64'),
        '',
      );
    }
    body.push(`--${boundaryMixed}--`);
  }

  return body.join('\r\n');
}

/** base64url, which is what the Gmail API expects for a raw message. */
function toBase64Url(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface GmailSendResult {
  ok: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
}

/**
 * Send through the user's own mailbox.
 *
 * The practical win over SMTP: the message appears in their real Sent
 * folder and threads correctly when the funder replies, because Google
 * assigns it a thread.
 */
export async function sendViaGmail(input: GmailSendInput): Promise<GmailSendResult> {
  try {
    const raw = toBase64Url(buildMime(input));
    const res = await fetch(`${GMAIL_API}/users/me/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input.threadId ? { raw, threadId: input.threadId } : { raw }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: j?.error?.message || `Gmail rejected the send (${res.status})` };
    }
    return { ok: true, messageId: j.id, threadId: j.threadId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error talking to Gmail' };
  }
}

/** True when the granted scopes include read access. */
export function hasReadScope(scope: string): boolean {
  return scope.includes('gmail.readonly') || scope.includes('gmail.modify');
}
