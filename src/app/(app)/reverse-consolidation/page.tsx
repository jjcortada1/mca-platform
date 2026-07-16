import { pageRequireTenant } from '@/lib/auth/context';
import { getTenantBranding } from '@/lib/branding';
import { ReverseConsolidationBuilder } from '@/components/reverse-consolidation-builder';

/**
 * Reverse Consolidation Sheet — build a client-facing offer breakdown for a
 * weekly-disbursement funding consolidation, then print/save it as a PDF
 * branded with the company's name + logo. Server wrapper only resolves the
 * tenant branding; all interaction is client-side (nothing is persisted to
 * the database — this is a presentation tool).
 */
export default async function ReverseConsolidationPage() {
  const { companyId } = await pageRequireTenant();
  const branding = await getTenantBranding(companyId);
  return (
    <ReverseConsolidationBuilder
      companyName={branding.displayName}
      logoUrl={branding.logoUrl}
    />
  );
}
