import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'path';
import * as schema from './schema';

/**
 * US-005 tests: Organizations and Memberships schema integrity.
 *
 * Verifies:
 * - Organizations table structure (slug, name, status, seat_limit, created_by, timestamps)
 * - Memberships table structure (org_id, user_id, role, status, timestamps)
 * - FK constraints (org → memberships cascade, user → memberships cascade, user → org.created_by)
 * - Compound unique constraint on (organization_id, user_id) prevents duplicate memberships
 * - Organization slug uniqueness
 * - Default values (role=member, status=active)
 * - Indexes exist for common queries (member lookup, role, status)
 */

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

beforeAll(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });
});

afterAll(() => {
  sqlite.close();
});

describe('US-005: organizations table structure', () => {
  it('has all required columns after migration', () => {
    const tableInfo = sqlite.prepare(`PRAGMA table_info(organizations)`).all() as { name: string }[];
    const columnNames = tableInfo.map((c) => c.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('slug');
    expect(columnNames).toContain('name');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('seat_limit');
    expect(columnNames).toContain('created_by');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  it('defaults status to "active" and seat_limit to 0', () => {
    sqlite.prepare(`INSERT INTO users (id, auth_type) VALUES ('u-org-defaults', 'fingerprint')`).run();
    sqlite.prepare(
      `INSERT INTO organizations (id, slug, name, created_by) VALUES ('org-d', 'org-defaults', 'Test Org', 'u-org-defaults')`,
    ).run();

    const row = sqlite.prepare(
      `SELECT status, seat_limit FROM organizations WHERE id = ?`,
    ).get('org-d') as { status: string; seat_limit: number };

    expect(row.status).toBe('active');
    expect(row.seat_limit).toBe(0);
  });

  it('can create an organization with suspended status and custom seat_limit', () => {
    sqlite.prepare(
      `INSERT INTO organizations (id, slug, name, status, seat_limit, created_by) VALUES ('org-susp', 'susp-org', 'Suspended', 'suspended', 50, 'u-org-defaults')`,
    ).run();

    const row = sqlite.prepare(
      `SELECT status, seat_limit FROM organizations WHERE id = ?`,
    ).get('org-susp') as { status: string; seat_limit: number };

    expect(row.status).toBe('suspended');
    expect(row.seat_limit).toBe(50);
  });
});

describe('US-005: organizations slug uniqueness', () => {
  it('prevents duplicate slug', () => {
    expect(() => {
      sqlite.prepare(
        `INSERT INTO organizations (id, slug, name, created_by) VALUES ('org-dup', 'org-defaults', 'Dup', 'u-org-defaults')`,
      ).run();
    }).toThrow();

    // Different slug should succeed
    expect(() => {
      sqlite.prepare(
        `INSERT INTO organizations (id, slug, name, created_by) VALUES ('org-ok', 'unique-slug-123', 'OK', 'u-org-defaults')`,
      ).run();
    }).not.toThrow();
  });
});

describe('US-005: organizations FK constraints', () => {
  it('rejects organization with non-existent created_by user', () => {
    expect(() => {
      sqlite.prepare(
        `INSERT INTO organizations (id, slug, name, created_by) VALUES ('org-bad-user', 'bad-user-org', 'Bad', 'non-existent-user')`,
      ).run();
    }).toThrow();
  });
});

describe('US-005: organization_memberships table structure', () => {
  it('has all required columns after migration', () => {
    const tableInfo = sqlite.prepare(`PRAGMA table_info(organization_memberships)`).all() as { name: string }[];
    const columnNames = tableInfo.map((c) => c.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('organization_id');
    expect(columnNames).toContain('user_id');
    expect(columnNames).toContain('role');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  it('defaults role to "member" and status to "active"', () => {
    sqlite.prepare(`INSERT INTO users (id, auth_type) VALUES ('u-memb-defaults', 'fingerprint')`).run();
    sqlite.prepare(
      `INSERT INTO organization_memberships (id, organization_id, user_id) VALUES ('memb-d', 'org-ok', 'u-memb-defaults')`,
    ).run();

    const row = sqlite.prepare(
      `SELECT role, status FROM organization_memberships WHERE id = ?`,
    ).get('memb-d') as { role: string; status: string };

    expect(row.role).toBe('member');
    expect(row.status).toBe('active');
  });

  it('can create a membership with org_admin role and removed status', () => {
    sqlite.prepare(`INSERT INTO users (id, auth_type) VALUES ('u-admin-memb', 'fingerprint')`).run();
    sqlite.prepare(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status) VALUES ('memb-admin', 'org-ok', 'u-admin-memb', 'org_admin', 'removed')`,
    ).run();

    const row = sqlite.prepare(
      `SELECT role, status FROM organization_memberships WHERE id = ?`,
    ).get('memb-admin') as { role: string; status: string };

    expect(row.role).toBe('org_admin');
    expect(row.status).toBe('removed');
  });
});

describe('US-005: membership FK constraints', () => {
  it('rejects membership with non-existent organization_id', () => {
    expect(() => {
      sqlite.prepare(
        `INSERT INTO organization_memberships (id, organization_id, user_id) VALUES ('memb-bad-org', 'non-existent-org', 'u-memb-defaults')`,
      ).run();
    }).toThrow();
  });

  it('rejects membership with non-existent user_id', () => {
    expect(() => {
      sqlite.prepare(
        `INSERT INTO organization_memberships (id, organization_id, user_id) VALUES ('memb-bad-user', 'org-ok', 'non-existent-user')`,
      ).run();
    }).toThrow();
  });
});

describe('US-005: compound unique constraint on (organization_id, user_id)', () => {
  it('prevents duplicate membership for same user in same org', () => {
    sqlite.prepare(`INSERT INTO users (id, auth_type) VALUES ('u-dup-memb', 'fingerprint')`).run();
    sqlite.prepare(
      `INSERT INTO organizations (id, slug, name, created_by) VALUES ('org-dup-memb', 'dup-memb-org', 'Dup Test', 'u-org-defaults')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO organization_memberships (id, organization_id, user_id) VALUES ('memb-orig', 'org-dup-memb', 'u-dup-memb')`,
    ).run();

    // Same (org_id, user_id) must fail — even with different role/status
    expect(() => {
      sqlite.prepare(
        `INSERT INTO organization_memberships (id, organization_id, user_id, role, status) VALUES ('memb-dup', 'org-dup-memb', 'u-dup-memb', 'org_admin', 'removed')`,
      ).run();
    }).toThrow();

    // Same user in a different org should succeed
    sqlite.prepare(
      `INSERT INTO organizations (id, slug, name, created_by) VALUES ('org-other', 'other-org', 'Other', 'u-org-defaults')`,
    ).run();
    expect(() => {
      sqlite.prepare(
        `INSERT INTO organization_memberships (id, organization_id, user_id) VALUES ('memb-other-org', 'org-other', 'u-dup-memb')`,
      ).run();
    }).not.toThrow();

    // Different user in the same org should succeed
    sqlite.prepare(`INSERT INTO users (id, auth_type) VALUES ('u-dup-other', 'fingerprint')`).run();
    expect(() => {
      sqlite.prepare(
        `INSERT INTO organization_memberships (id, organization_id, user_id) VALUES ('memb-other-user', 'org-dup-memb', 'u-dup-other')`,
      ).run();
    }).not.toThrow();
  });
});

describe('US-005: cascade delete works correctly', () => {
  it('deleting an organization cascades to its memberships', () => {
    sqlite.prepare(`INSERT INTO users (id, auth_type) VALUES ('u-cascade-org', 'fingerprint')`).run();
    sqlite.prepare(
      `INSERT INTO organizations (id, slug, name, created_by) VALUES ('org-cascade', 'cascade-org', 'Cascade', 'u-cascade-org')`,
    ).run();
    sqlite.prepare(`INSERT INTO users (id, auth_type) VALUES ('u-cascade-m1', 'fingerprint')`).run();
    sqlite.prepare(`INSERT INTO users (id, auth_type) VALUES ('u-cascade-m2', 'fingerprint')`).run();
    sqlite.prepare(
      `INSERT INTO organization_memberships (id, organization_id, user_id) VALUES ('memb-c1', 'org-cascade', 'u-cascade-m1')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO organization_memberships (id, organization_id, user_id) VALUES ('memb-c2', 'org-cascade', 'u-cascade-m2')`,
    ).run();

    // Verify memberships exist
    expect(
      (sqlite.prepare('SELECT count(*) as c FROM organization_memberships WHERE organization_id = ?').get('org-cascade') as { c: number }).c,
    ).toBe(2);

    // Delete the org — memberships should cascade
    sqlite.prepare(`DELETE FROM organizations WHERE id = 'org-cascade'`).run();

    expect(
      (sqlite.prepare('SELECT count(*) as c FROM organization_memberships WHERE organization_id = ?').get('org-cascade') as { c: number }).c,
    ).toBe(0);
  });

  it('deleting a user cascades to their memberships', () => {
    sqlite.prepare(`INSERT INTO users (id, auth_type) VALUES ('u-cascade-user', 'fingerprint')`).run();
    sqlite.prepare(
      `INSERT INTO organizations (id, slug, name, created_by) VALUES ('org-user-cascade', 'user-cascade-org', 'User Cascade', 'u-cascade-user')`,
    ).run();
    sqlite.prepare(`INSERT INTO users (id, auth_type) VALUES ('u-member-to-delete', 'fingerprint')`).run();
    sqlite.prepare(
      `INSERT INTO organization_memberships (id, organization_id, user_id) VALUES ('memb-uc1', 'org-user-cascade', 'u-member-to-delete')`,
    ).run();

    // Verify membership exists
    expect(
      (sqlite.prepare('SELECT count(*) as c FROM organization_memberships WHERE user_id = ?').get('u-member-to-delete') as { c: number }).c,
    ).toBe(1);

    // Delete the user — membership should cascade
    sqlite.prepare(`DELETE FROM users WHERE id = 'u-member-to-delete'`).run();

    expect(
      (sqlite.prepare('SELECT count(*) as c FROM organization_memberships WHERE user_id = ?').get('u-member-to-delete') as { c: number }).c,
    ).toBe(0);
  });
});

describe('US-005: indexes exist for common queries', () => {
  it('organization_memberships has indexes on user_id, organization_id, role, and compound status indexes', () => {
    const indexes = sqlite.prepare(`PRAGMA index_list('organization_memberships')`).all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('organization_memberships_user_id_idx');
    expect(indexNames).toContain('organization_memberships_organization_id_idx');
    expect(indexNames).toContain('organization_memberships_organization_id_status_idx');
    expect(indexNames).toContain('organization_memberships_user_id_status_idx');
    expect(indexNames).toContain('organization_memberships_role_idx');
    expect(indexNames).toContain('organization_memberships_organization_id_user_id_unique');
  });

  it('organizations has indexes on created_by and status', () => {
    const indexes = sqlite.prepare(`PRAGMA index_list('organizations')`).all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('organizations_created_by_idx');
    expect(indexNames).toContain('organizations_status_idx');
    expect(indexNames).toContain('organizations_slug_unique');
  });
});

describe('US-005: org roles are NOT stored on users.role (platform_role is independent)', () => {
  it('users.platform_role is separate from organization membership role', () => {
    // Create a user that is an org_admin in an org but has platform_role = 'user'
    sqlite.prepare(
      `INSERT INTO users (id, auth_type, platform_role) VALUES ('u-org-admin-platform', 'fingerprint', 'user')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO organizations (id, slug, name, created_by) VALUES ('org-role-test', 'role-test-org', 'Role Test', 'u-org-admin-platform')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ('memb-role-test', 'org-role-test', 'u-org-admin-platform', 'org_admin')`,
    ).run();

    // The user's platform_role should still be 'user', not 'org_admin'
    const userRow = sqlite.prepare(
      `SELECT platform_role FROM users WHERE id = ?`,
    ).get('u-org-admin-platform') as { platform_role: string };

    expect(userRow.platform_role).toBe('user');

    // The org role is only on the membership
    const membRow = sqlite.prepare(
      `SELECT role FROM organization_memberships WHERE id = ?`,
    ).get('memb-role-test') as { role: string };

    expect(membRow.role).toBe('org_admin');
  });
});

describe('US-005: PG schema exports organizations and organizationMemberships', () => {
  it('pg-schema.ts defines organizations and organizationMemberships tables', async () => {
    const pgSchemaSource = await import('./pg-schema');

    expect(pgSchemaSource.organizations).toBeDefined();
    expect(pgSchemaSource.organizationMemberships).toBeDefined();
  });
});
