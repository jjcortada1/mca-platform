import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/account/signature — returns the caller's current signature.
 * PUT  /api/account/signature — replaces it (empty string → clear).
 *
 * Scoped to the caller only; reps never see or edit another rep's signature.
 */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const [me] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
    return NextResponse.json({
      data: {
        emailSignature: me?.emailSignature ?? '',
        signatureLogoUrl: me?.signatureLogoUrl ?? '',
        signatureLink: me?.signatureLink ?? '',
      },
    });
  } catch (e) { return apiError(e); }
}

/**
 * Sanitize HTML to remove dangerous tags while preserving font/style.
 * Allows: p, br, span, div, b, i, u, strong, em, font (with color/face),
 * and style attributes like font-family, color, font-size.
 */
function sanitizeSignatureHtml(dirty: string): string {
  if (!dirty) return dirty;
  // Remove script tags and their content
  let clean = dirty.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // Remove event handlers (onclick, onload, etc.)
  clean = clean.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  clean = clean.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '');
  // Remove style tags (allow inline styles only)
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  // Remove javascript: URLs
  clean = clean.replace(/href\s*=\s*["']?javascript:[^"'\s>]*/gi, 'href="#"');
  // Remove data: URLs in href
  clean = clean.replace(/href\s*=\s*["']?data:[^"'\s>]*/gi, 'href="#"');
  return clean;
}

const schema = z.object({
  // Generous cap: a signature pasted from Gmail arrives as HTML (tables,
  // inline styles, sometimes an inline data-URI image) and can easily run
  // tens of KB. 300K keeps even image-bearing signatures intact while
  // still bounding abuse.
  emailSignature: z.string().max(300_000).transform(sanitizeSignatureHtml),
  // Data URI for the logo. SVG is intentionally disallowed (can carry scripts).
  // Capped at ~700KB base64 (~500KB binary) — emails over ~1MB attachment
  // total get bounced by some SMTP relays, so we keep the signature image small.
  signatureLogoUrl: z.string().max(700_000).refine((v) => {
    if (!v) return true;
    if (/^https?:\/\//i.test(v)) return v.length <= 2048;
    return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v);
  }, { message: 'Logo must be a PNG, JPG, WebP, or GIF (no SVG), under ~500KB.' }).optional().nullable().or(z.literal('')),
  // Link — must be http(s) and not contain CR/LF. We do not allow arbitrary
  // schemes here because the link will be rendered in HTML and a javascript:
  // or data: URL is a real XSS / phishing vector if forwarded.
  signatureLink: z.string().max(500).refine((v) => {
    if (!v) return true;
    if (/[\r\n\0]/.test(v)) return false;
    return /^https?:\/\//i.test(v);
  }, { message: 'Link must start with http:// or https://' }).optional().nullable().or(z.literal('')),
});

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    const body = schema.parse(await req.json());
    const sig = body.emailSignature.trim().length === 0 ? null : body.emailSignature;
    const logo = body.signatureLogoUrl && body.signatureLogoUrl.length > 0 ? body.signatureLogoUrl : null;
    const link = body.signatureLink && body.signatureLink.length > 0 ? body.signatureLink : null;
    await db.update(users)
      .set({
        emailSignature: sig,
        signatureLogoUrl: logo,
        signatureLink: link,
        updatedAt: new Date(),
      })
      .where(eq(users.id, ctx.user.id));
    return NextResponse.json({
      ok: true,
      data: { emailSignature: sig ?? '', signatureLogoUrl: logo ?? '', signatureLink: link ?? '' },
    });
  } catch (e) { return apiError(e); }
}
