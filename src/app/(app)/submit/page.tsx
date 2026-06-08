'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * The standalone Submit Deal page was retired in favor of the unified
 * Shop & Submit screen. This route exists only as a redirect so old links,
 * bookmarks, and any internal references still resolve.
 *
 * If a `dealId` query param is present we carry it over so the user lands
 * on the merged page with the deal already selected.
 */
export default function SubmitRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const dealId = searchParams?.get('dealId');
    const target = dealId ? `/deal-shop?dealId=${encodeURIComponent(dealId)}` : '/deal-shop';
    router.replace(target);
  }, [router, searchParams]);
  return (
    <div className="p-6 text-sm text-muted-foreground">
      Redirecting to Shop &amp; Submit…
    </div>
  );
}
