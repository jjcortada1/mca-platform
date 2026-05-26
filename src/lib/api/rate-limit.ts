/**
 * Minimal in-memory rate limiter.
 *
 * Scope: single-process (one Replit instance). Not a distributed limiter, but
 * sufficient to blunt accidental loops, double-clicks, and basic abuse on a
 * single-tenant deployment. State resets on restart, which is fine.
 *
 * Usage:
 *   const rl = rateLimit(`send:${userId}`, { max: 20, windowMs: 60_000 });
 *   if (!rl.allowed) return tooMany(rl.retryAfterSec);
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

// Opportunistic cleanup so the map doesn't grow unbounded.
let lastSweep = Date.now();
function sweep(now: number, windowMs: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    b.hits = b.hits.filter((t) => now - t < windowMs);
    if (b.hits.length === 0) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function rateLimit(
  key: string,
  opts: { max: number; windowMs: number }
): RateLimitResult {
  const now = Date.now();
  sweep(now, opts.windowMs);

  let b = buckets.get(key);
  if (!b) {
    b = { hits: [] };
    buckets.set(key, b);
  }
  // Drop hits outside the window
  b.hits = b.hits.filter((t) => now - t < opts.windowMs);

  if (b.hits.length >= opts.max) {
    const oldest = b.hits[0];
    const retryAfterMs = opts.windowMs - (now - oldest);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  b.hits.push(now);
  return {
    allowed: true,
    remaining: opts.max - b.hits.length,
    retryAfterSec: 0,
  };
}
