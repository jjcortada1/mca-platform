import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/context';

export default async function RootPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  // Single login goes to dashboard for everyone (master features available via Settings → Companies)
  redirect('/dashboard');
}
