import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { config } from '@/lib/config';
import { resolveOAuthAccount } from './oauth-linking';

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
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
        const avatar = ((profile as any)?.picture || user.image) as string | undefined;

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
      }

      // Credentials (fingerprint) mode
      if (user && !account?.provider) {
        token.userId = user.id;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.userId || token.sub) as string;
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
