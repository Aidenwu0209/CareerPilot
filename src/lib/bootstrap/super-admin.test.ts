import { describe, it, expect, vi, afterEach } from 'vitest';
import { eq, count } from 'drizzle-orm';

/**
 * US-014 tests: Super Admin Bootstrap
 *
 * Validates:
 * - bootstrap grants super_admin to explicitly configured account only
 * - first registered user does NOT auto-promote
 * - bootstrap is idempotent (no duplicate role changes or users)
 * - both success and failure generate audit events without sensitive values
 * - regular user updates cannot change platformRole
 * - unconfigured bootstrap in production gives clear warning
 *
 * Note: audit_events table is immutable (triggers block UPDATE/DELETE),
 * so tests do NOT clean audit_events between cases. Instead, audit event
 * assertions use delta counting (count before action vs. after).
 */

// --- Mock the DB module with an in-memory SQLite instance ---
vi.mock('@/lib/db', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const { resolve } = await import('path');
  const schema = await import('@/lib/db/schema');

  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });

  return { db, dbReady: Promise.resolve() };
});

// --- Mock sample-resume to avoid complexity ---
vi.mock('@/lib/db/sample-resume', () => ({
  createSampleResume: vi.fn().mockResolvedValue(undefined),
}));

// --- Import AFTER mocks ---
import { bootstrapSuperAdmin } from './super-admin';
import { db } from '@/lib/db';
import { users, auditEvents } from '@/lib/db/schema';
import { userRepository } from '@/lib/db/repositories/user.repository';

afterEach(() => {
  delete process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL;
  Object.assign(process.env, { NODE_ENV: 'test' });
  vi.restoreAllMocks();
});

/** Count bootstrap.super_admin audit events (immutable table, use deltas). */
async function countBootstrapAudits(): Promise<number> {
  const result = await db
    .select({ cnt: count() })
    .from(auditEvents)
    .where(eq(auditEvents.action, 'bootstrap.super_admin'));
  return Number(result[0]?.cnt ?? 0);
}

