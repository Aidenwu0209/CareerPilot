import { eq, and } from 'drizzle-orm';
import { db } from '../index';
import { authAccounts } from '../schema';

export const authAccountRepository = {
  async findByProviderAndAccountId(provider: string, providerAccountId: string) {
    const result = await db
      .select()
      .from(authAccounts)
      .where(
        and(
          eq(authAccounts.provider, provider),
          eq(authAccounts.providerAccountId, providerAccountId),
        ),
      )
      .limit(1);
    return result[0] || null;
  },

  async findByUserId(userId: string) {
    return db.select().from(authAccounts).where(eq(authAccounts.userId, userId));
  },

  async create(data: {
    userId: string;
    provider: string;
    providerAccountId: string;
    accessToken?: string | null;
    refreshToken?: string | null;
    tokenType?: string | null;
    expiresAt?: Date | null;
    scope?: string | null;
  }) {
    const id = crypto.randomUUID();
    await db.insert(authAccounts).values({ ...data, id });
    return this.findByProviderAndAccountId(data.provider, data.providerAccountId);
  },
};
