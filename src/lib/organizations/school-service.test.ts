import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/config', () => ({ config: { db: { type: 'sqlite' } } }));
vi.mock('@/lib/db', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const schema = await import('@/lib/db/schema');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });
  return { db, dbReady: Promise.resolve() };
});

import { db } from '@/lib/db';
import {
  educationRoleAssignments,
  organizationDiscounts,
  organizationDomains,
  organizationInvites,
  organizationMemberships,
  organizations,
  users,
} from '@/lib/db/schema';
import { addSchoolDomain, createSchoolInvite, getSchoolDiscount, redeemSchoolInvite, upsertSchoolDiscount, verifySchoolDomain } from './school-service';

beforeEach(async () => {
  await db.delete(educationRoleAssignments);
  await db.delete(organizationMemberships);
  await db.delete(organizationDiscounts);
  await db.delete(organizationInvites);
  await db.delete(organizationDomains);
  await db.delete(organizations);
  await db.delete(users);
  await db.insert(users).values([
    { id: 'admin', email: 'admin@example.edu', authType: 'email' },
    { id: 'student', email: 'student@example.edu', authType: 'email' },
  ]);
  await db.insert(organizations).values({ id: 'school', slug: 'example-u', name: 'Example University', kind: 'school', seatLimit: 10, createdBy: 'admin' });
});

describe('school partnership service', () => {
  it('stores only an invite hash and binds a student exactly once', async () => {
    const created = await createSchoolInvite('school', 'admin', { maxUses: 2 });
    expect(created.plaintextCode).toMatch(/^CP-/);
    const [stored] = await db.select().from(organizationInvites);
    expect(stored.codeHash).not.toContain(created.plaintextCode);
    expect(JSON.stringify(stored)).not.toContain(created.plaintextCode);

    await redeemSchoolInvite('student', created.plaintextCode);
    await redeemSchoolInvite('student', created.plaintextCode);
    expect(await db.select().from(organizationMemberships)).toHaveLength(1);
    expect(await db.select().from(educationRoleAssignments)).toHaveLength(1);
  });

  it('tracks domain verification and applies the configured plan discount', async () => {
    const settings = await addSchoolDomain('school', 'admin', 'Example.EDU');
    expect(settings.domains[0]).toMatchObject({ domain: 'example.edu', verified: false });
    await verifySchoolDomain('school', settings.domains[0].id);
    const invite = await createSchoolInvite('school', 'admin', { maxUses: 1 });
    await redeemSchoolInvite('student', invite.plaintextCode);
    await upsertSchoolDiscount('school', 'admin', 'pro', 25);
    await upsertSchoolDiscount('school', 'admin', '*', 10);
    expect(await getSchoolDiscount('student', 'pro')).toMatchObject({ planCode: 'pro', percentOff: 25 });
    expect(await getSchoolDiscount('student', 'starter')).toMatchObject({ planCode: '*', percentOff: 10 });
  });
});
