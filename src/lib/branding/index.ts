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
  productName: 'MCA Platform',
  displayName: 'MCA Platform',
  logoUrl: null,
  primaryColor: '184 70% 22%',
  emailSignature: null,
};

function fromCompany(c: typeof companies.$inferSelect): Branding {
  return {
    productName: c.productName ?? DEFAULT_BRANDING.productName,
    displayName: c.displayName ?? c.name ?? DEFAULT_BRANDING.displayName,
    logoUrl: c.logoUrl ?? null,
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
