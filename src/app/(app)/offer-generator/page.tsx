import { redirect } from 'next/navigation';
import { pageRequireUser, isPlatformOwnerCompany } from '@/lib/auth/context';
import { OfferGenerator } from '@/components/offers/offer-generator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Offer Generator — Cortada only.
 *
 * Gated on the user's REAL company being the platform owner, deliberately
 * NOT on the demo-resolved company: the tool carries Cortada's own logo and
 * closing copy, so it is not something a client tenant should ever reach.
 * Checking the real company also means the page keeps working while demo
 * mode is on, rather than vanishing mid-presentation.
 *
 * A non-owner who guesses the URL is redirected to their dashboard; the
 * sidebar applies the same test so the item never appears for them.
 */
export default async function OfferGeneratorPage() {
  const user = await pageRequireUser();
  const allowed =
    user.role === 'master_admin' ||
    (!!user.companyId && (await isPlatformOwnerCompany(user.companyId)));
  if (!allowed) redirect('/dashboard');

  return <OfferGenerator />;
}
