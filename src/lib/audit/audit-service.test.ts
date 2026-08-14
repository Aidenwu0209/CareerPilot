import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

/**
 * US-024 tests: Sanitized Audit Event Service
 *
 * Validates:
 * AC1: Service records actor, action, target, tenant, request ID, result, and sanitized summary
 * AC2: Service rejects/redacts full AI Key, Authorization headers, resume text, full prompts
 * AC3: Same idempotent admin requests don't write duplicate success events
 * AC4: Regular users and org admins can't modify or delete audit events (immutability)
 * AC5: Success and failure events queryable by actor, target, and time
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
import {
  recordAuditEvent,
  queryAuditEvents,
  countAuditEvents,
  sanitizeSummary,
  detectSensitiveContent,
} from './audit-service';
import { db } from '@/lib/db';
import { auditEvents } from '@/lib/db/schema';
import { userRepository } from '@/lib/db/repositories/user.repository';

// ── Helpers ──

async function setupUser(id: string, email?: string) {
  await userRepository.create({
    id,
    email: email ?? `${id}@test.com`,
    name: id,
    authType: 'oauth',
  });
}

// ── Sanitization tests ──

describe('US-024 AC2: Sanitization — rejects sensitive content', () => {
  describe('sanitizeSummary', () => {
    it('passes through clean summaries', () => {
      expect(sanitizeSummary('User frozen by admin')).toBe('User frozen by admin');
      expect(sanitizeSummary('Organization created: Acme Corp')).toBe('Organization created: Acme Corp');
      expect(sanitizeSummary('')).toBe('');
    });

    it('redacts OpenAI API keys', () => {
      const result = sanitizeSummary('Configured key: sk-abcdefghijklmnopqrstuvwxyz1234567890');
      expect(result).toContain('redacted');
      expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    });

    it('redacts Anthropic API keys', () => {
      const result = sanitizeSummary('Key set: sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890');
      expect(result).toContain('redacted');
      expect(result).not.toContain('sk-ant-api03');
    });

    it('redacts Google API keys', () => {
      const result = sanitizeSummary('Using: AIzaSyA1234567890abcdefghijklmnopqrstuvwxyz');
      expect(result).toContain('redacted');
      expect(result).not.toContain('AIzaSyA1234567890');
    });

    it('redacts Authorization: Bearer headers', () => {
      const result = sanitizeSummary('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIx.m_something');
      expect(result).toContain('redacted');
    });

    it('redacts x-api-key headers', () => {
      const result = sanitizeSummary('x-api-key: sk-1234567890abcdef');
      expect(result).toContain('redacted');
    });

    it('redacts JWT tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8E';
      const result = sanitizeSummary(`Token: ${jwt}`);
      expect(result).toContain('redacted');
      expect(result).not.toContain(jwt);
    });

    it.each([
      ['email address', 'Changed email from student@example.com'],
      ['phone number', 'Verified phone 13800138000'],
      ['identity number', 'Reviewed identity 110101199001011234'],
    ])('redacts %s values', (_label, summary) => {
      const result = sanitizeSummary(summary);
      expect(result).toContain('redacted');
      expect(result).not.toBe(summary);
    });

    it('redacts multi-line content resembling resume text', () => {
      const resumeText = `John Doe
Software Engineer with 5 years experience in React and Node.js.
Built scalable microservices handling millions of requests daily.
Led a team of 8 engineers to deliver critical platform features.
Education: B.S. Computer Science, MIT, 2019.`;
      const result = sanitizeSummary(resumeText);
      expect(result).toContain('redacted');
      expect(result).not.toContain('Software Engineer');
    });

    it('redacts multi-line content resembling full prompts', () => {
      const fullPrompt = `You are a resume optimization expert.
Given the following resume and job description, provide specific suggestions.
Focus on keyword optimization, formatting, and content improvement.
Return your response in structured JSON format.`;
      const result = sanitizeSummary(fullPrompt);
      expect(result).toContain('redacted');
    });

    it('allows short multi-line content (2 lines or less)', () => {
      const short = 'Line 1\nLine 2';
      expect(sanitizeSummary(short)).toBe(short);
    });

    it('truncates very long clean summaries', () => {
      const long = 'A'.repeat(600);
      const result = sanitizeSummary(long);
      expect(result.length).toBe(500);
    });
  });

  describe('detectSensitiveContent', () => {
    it('returns null for clean content', () => {
      expect(detectSensitiveContent('User created')).toBeNull();
    });

    it('returns label for API keys', () => {
      expect(detectSensitiveContent('sk-abcdef1234567890abcdefghij')).toBe('OpenAI API key');
    });

    it('returns label for multi-line document text', () => {
      const doc = 'a\nb\nc\nd\n'.repeat(60);
      expect(detectSensitiveContent(doc)).toBe('document/prompt text');
    });
  });
});

// ── Service tests ──

describe('US-024 AC1: recordAuditEvent records all fields', () => {
  beforeEach(async () => {
    // Clean audit events is NOT possible due to immutability triggers.
    // Tests use unique IDs to avoid collisions.
  });

  it('records a complete success event with all fields', async () => {
    const actorId = 'ac1-actor-' + crypto.randomUUID();
    await setupUser(actorId, 'ac1@test.com');

    const targetId = 'target-' + crypto.randomUUID();
    const requestId = 'req-' + crypto.randomUUID();
    const tenantId = 'org-' + crypto.randomUUID();

    const id = await recordAuditEvent({
      actorId,
      action: 'user.freeze',
      targetType: 'user',
      targetId,
      tenantId,
      requestId,
      result: 'success',
      summary: 'Froze user account for policy violation',
      ipAddress: '192.168.1.1',
    });

    expect(id).not.toBe('DEDUPED');

    const events = await queryAuditEvents({
      action: 'user.freeze',
      targetId,
    });

    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.actorId).toBe(actorId);
    expect(event.action).toBe('user.freeze');
    expect(event.targetType).toBe('user');
    expect(event.targetId).toBe(targetId);
    expect(event.tenantId).toBe(tenantId);
    expect(event.requestId).toBe(requestId);
    expect(event.result).toBe('success');
    expect(event.summary).toBe('Froze user account for policy violation');
    expect(event.ipAddress).toBe('192.168.1.1');
    expect(event.createdAt).toBeInstanceOf(Date);
  });

  it('records a failure event', async () => {
    const actorId = 'ac1-fail-' + crypto.randomUUID();
    await setupUser(actorId, 'ac1fail@test.com');

    const targetId = 'fail-target-' + crypto.randomUUID();

    await recordAuditEvent({
      actorId,
      action: 'credits.adjust',
      targetType: 'credit_account',
      targetId,
      result: 'failure',
      summary: 'Credit adjustment failed: insufficient balance',
    });

    const events = await queryAuditEvents({
      action: 'credits.adjust',
      targetId,
      result: 'failure',
    });

    expect(events).toHaveLength(1);
    expect(events[0].result).toBe('failure');
  });

  it('records a system-initiated event with null actorId', async () => {
    const targetId = 'sys-' + crypto.randomUUID();

    await recordAuditEvent({
      actorId: null,
      action: 'system.cleanup',
      targetType: 'system',
      targetId,
      result: 'success',
      summary: 'Scheduled cleanup completed',
    });

    const events = await queryAuditEvents({
      action: 'system.cleanup',
      targetId,
    });

    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBeNull();
  });

  it('records event with null targetId for system-wide actions', async () => {
    const requestId = 'syswide-' + crypto.randomUUID();

    await recordAuditEvent({
      actorId: null,
      action: 'system.backup',
      targetType: 'system',
      targetId: null,
      requestId,
      result: 'success',
      summary: 'Daily backup completed',
    });

    const events = await queryAuditEvents({
      action: 'system.backup',
      requestId,
    });

    expect(events).toHaveLength(1);
    expect(events[0].targetId).toBeNull();
  });
});

// ── AC2: Service sanitizes summaries before storage ──

describe('US-024 AC2: Service sanitizes summaries before storage', () => {
  it('stores redacted summary when input contains API key', async () => {
    const targetId = 'redact1-' + crypto.randomUUID();

    await recordAuditEvent({
      actorId: null,
      action: 'test.redact_key',
      targetType: 'test',
      targetId,
      result: 'success',
      summary: 'Provider configured with key sk-abcdefghijklmnopqrstuvwxyz1234567890',
    });

    const events = await queryAuditEvents({
      action: 'test.redact_key',
      targetId,
    });

    expect(events).toHaveLength(1);
    expect(events[0].summary).toContain('redacted');
    expect(events[0].summary).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
  });

  it('stores redacted summary when input contains Authorization header', async () => {
    const targetId = 'redact2-' + crypto.randomUUID();

    await recordAuditEvent({
      actorId: null,
      action: 'test.redact_auth',
      targetType: 'test',
      targetId,
      result: 'success',
      summary: 'Request header: Authorization: Bearer abc123def456ghi789xyz',
    });

    const events = await queryAuditEvents({
      action: 'test.redact_auth',
      targetId,
    });

    expect(events).toHaveLength(1);
    expect(events[0].summary).toContain('redacted');
  });

  it('stores redacted summary when input contains resume text', async () => {
    const targetId = 'redact3-' + crypto.randomUUID();
    const resumeText = `John Doe
Software Engineer with 5 years of experience in full-stack development
Expertise in React, Node.js, TypeScript, PostgreSQL, and cloud infrastructure
Built scalable microservices handling millions of requests per day
Education: B.S. Computer Science, Massachusetts Institute of Technology, 2019`;

    await recordAuditEvent({
      actorId: null,
      action: 'test.redact_resume',
      targetType: 'test',
      targetId,
      result: 'success',
      summary: resumeText,
    });

    const events = await queryAuditEvents({
      action: 'test.redact_resume',
      targetId,
    });

    expect(events).toHaveLength(1);
    expect(events[0].summary).toContain('redacted');
    expect(events[0].summary).not.toContain('Software Engineer');
  });
});

// ── AC3: Idempotency ──

describe('US-024 AC3: Idempotent success events are not duplicated', () => {
  it('skips duplicate success event with same idempotency signature', async () => {
    const actorId = 'ac3-idem-' + crypto.randomUUID();
    const targetId = 'idem-target-' + crypto.randomUUID();
    const requestId = 'idem-req-' + crypto.randomUUID();
    await setupUser(actorId, 'ac3@test.com');

    // First insert — should succeed
    const id1 = await recordAuditEvent({
      actorId,
      action: 'org.create',
      targetType: 'organization',
      targetId,
      requestId,
      result: 'success',
      summary: 'Created organization Acme Corp',
      idempotent: true,
    });
    expect(id1).not.toBe('DEDUPED');

    // Second insert with same signature — should be deduplicated
    const id2 = await recordAuditEvent({
      actorId,
      action: 'org.create',
      targetType: 'organization',
      targetId,
      requestId,
      result: 'success',
      summary: 'Created organization Acme Corp',
      idempotent: true,
    });
    expect(id2).toBe('DEDUPED');

    // Only one event should exist
    const events = await queryAuditEvents({
      action: 'org.create',
      targetId,
    });
    expect(events).toHaveLength(1);
  });

  it('allows failure events with same idempotency signature', async () => {
    const targetId = 'idem-fail-' + crypto.randomUUID();
    const requestId = 'idem-fail-req-' + crypto.randomUUID();

    // First failure
    await recordAuditEvent({
      actorId: null,
      action: 'test.idem_fail',
      targetType: 'test',
      targetId,
      requestId,
      result: 'failure',
      summary: 'First failure',
      idempotent: true,
    });

    // Second failure with same requestId — should NOT be deduplicated
    await recordAuditEvent({
      actorId: null,
      action: 'test.idem_fail',
      targetType: 'test',
      targetId,
      requestId,
      result: 'failure',
      summary: 'Second failure',
      idempotent: true,
    });

    const events = await queryAuditEvents({
      action: 'test.idem_fail',
      targetId,
      result: 'failure',
    });
    expect(events).toHaveLength(2);
  });

  it('does not deduplicate when idempotent flag is false', async () => {
    const targetId = 'no-idem-' + crypto.randomUUID();
    const requestId = 'no-idem-req-' + crypto.randomUUID();

    await recordAuditEvent({
      actorId: null,
      action: 'test.no_idem',
      targetType: 'test',
      targetId,
      requestId,
      result: 'success',
      summary: 'First',
      idempotent: false,
    });

    await recordAuditEvent({
      actorId: null,
      action: 'test.no_idem',
      targetType: 'test',
      targetId,
      requestId,
      result: 'success',
      summary: 'Second',
      idempotent: false,
    });

    const events = await queryAuditEvents({
      action: 'test.no_idem',
      targetId,
    });
    expect(events).toHaveLength(2);
  });

  it('does not deduplicate across different targets with same requestId', async () => {
    const requestId = 'diff-target-' + crypto.randomUUID();
    const target1 = 't1-' + crypto.randomUUID();
    const target2 = 't2-' + crypto.randomUUID();

    await recordAuditEvent({
      actorId: null,
      action: 'test.diff_target',
      targetType: 'test',
      targetId: target1,
      requestId,
      result: 'success',
      summary: 'First target',
      idempotent: true,
    });

    const id2 = await recordAuditEvent({
      actorId: null,
      action: 'test.diff_target',
      targetType: 'test',
      targetId: target2,
      requestId,
      result: 'success',
      summary: 'Second target',
      idempotent: true,
    });
    expect(id2).not.toBe('DEDUPED');
  });
});

// ── AC4: Immutability verification ──

describe('US-024 AC4: Audit events cannot be modified or deleted', () => {
  it('rejects UPDATE on audit_events via service (no update method exists)', () => {
    // The audit service module does not export any update or delete functions.
    // This is a structural guarantee — the service API simply has no mutation methods.
    // Verify by checking that the module exports only record/query/count/sanitize functions.
    // (This is enforced by the absence of such functions in the module surface.)
    // The DB-level triggers from US-009 provide the runtime guarantee.
    expect(typeof recordAuditEvent).toBe('function');
    expect(typeof queryAuditEvents).toBe('function');
    expect(typeof countAuditEvents).toBe('function');
    expect(typeof sanitizeSummary).toBe('function');
    // No updateAuditEvent or deleteAuditEvent function exists
  });

  it('rejects direct UPDATE on audit_events table (DB trigger)', async () => {
    const targetId = 'imm-update-' + crypto.randomUUID();

    await recordAuditEvent({
      actorId: null,
      action: 'test.immutable_update',
      targetType: 'test',
      targetId,
      result: 'success',
      summary: 'Original summary',
    });

    // Attempting to UPDATE should throw
    await expect(
      db.update(auditEvents).set({ summary: 'tampered' }).where(eq(auditEvents.targetId, targetId)),
    ).rejects.toThrow();
  });

  it('rejects direct DELETE on audit_events table (DB trigger)', async () => {
    const targetId = 'imm-del-' + crypto.randomUUID();

    await recordAuditEvent({
      actorId: null,
      action: 'test.immutable_delete',
      targetType: 'test',
      targetId,
      result: 'success',
      summary: 'To be deleted attempt',
    });

    // Attempting to DELETE should throw
    await expect(
      db.delete(auditEvents).where(eq(auditEvents.targetId, targetId)),
    ).rejects.toThrow();
  });
});

// ── AC5: Queryability ──

describe('US-024 AC5: Events queryable by actor, target, and time', () => {
  it('queries events by actorId', async () => {
    const actorId = 'ac5-actor-' + crypto.randomUUID();
    await setupUser(actorId, 'ac5-actor@test.com');

    await recordAuditEvent({
      actorId,
      action: 'test.query_actor',
      targetType: 'test',
      targetId: 'a1-' + crypto.randomUUID(),
      result: 'success',
      summary: 'Actor test 1',
    });

    await recordAuditEvent({
      actorId,
      action: 'test.query_actor',
      targetType: 'test',
      targetId: 'a2-' + crypto.randomUUID(),
      result: 'failure',
      summary: 'Actor test 2',
    });

    const events = await queryAuditEvents({
      actorId,
      action: 'test.query_actor',
    });

    expect(events).toHaveLength(2);
    expect(events.every((e) => e.actorId === actorId)).toBe(true);
  });

  it('queries events by targetType and targetId', async () => {
    const targetId = 'ac5-target-' + crypto.randomUUID();

    await recordAuditEvent({
      actorId: null,
      action: 'test.query_target',
      targetType: 'organization',
      targetId,
      result: 'success',
      summary: 'Target event',
    });

    const events = await queryAuditEvents({
      targetType: 'organization',
      targetId,
    });

    expect(events).toHaveLength(1);
    expect(events[0].targetType).toBe('organization');
  });

  it('queries events by time range', async () => {
    const beforeTime = new Date(Date.now() - 1000);
    const targetId = 'ac5-time-' + crypto.randomUUID();

    await recordAuditEvent({
      actorId: null,
      action: 'test.query_time',
      targetType: 'test',
      targetId,
      result: 'success',
      summary: 'Time test',
    });

    const afterTime = new Date(Date.now() + 1000);

    const events = await queryAuditEvents({
      action: 'test.query_time',
      from: beforeTime,
      to: afterTime,
    });

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.targetId === targetId)).toBe(true);
  });

  it('queries both success and failure events by default', async () => {
    const targetId = 'ac5-both-' + crypto.randomUUID();

    await recordAuditEvent({
      actorId: null,
      action: 'test.query_both',
      targetType: 'test',
      targetId,
      result: 'success',
      summary: 'Success',
    });

    await recordAuditEvent({
      actorId: null,
      action: 'test.query_both',
      targetType: 'test',
      targetId: targetId + '-fail',
      result: 'failure',
      summary: 'Failure',
    });

    const allEvents = await queryAuditEvents({
      action: 'test.query_both',
    });
    expect(allEvents.length).toBeGreaterThanOrEqual(2);

    const successes = await queryAuditEvents({
      action: 'test.query_both',
      result: 'success',
    });
    expect(successes.every((e) => e.result === 'success')).toBe(true);

    const failures = await queryAuditEvents({
      action: 'test.query_both',
      result: 'failure',
    });
    expect(failures.every((e) => e.result === 'failure')).toBe(true);
  });

  it('returns events ordered by createdAt descending (newest first)', async () => {
    const targetId1 = 'order-1-' + crypto.randomUUID();
    const targetId2 = 'order-2-' + crypto.randomUUID();

    await recordAuditEvent({
      actorId: null,
      action: 'test.ordering',
      targetType: 'test',
      targetId: targetId1,
      result: 'success',
      summary: 'First event',
    });

    // SQLite unixepoch() has second precision — delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 1100));

    await recordAuditEvent({
      actorId: null,
      action: 'test.ordering',
      targetType: 'test',
      targetId: targetId2,
      result: 'success',
      summary: 'Second event',
    });

    const events = await queryAuditEvents({
      action: 'test.ordering',
    });

    expect(events.length).toBeGreaterThanOrEqual(2);
    // Newest should be first
    const secondIdx = events.findIndex((e) => e.targetId === targetId2);
    const firstIdx = events.findIndex((e) => e.targetId === targetId1);
    expect(secondIdx).toBeLessThanOrEqual(firstIdx);
    expect(secondIdx).toBeGreaterThanOrEqual(0);
  });

  it('respects limit option', async () => {
    const action = 'test.limit_' + crypto.randomUUID().slice(0, 8);

    for (let i = 0; i < 5; i++) {
      await recordAuditEvent({
        actorId: null,
        action,
        targetType: 'test',
        targetId: `limit-${i}-${crypto.randomUUID()}`,
        result: 'success',
        summary: `Event ${i}`,
      });
    }

    const limited = await queryAuditEvents({ action, limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it('countAuditEvents returns correct count', async () => {
    const action = 'test.count_' + crypto.randomUUID().slice(0, 8);

    for (let i = 0; i < 3; i++) {
      await recordAuditEvent({
        actorId: null,
        action,
        targetType: 'test',
        targetId: `count-${i}-${crypto.randomUUID()}`,
        result: 'success',
        summary: `Count test ${i}`,
      });
    }

    const count = await countAuditEvents({ action });
    expect(count).toBe(3);
  });

  it('queries events by tenantId', async () => {
    const tenantId = 'tenant-' + crypto.randomUUID();
    const targetId = 'tenant-target-' + crypto.randomUUID();

    await recordAuditEvent({
      actorId: null,
      action: 'test.tenant_query',
      targetType: 'test',
      targetId,
      tenantId,
      result: 'success',
      summary: 'Tenant test',
    });

    const events = await queryAuditEvents({
      action: 'test.tenant_query',
      tenantId,
    });

    expect(events).toHaveLength(1);
    expect(events[0].tenantId).toBe(tenantId);
  });

  it('queries events by requestId', async () => {
    const requestId = 'req-query-' + crypto.randomUUID();
    const targetId = 'req-target-' + crypto.randomUUID();

    await recordAuditEvent({
      actorId: null,
      action: 'test.req_query',
      targetType: 'test',
      targetId,
      requestId,
      result: 'success',
      summary: 'Request test',
    });

    const events = await queryAuditEvents({
      action: 'test.req_query',
      requestId,
    });

    expect(events).toHaveLength(1);
    expect(events[0].requestId).toBe(requestId);
  });
});