describe('US-014: Super Admin Bootstrap', () => {
  describe('AC1: Only explicitly configured account gets super_admin', () => {
    it('promotes the configured user to super_admin', async () => {
      const created = await userRepository.create({
        email: 'admin-ac1-promote@test.com',
        name: 'Admin',
        authType: 'oauth',
      });
      expect(created?.platformRole).toBe('user');

      process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL = 'admin-ac1-promote@test.com';
      const result = await bootstrapSuperAdmin();

      expect(result.action).toBe('promoted');
      expect(result.userId).toBe(created!.id);

      const updated = await userRepository.findById(created!.id);
      expect(updated?.platformRole).toBe('super_admin');
    });

    it('does NOT auto-promote the first registered user when bootstrap is unconfigured', async () => {
      const first = await userRepository.create({
        email: 'first-ac1-unconfigured@test.com',
        name: 'First',
        authType: 'oauth',
      });
      // No BOOTSTRAP_SUPER_ADMIN_EMAIL set
      const result = await bootstrapSuperAdmin();

      expect(result.action).toBe('not_configured');

      const rechecked = await userRepository.findById(first!.id);
      expect(rechecked?.platformRole).toBe('user');
    });

    it('only promotes the configured email, not other users', async () => {
      const admin = await userRepository.create({
        email: 'admin-ac1-only@test.com',
        name: 'Admin',
        authType: 'oauth',
      });
      const other = await userRepository.create({
        email: 'other-ac1-only@test.com',
        name: 'Other',
        authType: 'oauth',
      });

      process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL = 'admin-ac1-only@test.com';
      await bootstrapSuperAdmin();

      const adminAfter = await userRepository.findById(admin!.id);
      const otherAfter = await userRepository.findById(other!.id);
      expect(adminAfter?.platformRole).toBe('super_admin');
      expect(otherAfter?.platformRole).toBe('user');
    });
  });

  describe('AC2: Idempotent — no duplicate role changes', () => {
    it('running twice does not create duplicate promotion events', async () => {
      await userRepository.create({
        email: 'admin-ac2-idem@test.com',
        name: 'Admin',
        authType: 'oauth',
      });

      process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL = 'admin-ac2-idem@test.com';

      const before = await countBootstrapAudits();
      await bootstrapSuperAdmin();
      await bootstrapSuperAdmin(); // second run
      const after = await countBootstrapAudits();

      // First run: 1 promotion event, Second run: 1 already_admin event = 2 total
      expect(after - before).toBe(2);
    });

    it('running twice on already-admin user returns already_admin', async () => {
      await userRepository.create({
        email: 'admin-ac2-already@test.com',
        name: 'Admin',
        authType: 'oauth',
      });

      process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL = 'admin-ac2-already@test.com';

      const first = await bootstrapSuperAdmin();
      const second = await bootstrapSuperAdmin();

      expect(first.action).toBe('promoted');
      expect(second.action).toBe('already_admin');
    });

    it('does not create duplicate users', async () => {
      await userRepository.create({
        email: 'admin-ac2-nodup@test.com',
        name: 'Admin',
        authType: 'oauth',
      });

      process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL = 'admin-ac2-nodup@test.com';
      await bootstrapSuperAdmin();
      await bootstrapSuperAdmin();
      await bootstrapSuperAdmin();

      const matching = await db
        .select()
        .from(users)
        .where(eq(users.email, 'admin-ac2-nodup@test.com'));
      expect(matching).toHaveLength(1);
    });
  });

  describe('AC3: Audit events for success and failure, no sensitive values', () => {
    it('creates a success audit event on promotion', async () => {
      await userRepository.create({
        email: 'admin-ac3-success@test.com',
        name: 'Admin',
        authType: 'oauth',
      });

      process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL = 'admin-ac3-success@test.com';
      const before = await countBootstrapAudits();
      await bootstrapSuperAdmin();
      const after = await countBootstrapAudits();

      expect(after - before).toBe(1);
    });

    it('creates a failure audit event when target user not found', async () => {
      process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL = 'nonexistent-ac3-fail@test.com';
      const before = await countBootstrapAudits();
      await bootstrapSuperAdmin();
      const after = await countBootstrapAudits();

      expect(after - before).toBe(1);
    });

    it('audit summary does not contain the full raw email', async () => {
      const email = 'very.long.admin.ac3@test.com';
      await userRepository.create({
        email,
        name: 'Admin',
        authType: 'oauth',
      });

      process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL = email;
      await bootstrapSuperAdmin();

      // Query the latest audit event for this action
      const allEvents = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'bootstrap.super_admin'));
      const latest = allEvents[allEvents.length - 1];

      expect(latest.summary).not.toContain(email);
      // Should contain a redacted version with the domain
      expect(latest.summary).toContain('@test.com');
    });

    it('audit event for success has correct structure', async () => {
      const admin = await userRepository.create({
        email: 'admin-ac3-struct@test.com',
        name: 'Admin',
        authType: 'oauth',
      });

      process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL = 'admin-ac3-struct@test.com';
      await bootstrapSuperAdmin();

      const allEvents = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'bootstrap.super_admin'));
      const latest = allEvents[allEvents.length - 1];

      expect(latest.result).toBe('success');
      expect(latest.targetType).toBe('user');
      expect(latest.targetId).toBe(admin!.id);
      expect(latest.actorId).toBeNull(); // system-initiated
    });
  });

  describe('AC4: Regular user updates cannot change platformRole', () => {
    it('calling update with allowed fields does not change platformRole', async () => {
      const user = await userRepository.create({
        email: 'normal-ac4@test.com',
        name: 'Normal',
        authType: 'oauth',
      });

      await userRepository.update(user!.id, { name: 'Updated Name' });

      const after = await userRepository.findById(user!.id);
      expect(after?.platformRole).toBe('user');
      expect(after?.name).toBe('Updated Name');
    });

    it('first registered user has default role "user", not super_admin', async () => {
      const user = await userRepository.create({
        email: 'first-ac4-default@test.com',
        name: 'First',
        authType: 'oauth',
      });

      expect(user?.platformRole).toBe('user');
    });
  });

  describe('AC5: Unconfigured bootstrap warns in production', () => {
    it('returns not_configured when env var is unset', async () => {
      Object.assign(process.env, { NODE_ENV: 'production' });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await bootstrapSuperAdmin();

      expect(result.action).toBe('not_configured');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const warnMsg = warnSpy.mock.calls[0][0] as string;
      expect(warnMsg).toContain('BOOTSTRAP_SUPER_ADMIN_EMAIL');
      expect(warnMsg).toContain('not configured');
    });

    it('does NOT randomly select a user when unconfigured', async () => {
      Object.assign(process.env, { NODE_ENV: 'production' });
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await userRepository.create({
        email: 'random-ac5@test.com',
        name: 'Random User',
        authType: 'oauth',
      });

      await bootstrapSuperAdmin();

      const matching = await db
        .select()
        .from(users)
        .where(eq(users.email, 'random-ac5@test.com'));
      expect(matching).toHaveLength(1);
      expect(matching[0].platformRole).toBe('user');
    });

    it('does not warn in development when unconfigured', async () => {
      Object.assign(process.env, { NODE_ENV: 'development' });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await bootstrapSuperAdmin();

      expect(result.action).toBe('not_configured');
      // Should NOT warn in development
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('Whitespace handling', () => {
    it('trims whitespace from BOOTSTRAP_SUPER_ADMIN_EMAIL', async () => {
      await userRepository.create({
        email: 'admin-trim@test.com',
        name: 'Admin',
        authType: 'oauth',
      });

      process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL = '  admin-trim@test.com  ';
      const result = await bootstrapSuperAdmin();

      expect(result.action).toBe('promoted');
    });
  });
});
