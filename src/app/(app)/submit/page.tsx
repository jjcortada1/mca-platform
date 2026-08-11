import { redirect } from 'next/navigation';

/**
 * The standalone Submit page was retired in favor of the unified
 * Shop & Submit screen. Server-side redirect (no client flash) so old
 * links and bookmarks still resolve; a dealId query param carries over.
 */
export default function SubmitRedirect({
  searchParams,
}: {
  searchParams?: { dealId?: string };
}) {
  const dealId = searchParams?.dealId;
  redirect(dealId ? `/deal-shop?dealId=${encodeURIComponent(dealId)}` : '/deal-shop');
}
