/**
 * Next.js instrumentation hook — runs once when the server starts (both
 * `next dev` and `next start`). Used to align the database schema with the
 * code before any request is served, so uploading a new build onto an
 * existing database can never break queries with missing columns.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureSchema } = await import('@/lib/db/bootstrap');
    await ensureSchema().catch((err) => {
      console.error('[instrumentation] schema bootstrap failed:', err);
    });
  }
}
