import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      platformRole: 'super_admin' | 'user';
      status: 'active' | 'suspended' | 'deleted';
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    platformRole?: 'super_admin' | 'user';
    status?: 'active' | 'suspended' | 'deleted';
    lastRefreshAt?: number;
  }
}
