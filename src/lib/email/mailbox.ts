/**
 * Connected-mailbox resolution and token upkeep.
 *
 * One job: hand callers a usable access token for a user's connected
 * mailbox, refreshing it when it has expired, and marking the row
 * `needs_reauth` when Google has revoked us so the UI can say so instead
 * of failing silently on every send.
 *
 * SMTP is untouched. A user with no connected mailbox keeps sending
 * exactly as before.
 */

import { db } from '@/lib/db/client';
import { emailAccounts } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  decryptToken, encryptToken, refreshAccessToken, hasReadScope,
} from './google';

export type MailboxRow = typeof emailAccounts.$inferSelect;

export interface ReadyMailbox {
  id: string;
  emailAddress: string;
  displayName: string | null;
  accessToken: string;
  canRead: boolean;
}

/** The user's active sending mailbox, if they have connected one. */
export async function getSendingMailbox(userId: string): Promise<MailboxRow | null> {
  const [row] = await db.select().from(emailAccounts)
    .where(and(
      eq(emailAccounts.userId, userId),
      eq(emailAccounts.sendEnabled, true),
      eq(emailAccounts.status, 'connected'),
    ))
    .limit(1);
  return row ?? null;
}

export async function listMailboxes(userId: string): Promise<MailboxRow[]> {
  return db.select().from(emailAccounts).where(eq(emailAccounts.userId, userId));
}

/**
 * Return a live access token, refreshing when it is within two minutes of
 * expiry. Returns null (and flags the row) when the refresh fails, which
 * is what happens after a user revokes access in their Google account.
 */
export async function ensureAccessToken(row: MailboxRow): Promise<ReadyMailbox | null> {
  const skewMs = 2 * 60 * 1000;
  const expired = !row.tokenExpiresAt || row.tokenExpiresAt.getTime() - skewMs <= Date.now();

  if (!expired) {
    try {
      return {
        id: row.id,
        emailAddress: row.emailAddress,
        displayName: row.displayName,
        accessToken: decryptToken(row.accessToken),
        canRead: hasReadScope(row.scope),
      };
    } catch {
      // Ciphertext we can't read (e.g. ENCRYPTION_KEY rotated) is the same
      // situation as a revoked grant: the user has to reconnect.
      await markNeedsReauth(row.id, 'Stored credentials could not be read — reconnect the mailbox.');
      return null;
    }
  }

  if (!row.refreshToken) {
    await markNeedsReauth(row.id, 'Google did not return a refresh token — reconnect the mailbox.');
    return null;
  }

  try {
    const fresh = await refreshAccessToken(decryptToken(row.refreshToken));
    await db.update(emailAccounts).set({
      accessToken: encryptToken(fresh.accessToken),
      refreshToken: encryptToken(fresh.refreshToken ?? decryptToken(row.refreshToken)),
      tokenExpiresAt: fresh.expiresAt,
      scope: fresh.scope || row.scope,
      status: 'connected',
      lastError: null,
      updatedAt: new Date(),
    }).where(eq(emailAccounts.id, row.id));

    return {
      id: row.id,
      emailAddress: row.emailAddress,
      displayName: row.displayName,
      accessToken: fresh.accessToken,
      canRead: hasReadScope(fresh.scope || row.scope),
    };
  } catch (e) {
    await markNeedsReauth(row.id, e instanceof Error ? e.message : 'Could not refresh Google access.');
    return null;
  }
}

async function markNeedsReauth(id: string, message: string): Promise<void> {
  await db.update(emailAccounts)
    .set({ status: 'needs_reauth', lastError: message, updatedAt: new Date() })
    .where(eq(emailAccounts.id, id));
}

/** Convenience: resolve a ready-to-use mailbox for a user in one call. */
export async function resolveMailbox(userId: string): Promise<ReadyMailbox | null> {
  const row = await getSendingMailbox(userId);
  if (!row) return null;
  return ensureAccessToken(row);
}
