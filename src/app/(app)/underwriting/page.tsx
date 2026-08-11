import { pageRequireTenant } from '@/lib/auth/context';
import { UnderwritingScrub } from '@/components/underwriting-scrub';

/**
 * Underwriting — bank-statement MCA scrub.
 *
 * Server wrapper does nothing but enforce a signed-in tenant session. The
 * whole feature is client-side by design: statements are parsed in the
 * browser and analyzed by local code (src/lib/underwriting/*). Nothing is
 * uploaded, nothing is written to the database, and no AI/API credits are
 * consumed — so there is no tenant data to scope and no leak surface.
 */
export default async function UnderwritingPage() {
  await pageRequireTenant();
  return <UnderwritingScrub />;
}
