import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { config } from '@/lib/config';
import { resolveOAuthAccount } from './oauth-linking';
import { refreshUserClaims, shouldRefresh } from './session-claims';

const isProduction = process.env.NODE_ENV === 'production';

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  // Explicit cookie security attributes (AC: HttpOnly, Secure in prod, SameSite)
  cookies: {
    sessionToken: {
      name: isProduction
        ? '__Secure-authjs.session-token'
        : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        secure: isProduction,
      },
    },
  },
  providers: config.auth.enabled
    ? [
        Google({
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        }),
      ]
    : [
        Credentials({
          name: 'Fingerprint',
          credentials: {
            fingerprint: { label: 'Fingerprint', type: 'text' },
          },
          async authorize(credentials) {
            const fingerprint = credentials?.fingerprint as string;
            if (!fingerprint) return null;
            return {
              id: `fp_${fingerprint}`,
              name: 'Anonymous User',
            };
          },
        }),
      ],
  callbacks: {
    async jwt({ token, user, account, profile }) {
      // First sign-in via Google: resolve or create persistent account link
      if (user && account?.provider === 'google') {
        const email = (profile?.email || user.email) as string | undefined;
        const name = (profile?.name || user.name) as string | undefined;
        const avatar = ((profile as { picture?: string } | null)?.picture || user.image) as string | undefined;

        const result = await resolveOAuthAccount({
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          email: email || null,
          name: name || null,
          avatarUrl: avatar || null,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          tokenType: account.token_type,
          expiresAt: account.expires_at ? new Date(account.expires_at) : null,
          scope: account.scope,
        });

        token.userId = result.userId;
        token.name = name;
        token.email = email;
        token.picture = avatar;

        // Fetch fresh claims (platformRole, status) from DB
        const claims = await refreshUserClaims(result.userId);
        if (claims) {
          token.platformRole = claims.platformRole;
          token.status = claims.status;
        }
        token.lastRefreshAt = Math.floor(Date.now() / 1000);
      }

      // Credentials (fingerprint) mode
      if (user && !account?.provider) {
        token.userId = user.id;
      }

      // Periodic refresh: re-fetch platformRole and status from DB so that
      // role/status changes are reflected without requiring a new sign-in.
      // Sensitive operations should always read from the DB directly (resolveUser).
      if (!user && token.userId && shouldRefresh(token.lastRefreshAt)) {
        const claims = await refreshUserClaims(token.userId);
        if (claims) {
          token.platformRole = claims.platformRole;
          token.status = claims.status;
        } else {
          // User deleted — invalidate token
          token.userId = undefined;
          token.platformRole = undefined;
          token.status = undefined;
        }
        token.lastRefreshAt = Math.floor(Date.now() / 1000);
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.userId || token.sub) as string;
        session.user.platformRole = token.platformRole ?? 'user';
        session.user.status = token.status ?? 'active';
        if (token.name) session.user.name = token.name as string;
        if (token.email) session.user.email = token.email as string;
        if (token.picture) session.user.image = token.picture as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  secret: process.env.AUTH_SECRET,
});
