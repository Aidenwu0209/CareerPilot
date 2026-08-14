import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const { resolve } = await import('node:path');
  const schema = await import('@/lib/db/schema');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });
  return { db, dbReady: Promise.resolve() };
});

import { db } from '@/lib/db';
import { supportTickets, users } from '@/lib/db/schema';
import {
  createSupportTicket,
  listAdminSupportTickets,
  listUserSupportTickets,
  SupportValidationError,
  updateSupportTicket,
} from './service';

beforeEach(async () => {
  await db.delete(supportTickets);
  await db.delete(users);
  await db.insert(users).values([
    { id: 'support-user-1', email: 'one@example.com', name: 'User One', authType: 'email' },
    { id: 'support-user-2', email: 'two@example.com', name: 'User Two', authType: 'email' },
    { id: 'support-admin', email: 'admin@example.com', name: 'Admin', authType: 'email', platformRole: 'super_admin' },
  ]);
});

describe('support ticket service', () => {
  it('creates validated tickets and keeps user lists isolated', async () => {
    await createSupportTicket('support-user-1', {
      category: 'technical', subject: 'Export failed', description: 'The export button returns an error.',
    });
    await createSupportTicket('support-user-2', {
      category: 'account', subject: 'Cannot sign in', description: 'Sign-in fails after entering my password.',
    });

    const firstUser = await listUserSupportTickets('support-user-1');
    expect(firstUser).toHaveLength(1);
    expect(firstUser[0]).toMatchObject({ userId: 'support-user-1', subject: 'Export failed', status: 'open' });
    await expect(createSupportTicket('support-user-1', { category: 'other', subject: 'x', description: 'short' }))
      .rejects.toBeInstanceOf(SupportValidationError);
  });

  it('supports admin filtering, replies, status changes, and pagination metadata', async () => {
    const ticket = await createSupportTicket('support-user-1', {
      category: 'billing', subject: 'Order reconciliation', description: 'Please check the status of my payment order.',
    });
    const updated = await updateSupportTicket(ticket.id, 'support-admin', {
      reply: 'We verified the order and restored the credits.',
      status: 'replied',
    });
    expect(updated).toMatchObject({ status: 'replied', repliedByUserId: 'support-admin' });
    expect(updated?.repliedAt).toBeInstanceOf(Date);

    const result = await listAdminSupportTickets({ status: 'replied', page: 1, pageSize: 10 });
    expect(result).toMatchObject({ total: 1, page: 1, pageCount: 1 });
    expect(result.rows[0]).toMatchObject({ userEmail: 'one@example.com', adminReply: 'We verified the order and restored the credits.' });
  });
});
