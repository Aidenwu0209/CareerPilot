import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'path';
import * as schema from './schema';

/**
 * US-009 tests: Audit events and legal consent schema integrity.
 *
 * Verifies:
 * - audit_events: actor, action, target, tenant, request_id, result, sanitized summary, timestamps
 * - legal_consents: user, document type, version, effective date, consent time, source
 * - Immutability: both tables reject UPDATE and DELETE via triggers
 * - Indexes: actor, target, tenant, time queries supported
 * - FK constraints: valid references enforced
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

// ── Helper: insert prerequisite user ──

function setupUser(id: string, email?: string) {
  sqlite
    .prepare(
      `INSERT INTO users (id, email, auth_type) VALUES (?, ?, 'oauth')`,
    )
    .run(id, email ?? `${id}@test.com`);
}

// ── audit_events ──

describe('US-009: audit_events table structure', () => {
  it('has all required columns after migration', () => {
    const tableInfo = sqlite.prepare('PRAGMA table_info(audit_events)').all() as { name: string }[];
    const columnNames = tableInfo.map((c) => c.name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('actor_id');
    expect(columnNames).toContain('action');
    expect(columnNames).toContain('target_type');
    expect(columnNames).toContain('target_id');
    expect(columnNames).toContain('tenant_id');
    expect(columnNames).toContain('request_id');
    expect(columnNames).toContain('result');
    expect(columnNames).toContain('summary');
    expect(columnNames).toContain('ip_address');
    expect(columnNames).toContain('created_at');
  });

  it('defaults result to success and summary to empty string', () => {
    setupUser('user-audit-defaults');

    sqlite
      .prepare(
        `INSERT INTO audit_events (id, actor_id, action, target_type)
         VALUES ('evt-defaults', 'user-audit-defaults', 'user.login', 'user')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT result, summary FROM audit_events WHERE id = ?')
      .get('evt-defaults') as { result: string; summary: string };
    expect(row.result).toBe('success');
    expect(row.summary).toBe('');
  });

  it('stores action and target_type for business context', () => {
    setupUser('user-audit-action');

    sqlite
      .prepare(
        `INSERT INTO audit_events (id, actor_id, action, target_type, target_id, result, summary)
         VALUES ('evt-action', 'user-audit-action', 'org.create', 'organization', 'org-123', 'success', 'Created org "TestCorp"')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT action, target_type, target_id, summary FROM audit_events WHERE id = ?')
      .get('evt-action') as { action: string; target_type: string; target_id: string; summary: string };
    expect(row.action).toBe('org.create');
    expect(row.target_type).toBe('organization');
    expect(row.target_id).toBe('org-123');
    expect(row.summary).toBe('Created org "TestCorp"');
  });

  it('supports both success and failure results', () => {
    setupUser('user-audit-result');

    for (const result of ['success', 'failure']) {
      sqlite
        .prepare(
          `INSERT INTO audit_events (id, actor_id, action, target_type, result)
           VALUES (?, 'user-audit-result', 'test.action', 'system', ?)`,
        )
        .run(`evt-${result}`, result);
    }

    for (const result of ['success', 'failure']) {
      const row = sqlite
        .prepare('SELECT result FROM audit_events WHERE id = ?')
        .get(`evt-${result}`) as { result: string };
      expect(row.result).toBe(result);
    }
  });

  it('actor_id is nullable for system-initiated events', () => {
    sqlite
      .prepare(
        `INSERT INTO audit_events (id, action, target_type)
         VALUES ('evt-system', 'system.bootstrap', 'system')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT actor_id FROM audit_events WHERE id = ?')
      .get('evt-system') as { actor_id: string | null };
    expect(row.actor_id).toBeNull();
  });

  it('target_id is nullable for system-wide actions', () => {
    setupUser('user-audit-no-target');

    sqlite
      .prepare(
        `INSERT INTO audit_events (id, actor_id, action, target_type)
         VALUES ('evt-no-target', 'user-audit-no-target', 'config.update', 'system')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT target_id FROM audit_events WHERE id = ?')
      .get('evt-no-target') as { target_id: string | null };
    expect(row.target_id).toBeNull();
  });

  it('tenant_id is nullable for platform-level events', () => {
    setupUser('user-audit-no-tenant');

    sqlite
      .prepare(
        `INSERT INTO audit_events (id, actor_id, action, target_type)
         VALUES ('evt-no-tenant', 'user-audit-no-tenant', 'user.view', 'user')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT tenant_id FROM audit_events WHERE id = ?')
      .get('evt-no-tenant') as { tenant_id: string | null };
    expect(row.tenant_id).toBeNull();
  });

  it('stores request_id for correlation', () => {
    setupUser('user-audit-req');

    sqlite
      .prepare(
        `INSERT INTO audit_events (id, actor_id, action, target_type, request_id)
         VALUES ('evt-req', 'user-audit-req', 'provider.rotate', 'provider', 'req-correlation-abc')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT request_id FROM audit_events WHERE id = ?')
      .get('evt-req') as { request_id: string };
    expect(row.request_id).toBe('req-correlation-abc');
  });

  it('stores sanitized ip_address', () => {
    setupUser('user-audit-ip');

    sqlite
      .prepare(
        `INSERT INTO audit_events (id, actor_id, action, target_type, ip_address)
         VALUES ('evt-ip', 'user-audit-ip', 'user.login', 'user', '192.168.1.1')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT ip_address FROM audit_events WHERE id = ?')
      .get('evt-ip') as { ip_address: string };
    expect(row.ip_address).toBe('192.168.1.1');
  });
});

describe('US-009: audit_events FK constraints', () => {
  it('rejects event with non-existent actor_id', () => {
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO audit_events (id, actor_id, action, target_type)
           VALUES ('evt-fk-actor', 'nonexistent-user', 'test.action', 'system')`,
        )
        .run();
    }).toThrow();
  });

  it('accepts null actor_id for system events', () => {
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO audit_events (id, action, target_type)
           VALUES ('evt-fk-null-actor', 'system.cron', 'system')`,
        )
        .run();
    }).not.toThrow();
  });
});

describe('US-009: audit_events immutability', () => {
  it('rejects UPDATE on audit_events', () => {
    setupUser('user-audit-immut');

    sqlite
      .prepare(
        `INSERT INTO audit_events (id, actor_id, action, target_type, summary)
         VALUES ('evt-immut', 'user-audit-immut', 'user.freeze', 'user', 'original')`,
      )
      .run();

    expect(() => {
      sqlite
        .prepare('UPDATE audit_events SET summary = \'tampered\' WHERE id = ?')
        .run('evt-immut');
    }).toThrow();
  });

  it('rejects DELETE on audit_events', () => {
    setupUser('user-audit-immut-del');

    sqlite
      .prepare(
        `INSERT INTO audit_events (id, actor_id, action, target_type)
         VALUES ('evt-immut-del', 'user-audit-immut-del', 'user.freeze', 'user')`,
      )
      .run();

    expect(() => {
      sqlite.prepare('DELETE FROM audit_events WHERE id = ?').run('evt-immut-del');
    }).toThrow();
  });
});

// ── legal_consents ──

describe('US-009: legal_consents table structure', () => {
  it('has all required columns after migration', () => {
    const tableInfo = sqlite.prepare('PRAGMA table_info(legal_consents)').all() as { name: string }[];
    const columnNames = tableInfo.map((c) => c.name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('user_id');
    expect(columnNames).toContain('document_type');
    expect(columnNames).toContain('version');
    expect(columnNames).toContain('effective_date');
    expect(columnNames).toContain('source');
    expect(columnNames).toContain('ip_address');
    expect(columnNames).toContain('created_at');
  });

  it('stores privacy_policy consent', () => {
    setupUser('user-consent-pp');

    const effectiveDate = Math.floor(Date.now() / 1000);
    sqlite
      .prepare(
        `INSERT INTO legal_consents (id, user_id, document_type, version, effective_date, source)
         VALUES ('consent-pp', 'user-consent-pp', 'privacy_policy', '2026-01-01-v1', ?, 'registration')`,
      )
      .run(effectiveDate);

    const row = sqlite
      .prepare('SELECT document_type, version, source FROM legal_consents WHERE id = ?')
      .get('consent-pp') as { document_type: string; version: string; source: string };
    expect(row.document_type).toBe('privacy_policy');
    expect(row.version).toBe('2026-01-01-v1');
    expect(row.source).toBe('registration');
  });

  it('stores terms_of_service consent', () => {
    setupUser('user-consent-tos');

    const effectiveDate = Math.floor(Date.now() / 1000);
    sqlite
      .prepare(
        `INSERT INTO legal_consents (id, user_id, document_type, version, effective_date, source)
         VALUES ('consent-tos', 'user-consent-tos', 'terms_of_service', '2026-01-01-v1', ?, 'registration')`,
      )
      .run(effectiveDate);

    const row = sqlite
      .prepare('SELECT document_type, version FROM legal_consents WHERE id = ?')
      .get('consent-tos') as { document_type: string; version: string };
    expect(row.document_type).toBe('terms_of_service');
    expect(row.version).toBe('2026-01-01-v1');
  });

  it('supports all source values', () => {
    setupUser('user-consent-sources');

    const sources = ['registration', 'explicit_reconsent', 'login'];
    const effectiveDate = Math.floor(Date.now() / 1000);
    for (const source of sources) {
      sqlite
        .prepare(
          `INSERT INTO legal_consents (id, user_id, document_type, version, effective_date, source)
           VALUES (?, 'user-consent-sources', 'privacy_policy', '2026-01-01-v1', ?, ?)`,
        )
        .run(`consent-${source}`, effectiveDate, source);
    }

    for (const source of sources) {
      const row = sqlite
        .prepare('SELECT source FROM legal_consents WHERE id = ?')
        .get(`consent-${source}`) as { source: string };
      expect(row.source).toBe(source);
    }
  });

  it('stores effective_date as the document version effective date', () => {
    setupUser('user-consent-eff');

    const docEffectiveDate = Math.floor(new Date('2026-01-01').getTime() / 1000);
    sqlite
      .prepare(
        `INSERT INTO legal_consents (id, user_id, document_type, version, effective_date, source)
         VALUES ('consent-eff', 'user-consent-eff', 'privacy_policy', '2026-01-01-v1', ?, 'registration')`,
      )
      .run(docEffectiveDate);

    const row = sqlite
      .prepare('SELECT effective_date, created_at FROM legal_consents WHERE id = ?')
      .get('consent-eff') as { effective_date: number; created_at: number };
    expect(row.effective_date).toBe(docEffectiveDate);
    // created_at is set by default (unixepoch), should be close to now
    expect(row.created_at).toBeGreaterThan(0);
  });

  it('stores sanitized ip_address', () => {
    setupUser('user-consent-ip');

    const effectiveDate = Math.floor(Date.now() / 1000);
    sqlite
      .prepare(
        `INSERT INTO legal_consents (id, user_id, document_type, version, effective_date, source, ip_address)
         VALUES ('consent-ip', 'user-consent-ip', 'privacy_policy', '2026-01-01-v1', ?, 'registration', '10.0.0.1')`,
      )
      .run(effectiveDate);

    const row = sqlite
      .prepare('SELECT ip_address FROM legal_consents WHERE id = ?')
      .get('consent-ip') as { ip_address: string };
    expect(row.ip_address).toBe('10.0.0.1');
  });

  it('ip_address is nullable', () => {
    setupUser('user-consent-no-ip');

    const effectiveDate = Math.floor(Date.now() / 1000);
    sqlite
      .prepare(
        `INSERT INTO legal_consents (id, user_id, document_type, version, effective_date, source)
         VALUES ('consent-no-ip', 'user-consent-no-ip', 'privacy_policy', '2026-01-01-v1', ?, 'registration')`,
      )
      .run(effectiveDate);

    const row = sqlite
      .prepare('SELECT ip_address FROM legal_consents WHERE id = ?')
      .get('consent-no-ip') as { ip_address: string | null };
    expect(row.ip_address).toBeNull();
  });
});

describe('US-009: legal_consents FK constraints', () => {
  it('rejects consent with non-existent user_id', () => {
    const effectiveDate = Math.floor(Date.now() / 1000);
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO legal_consents (id, user_id, document_type, version, effective_date, source)
           VALUES ('consent-fk-user', 'nonexistent-user', 'privacy_policy', '2026-01-01-v1', ?, 'registration')`,
        )
        .run(effectiveDate);
    }).toThrow();
  });
});

describe('US-009: legal_consents immutability', () => {
  it('rejects UPDATE on legal_consents', () => {
    setupUser('user-consent-immut');
    const effectiveDate = Math.floor(Date.now() / 1000);

    sqlite
      .prepare(
        `INSERT INTO legal_consents (id, user_id, document_type, version, effective_date, source)
         VALUES ('consent-immut', 'user-consent-immut', 'privacy_policy', '2026-01-01-v1', ?, 'registration')`,
      )
      .run(effectiveDate);

    expect(() => {
      sqlite
        .prepare('UPDATE legal_consents SET version = \'tampered\' WHERE id = ?')
        .run('consent-immut');
    }).toThrow();
  });

  it('rejects DELETE on legal_consents', () => {
    setupUser('user-consent-immut-del');
    const effectiveDate = Math.floor(Date.now() / 1000);

    sqlite
      .prepare(
        `INSERT INTO legal_consents (id, user_id, document_type, version, effective_date, source)
         VALUES ('consent-immut-del', 'user-consent-immut-del', 'privacy_policy', '2026-01-01-v1', ?, 'registration')`,
      )
      .run(effectiveDate);

    expect(() => {
      sqlite.prepare('DELETE FROM legal_consents WHERE id = ?').run('consent-immut-del');
    }).toThrow();
  });
});

// ── Consent history: multiple versions per user ──

describe('US-009: legal_consents supports version history', () => {
  it('user can have multiple consent records for different versions', () => {
    setupUser('user-consent-history');
    const effDate1 = Math.floor(new Date('2026-01-01').getTime() / 1000);
    const effDate2 = Math.floor(new Date('2026-06-01').getTime() / 1000);

    // Initial consent at registration
    sqlite
      .prepare(
        `INSERT INTO legal_consents (id, user_id, document_type, version, effective_date, source)
         VALUES ('consent-h1', 'user-consent-history', 'privacy_policy', '2026-01-01-v1', ?, 'registration')`,
      )
      .run(effDate1);

    // Re-consent to new version
    sqlite
      .prepare(
        `INSERT INTO legal_consents (id, user_id, document_type, version, effective_date, source)
         VALUES ('consent-h2', 'user-consent-history', 'privacy_policy', '2026-06-01-v1', ?, 'explicit_reconsent')`,
      )
      .run(effDate2);

    // Both records should exist (history preserved)
    const rows = sqlite
      .prepare('SELECT version, source FROM legal_consents WHERE user_id = ? ORDER BY effective_date')
      .all('user-consent-history') as { version: string; source: string }[];
    expect(rows).toHaveLength(2);
    expect(rows[0].version).toBe('2026-01-01-v1');
    expect(rows[0].source).toBe('registration');
    expect(rows[1].version).toBe('2026-06-01-v1');
    expect(rows[1].source).toBe('explicit_reconsent');
  });

  it('user can have consents for different document types', () => {
    setupUser('user-consent-multi-doc');
    const effDate = Math.floor(Date.now() / 1000);

    sqlite
      .prepare(
        `INSERT INTO legal_consents (id, user_id, document_type, version, effective_date, source)
         VALUES ('consent-pp-multi', 'user-consent-multi-doc', 'privacy_policy', '2026-01-01-v1', ?, 'registration')`,
      )
      .run(effDate);

    sqlite
      .prepare(
        `INSERT INTO legal_consents (id, user_id, document_type, version, effective_date, source)
         VALUES ('consent-tos-multi', 'user-consent-multi-doc', 'terms_of_service', '2026-01-01-v1', ?, 'registration')`,
      )
      .run(effDate);

    const rows = sqlite
      .prepare('SELECT document_type FROM legal_consents WHERE user_id = ? ORDER BY document_type')
      .all('user-consent-multi-doc') as { document_type: string }[];
    expect(rows).toHaveLength(2);
    expect(rows[0].document_type).toBe('privacy_policy');
    expect(rows[1].document_type).toBe('terms_of_service');
  });
});

// ── Index verification ──

describe('US-009: audit_events indexes', () => {
  it('has index on actor_id', () => {
    const indexes = sqlite.prepare('PRAGMA index_list(audit_events)').all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('audit_events_actor_id_idx');
  });

  it('has index on action', () => {
    const indexes = sqlite.prepare('PRAGMA index_list(audit_events)').all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('audit_events_action_idx');
  });

  it('has compound index on target_type and target_id', () => {
    const indexes = sqlite.prepare('PRAGMA index_list(audit_events)').all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('audit_events_target_type_target_id_idx');
  });

  it('has index on tenant_id', () => {
    const indexes = sqlite.prepare('PRAGMA index_list(audit_events)').all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('audit_events_tenant_id_idx');
  });

  it('has index on created_at', () => {
    const indexes = sqlite.prepare('PRAGMA index_list(audit_events)').all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('audit_events_created_at_idx');
  });

  it('has compound index on actor_id and created_at', () => {
    const indexes = sqlite.prepare('PRAGMA index_list(audit_events)').all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('audit_events_actor_id_created_at_idx');
  });

  it('has compound index on tenant_id and created_at', () => {
    const indexes = sqlite.prepare('PRAGMA index_list(audit_events)').all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('audit_events_tenant_id_created_at_idx');
  });
});

describe('US-009: legal_consents indexes', () => {
  it('has index on user_id', () => {
    const indexes = sqlite.prepare('PRAGMA index_list(legal_consents)').all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('legal_consents_user_id_idx');
  });

  it('has compound index on user_id and document_type', () => {
    const indexes = sqlite.prepare('PRAGMA index_list(legal_consents)').all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('legal_consents_user_id_document_type_idx');
  });

  it('has compound index on document_type and version', () => {
    const indexes = sqlite.prepare('PRAGMA index_list(legal_consents)').all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('legal_consents_document_type_version_idx');
  });

  it('has index on created_at', () => {
    const indexes = sqlite.prepare('PRAGMA index_list(legal_consents)').all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('legal_consents_created_at_idx');
  });
});

// ── PG schema verification ──

describe('US-009: PG schema defines audit and consent tables', () => {
  it('pg-schema.ts exports auditEvents and legalConsents', async () => {
    const pgSchema = await import('./pg-schema');
    expect(pgSchema.auditEvents).toBeDefined();
    expect(pgSchema.legalConsents).toBeDefined();
  });
});
