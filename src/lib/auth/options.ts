import type { NextAuthOptions, DefaultSession } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db/client';
import { users, permissions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { rateLimit } from '@/lib/api/rate-limit';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: 'master_admin' | 'company_admin' | 'rep' | 'lead_source';
      companyId: string | null;
      permissions: string[];
    } & DefaultSession['user'];
  }
  interface User {
    id: string;
    email: string;
    name: string;
    role: 'master_admin' | 'company_admin' | 'rep' | 'lead_source';
    companyId: string | null;
    permissions: string[];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: 'master_admin' | 'company_admin' | 'rep' | 'lead_source';
    companyId: string | null;
    permissions: string[];
    /** ms epoch; we re-query the DB after this to pick up role/active changes */
    refreshAt?: number;
  }
}

export const authOptions: NextAuthOptions = {
  // Session lifetime: 24h. Shorter than the previous 7d so that if an admin
  // demotes or disables a user, the change takes effect within a day at the
  // worst case (immediately on logout). For production with sensitive
  // operations a shorter window is more defensible than the convenience of
  // week-long sessions.
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = credentials.email.toLowerCase().trim();

        // Throttle login attempts per email: 10 tries / 5 min. Slows brute-forcing
        // without locking a legitimate user out for long.
        const rl = rateLimit(`login:${email}`, { max: 10, windowMs: 5 * 60_000 });
        if (!rl.allowed) {
          throw new Error('Too many attempts. Please wait a few minutes and try again.');
        }

        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user || !user.isActive) return null;

        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;

        // Update last login (best-effort)
        await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

        // Load permissions
        const perms = await db
          .select({ key: permissions.permissionKey })
          .from(permissions)
          .where(eq(permissions.userId, user.id));

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          companyId: user.companyId,
          permissions: perms.map((p) => p.key),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Initial sign-in — capture everything.
        token.id = user.id;
        token.role = user.role;
        token.companyId = user.companyId;
        token.permissions = user.permissions;
        token.refreshAt = Date.now() + 5 * 60_000; // re-validate against DB every 5 min
        return token;
      }
      // Subsequent requests: periodically re-pull role + active status from
      // the DB so revoked admins, deactivated users, and permission changes
      // take effect within minutes (not whenever the token expires).
      if (token.id && (!token.refreshAt || Date.now() > Number(token.refreshAt))) {
        try {
          const [u] = await db.select().from(users).where(eq(users.id, String(token.id))).limit(1);
          if (!u || !u.isActive) {
            // Force this token to look invalid downstream — caller checks
            // .role and will redirect/deny.
            token.id = '';
            token.role = 'rep';
            token.permissions = [];
          } else {
            token.role = u.role;
            token.companyId = u.companyId;
            const perms = await db
              .select({ key: permissions.permissionKey })
              .from(permissions)
              .where(eq(permissions.userId, u.id));
            token.permissions = perms.map((p) => p.key);
          }
        } catch {
          // DB hiccup — keep existing token, don't fail the request.
        }
        token.refreshAt = Date.now() + 5 * 60_000;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.companyId = token.companyId;
        session.user.permissions = token.permissions;
      }
      return session;
    },
  },
};
