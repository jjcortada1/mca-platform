/**
 * Web Push delivery — sends real OS-level notifications to a user's desktop
 * and phone, even when the app tab is closed.
 *
 * VAPID keys are generated ONCE on first use and stored in app_flags so they
 * survive restarts and re-deploys (changing keys would orphan every existing
 * subscription). Dead endpoints (410/404 from the push service) are pruned
 * automatically. Everything here is best-effort — push failures never break
 * the action that triggered the notification.
 */
import { getRawSql } from '@/lib/db/client';

interface VapidKeys { publicKey: string; privateKey: string }

let cachedKeys: VapidKeys | null = null;

/** Load (or create-once) the VAPID keypair from app_flags. */
export async function getVapidKeys(): Promise<VapidKeys | null> {
  if (cachedKeys) return cachedKeys;
  try {
    const sql = getRawSql();
    const rows = await sql`SELECT value FROM app_flags WHERE key = 'vapid_keys_v1' LIMIT 1`;
    if (rows.length && rows[0].value) {
      cachedKeys = JSON.parse(rows[0].value as string) as VapidKeys;
      return cachedKeys;
    }
    const webpush = (await import('web-push')).default;
    const keys = webpush.generateVAPIDKeys();
    await sql`INSERT INTO app_flags (key, value) VALUES ('vapid_keys_v1', ${JSON.stringify(keys)})
              ON CONFLICT (key) DO NOTHING`;
    // Re-read in case a parallel boot won the race — everyone must use the
    // same keypair.
    const again = await sql`SELECT value FROM app_flags WHERE key = 'vapid_keys_v1' LIMIT 1`;
    cachedKeys = again.length ? (JSON.parse(again[0].value as string) as VapidKeys) : keys;
    return cachedKeys;
  } catch (err) {
    console.error('[push] VAPID key setup failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Push a notification to every registered device of the given users.
 * Fire-and-forget: callers don't await delivery.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: { title: string; body?: string; link?: string },
): Promise<void> {
  if (!userIds.length) return;
  try {
    const keys = await getVapidKeys();
    if (!keys) return;
    const webpush = (await import('web-push')).default;
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:notifications@cortadacapitalgroup.com',
      keys.publicKey,
      keys.privateKey,
    );
    const sql = getRawSql();
    const subs = await sql`
      SELECT id, endpoint, p256dh, auth FROM push_subscriptions
      WHERE user_id = ANY(${userIds}::uuid[])`;
    const body = JSON.stringify(payload);
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } },
          body,
        );
      } catch (err: unknown) {
        // 404/410 = the browser dropped the subscription — prune it.
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          try { await sql`DELETE FROM push_subscriptions WHERE id = ${s.id}`; } catch { /* ignore */ }
        }
      }
    }));
  } catch (err) {
    console.error('[push] send failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}
