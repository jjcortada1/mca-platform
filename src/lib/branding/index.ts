import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export interface Branding {
  productName: string;
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  emailSignature: string | null;
}

export const DEFAULT_BRANDING: Branding = {
  productName: 'Cortada',
  displayName: 'Cortada Capital Group',
  logoUrl: null,
  primaryColor: '222 47% 17%',
  emailSignature: null,
};

/**
 * Conservative CSS color sanitizer for a tenant primary color injected into
 * a <style> tag at request time. Accepts only shapes that look like valid
 * color values so the branding store can't inject arbitrary CSS. Shared by
 * the root (public) layout and the (app) tenant layout so each company's
 * color is applied individually and safely.
 */
export function sanitizeCssColor(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = String(input).trim();
  if (!v || v.length > 80) return null;
  if (/[{};"'<>\\]/.test(v)) return null;
  const shapes: RegExp[] = [
    /^\d{1,3}\s+\d{1,3}(?:\.\d+)?%\s+\d{1,3}(?:\.\d+)?%$/,  // HSL triple "222 47% 17%"
    /^#[0-9a-fA-F]{3,8}$/,                                   // hex
    /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/,
    /^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/,
    /^[a-zA-Z]{1,30}$/,
  ];
  return shapes.some((re) => re.test(v)) ? v : null;
}

function fromCompany(c: typeof companies.$inferSelect): Branding {
  // Normalize logoUrl: treat empty / whitespace-only as null so consumers can
  // confidently use `branding.logoUrl || fallback`.
  const rawLogo = typeof c.logoUrl === 'string' ? c.logoUrl.trim() : c.logoUrl;
  return {
    productName: c.productName ?? DEFAULT_BRANDING.productName,
    displayName: c.displayName ?? c.name ?? DEFAULT_BRANDING.displayName,
    logoUrl: rawLogo || null,
    primaryColor: c.primaryColor ?? DEFAULT_BRANDING.primaryColor,
    emailSignature: c.emailSignature ?? null,
  };
}

/**
 * Public branding for the login screen. Single-tenant model — uses the first/only
 * company. Returns defaults if no company exists yet (fresh install).
 */
export async function getPublicBranding(): Promise<Branding> {
  try {
    const rows = await db.select().from(companies).limit(1);
    if (!rows[0]) return DEFAULT_BRANDING;
    return fromCompany(rows[0]);
  } catch {
    return DEFAULT_BRANDING;
  }
}

/**
 * Branding for an authenticated tenant. Fetches by companyId.
 */
export async function getTenantBranding(companyId: string): Promise<Branding> {
  try {
    const rows = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!rows[0]) return DEFAULT_BRANDING;
    return fromCompany(rows[0]);
  } catch {
    return DEFAULT_BRANDING;
  }
}
