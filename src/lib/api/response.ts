import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError, ForbiddenError } from '@/lib/auth/context';

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function created<T>(data: T) {
  return NextResponse.json(data, { status: 201 });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

export function unauthorized(message = 'Not authenticated') {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function notFound(message = 'Not found') {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function serverError(message = 'Internal server error', err?: unknown) {
  if (err) console.error('[api]', message, err);
  return NextResponse.json({ error: message }, { status: 500 });
}

/**
 * Wrap a route handler. Catches AuthError, ForbiddenError, ZodError,
 * and unhandled exceptions, mapping each to the right HTTP status.
 */
export function handle<T extends (...args: any[]) => Promise<Response>>(fn: T): T {
  return (async (...args: any[]) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof AuthError) return unauthorized(err.message);
      if (err instanceof ForbiddenError) return forbidden(err.message);
      if (err instanceof ZodError) return badRequest('Validation failed', err.flatten());
      console.error('[api error]', err);
      const message = err instanceof Error ? err.message : 'Internal server error';
      return serverError(message);
    }
  }) as T;
}
