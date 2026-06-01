import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/context';

/**
 * SERVER-SIDE GUARD for /lead-source-portal.
 *
 * This portal is for users whose role is `lead_source` only. Anyone else
 * (admins, reps, signed-out users) is redirected away so they never even
 * see the portal shell.
 *
 * The data API also enforces this, so this is defense-in-depth — the page
 * shell itself doesn't render for the wrong audience.
 */
export default async function LeadSourcePortalLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role !== 'lead_source') {
    // Admins/reps land on their normal dashboard
    redirect('/dashboard');
  }
  return <>{children}</>;
}
