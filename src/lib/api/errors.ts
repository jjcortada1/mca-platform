import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError, ForbiddenError } from '@/lib/auth/context';

/**
 * Convert any thrown error into a properly-typed JSON HTTP response.
 *
 * - AuthError       → 401 (with its message — safe, e.g. "Not authenticated")
 * - ForbiddenError  → 403 (with its message — safe, e.g. "Missing permission: x")
 * - ZodError        → 400 (with field-level validation details — safe + useful)
 * - anything else   → 500 (generic message to the client, full error to server logs)
 *
 * This prevents leaking internal database / stack details to the browser while
 * still giving the user actionable validation feedback.
 */
export function apiError(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof ZodError) {
    const flat = err.flatten();
    // Build a human-readable message from the first field error so the UI can
    // show something useful (e.g. "Password must be at least 8 characters")
    // instead of a generic "Validation failed".
    const firstField = Object.entries(flat.fieldErrors)[0];
    const firstFieldMsg = firstField && firstField[1] && firstField[1][0]
      ? `${firstField[0]}: ${firstField[1][0]}`
      : flat.formErrors[0];
    return NextResponse.json(
      { error: firstFieldMsg || 'Validation failed', details: flat },
      { status: 400 }
    );
  }

  // Known safe domain errors: surface the message but as a 400 (client can fix input)
  if (err instanceof Error && isSafeDomainMessage(err.message)) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  // Unknown / unexpected — log server-side, return generic to client
  console.error('[api error]', err);
  return NextResponse.json(
    { error: 'Something went wrong. Please try again.' },
    { status: 500 }
  );
}

/**
 * Allowlist of error-message shapes that are safe (and useful) to send to the client.
 * These are validation / business-rule messages the app itself throws on purpose,
 * not raw database or system errors.
 */
function isSafeDomainMessage(msg: string): boolean {
  if (!msg) return false;
  // Don't forward anything that smells like an internal/DB/stack error
  const unsafe = [
    'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'getaddrinfo',
    'relation', 'column', 'syntax error', 'duplicate key',
    'violates', 'constraint', 'postgres', 'connect',
    'undefined', 'null', 'cannot read', 'is not a function',
    'DATABASE_URL', 'ENCRYPTION_KEY', 'NEXTAUTH',
  ];
  const lower = msg.toLowerCase();
  if (unsafe.some((u) => lower.includes(u.toLowerCase()))) return false;
  // Reasonable length cap — internal errors tend to be long stack-y strings
  return msg.length < 200;
}
