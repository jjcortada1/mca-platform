import { NextResponse } from 'next/server';
import { getPublicBranding } from '@/lib/branding';

export async function GET() {
  const b = await getPublicBranding();
  // Cache briefly so login page loads aren't constantly re-querying
  return NextResponse.json(b, { headers: { 'cache-control': 'public, max-age=60, s-maxage=60' } });
}
