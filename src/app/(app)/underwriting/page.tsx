import { pageRequireTenant } from '@/lib/auth/context';
import { UnderwritingWorkstation } from '@/components/underwriting/workstation';

/**
 * Underwriting — the MCA underwriting workstation.
 *
 * Server wrapper only enforces a signed-in tenant session. The feature is
 * client-side by design: statements are parsed in the browser and analyzed
 * by local code (src/lib/underwriting/*). Nothing is uploaded, nothing is
 * written to the database, and no AI/API credits are consumed — so there
 * is no tenant data to scope and no leak surface.
 */
export default async function UnderwritingPage() {
  await pageRequireTenant();
  return <UnderwritingWorkstation />;
}
