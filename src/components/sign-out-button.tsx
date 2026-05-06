'use client';
import { signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: '/login' })}
      className="w-full nav-item nav-item-inactive"
    >
      <LogOut className="h-4 w-4" /> <span>Sign out</span>
    </button>
  );
}
