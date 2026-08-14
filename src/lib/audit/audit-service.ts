/**
 * Sanitized Audit Event Service
 *
 * The single entry point for recording administrative and security-relevant
 * actions. Every high-privilege operation (user freeze, org lifecycle, credit
 * adjustment, provider rotation, etc.) MUST go through this service so that
 * the audit trail is consistent and safe.
 *
 * Design goals (US-024):
 * - Records actor, action, target, tenant, request ID, result, and a sanitized summary.
 * - Rejects / redacts full AI keys, Authorization headers, resume text, and full prompts
 *   before they are written to the `summary` column.
 * - Idempotent: when `requestId` is provided as an idempotency key, a matching existing
 *   success event prevents a duplicate insert.
 * - Queryable by actor, target, and time for test verification and admin review.
 *
 * Immutability of audit_events is enforced at the database layer (triggers),
 * so this service never exposes update or delete methods.
 */

import { db } from '@/lib/db';
import { auditEvents } from '@/lib/db/schema';
import { eq, and, gte, lte, desc, sql, isNull } from 'drizzle-orm';

// ── Types ──

export interface AuditEventInput {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  tenantId?: string | null;
  /**
   * Request correlation ID. When provided alongside `idempotent: true`, serves
   * as the deduplication key — if a success event already exists for the same
   * (action, targetId, requestId) tuple, the new event is skipped.
   */
  requestId?: string | null;
  result: 'success' | 'failure';
  summary: string;
  ipAddress?: string | null;
  /**
   * When true and requestId is set, the service deduplicates success events.
   * A matching success event for the same (action, targetId, requestId) tuple
   * prevents a duplicate insert and returns 'DEDUPED'.
   */
  idempotent?: boolean;
}

export interface AuditEventRecord {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  tenantId: string | null;
  requestId: string | null;
  result: 'success' | 'failure';
  summary: string;
  ipAddress: string | null;
  createdAt: Date;
}

export interface AuditQueryOptions {
  actorId?: string;
  targetType?: string;
  targetId?: string;
  action?: string;
  tenantId?: string;
  result?: 'success' | 'failure';
  requestId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

// ── Sanitization ──

/**
 * Patterns that indicate sensitive content which must never appear in an audit summary.
 * If any match, the summary is replaced with a redaction notice.
 */
const SENSITIVE_PATTERNS: { pattern: RegExp; label: string }[] = [
  // OpenAI-style API keys
  { pattern: /sk-[Aa]nt-[A-Za-z0-9_-]{20,}/, label: 'Anthropic API key' },
  { pattern: /sk-[A-Za-z0-9]{20,}/, label: 'OpenAI API key' },
  // Google/Gemini API keys
  { pattern: /AIza[A-Za-z0-9_-]{30,}/, label: 'Google API key' },
  // Generic Authorization header
  { pattern: /[Aa]uthorization\s*:\s*[Bb]earer\s+[A-Za-z0-9._\-+/=]{10,}/, label: 'Authorization header' },
  // x-api-key header with value
  { pattern: /x-api-key\s*:\s*[A-Za-z0-9_\-]{10,}/i, label: 'x-api-key header' },
  // JWT tokens (three base64url segments)
  { pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, label: 'JWT token' },
  // Password-like JSON/form fields. Audit summaries should only identify the action performed.
  { pattern: /["']?(?:password|newPassword|confirmPassword)["']?\s*[:=]\s*["'][^"']+["']/i, label: 'password field' },
  // Common personal identifiers. Audit summaries should use record IDs or explicitly masked values.
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, label: 'email address' },
  { pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/, label: 'phone number' },
  { pattern: /(?<!\d)\d{17}[\dXx](?!\d)/, label: 'identity number' },
];

/** Maximum allowed summary length — prevents accidental logging of large content. */
const MAX_SUMMARY_LENGTH = 500;

/** Multi-line content exceeding this length is treated as document/prompt text. */
const LARGE_CONTENT_THRESHOLD = 200;

/**
 * Sanitizes a summary string for safe storage in an audit event.
 *
 * Returns a clean summary if no sensitive content is detected, or a redaction
 * notice if the input contains API keys, auth headers, resume text, or full prompts.
 */
export function sanitizeSummary(raw: string): string {
  // Check for sensitive patterns — if found, return a safe placeholder
  for (const { pattern, label } of SENSITIVE_PATTERNS) {
    if (pattern.test(raw)) {
      return `[redacted: ${label} detected in summary]`;
    }
  }

  // Detect multi-line content that looks like resume text or a full prompt.
  // Audit summaries should be concise single-line descriptions.
  const lineCount = (raw.match(/\n/g) || []).length;
  if (lineCount >= 3 && raw.length > LARGE_CONTENT_THRESHOLD) {
    return '[redacted: multi-line content resembling document/prompt text]';
  }

  // Truncate to max length
  if (raw.length > MAX_SUMMARY_LENGTH) {
    return raw.slice(0, MAX_SUMMARY_LENGTH);
  }

  return raw;
}

/**
 * Detects whether a summary contains sensitive content without sanitizing.
 * Returns the detected label, or null if the summary is clean.
 */
export function detectSensitiveContent(raw: string): string | null {
  for (const { pattern, label } of SENSITIVE_PATTERNS) {
    if (pattern.test(raw)) return label;
  }
  const lineCount = (raw.match(/\n/g) || []).length;
  if (lineCount >= 3 && raw.length > LARGE_CONTENT_THRESHOLD) {
    return 'document/prompt text';
  }
  return null;
}

// ── Deduplication ──

/**
 * Checks whether a success event with the same idempotency signature already exists.
 * Signature: (action, targetId, requestId).
 *
 * Only success events are deduplicated — failure events with the same key are always
 * recorded because they may indicate different root causes or retry attempts.
 */
async function findExistingSuccessEvent(
  action: string,
  targetId: string | null,
  requestId: string,
): Promise<string | null> {
  const conditions = [
    eq(auditEvents.action, action),
    eq(auditEvents.result, 'success'),
    eq(auditEvents.requestId, requestId),
  ];

  if (targetId !== null) {
    conditions.push(eq(auditEvents.targetId, targetId));
  } else {
    conditions.push(isNull(auditEvents.targetId));
  }

  const existing = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(and(...conditions))
    .limit(1);

  return existing[0]?.id ?? null;
}

// ── Public API ──

/**
 * Records a sanitized audit event.
 *
 * When `idempotent` is true, `requestId` is set, and `result` is 'success',
 * the service checks for an existing success event with the same
 * (action, targetId, requestId) signature. If found, the insert is skipped
 * and 'DEDUPED' is returned.
 *
 * The summary is always sanitized before storage.
 *
 * @returns The new event id, or 'DEDUPED' if the event was deduplicated
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<string> {
  // AC3: deduplicate idempotent success events
  if (input.idempotent && input.requestId && input.result === 'success') {
    const existingId = await findExistingSuccessEvent(
      input.action,
      input.targetId ?? null,
      input.requestId,
    );
    if (existingId) {
      return 'DEDUPED';
    }
  }

  // AC2: sanitize the summary before storing
  const sanitizedSummary = sanitizeSummary(input.summary);

  const id = crypto.randomUUID();
  await db.insert(auditEvents).values({
    id,
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    tenantId: input.tenantId ?? null,
    requestId: input.requestId ?? null,
    result: input.result,
    summary: sanitizedSummary,
    ipAddress: input.ipAddress ?? null,
  });

  return id;
}

/**
 * Queries audit events by various criteria.
 * Results are ordered by creation time descending (newest first).
 *
 * AC5: events can be queried by actor, target, and time for test verification.
 */
export async function queryAuditEvents(options: AuditQueryOptions = {}): Promise<AuditEventRecord[]> {
  const conditions = [];

  if (options.actorId !== undefined) {
    conditions.push(eq(auditEvents.actorId, options.actorId));
  }
  if (options.targetType !== undefined) {
    conditions.push(eq(auditEvents.targetType, options.targetType));
  }
  if (options.targetId !== undefined) {
    conditions.push(eq(auditEvents.targetId, options.targetId));
  }
  if (options.action !== undefined) {
    conditions.push(eq(auditEvents.action, options.action));
  }
  if (options.tenantId !== undefined) {
    conditions.push(eq(auditEvents.tenantId, options.tenantId));
  }
  if (options.result !== undefined) {
    conditions.push(eq(auditEvents.result, options.result));
  }
  if (options.requestId !== undefined) {
    conditions.push(eq(auditEvents.requestId, options.requestId));
  }
  if (options.from !== undefined) {
    conditions.push(gte(auditEvents.createdAt, options.from));
  }
  if (options.to !== undefined) {
    conditions.push(lte(auditEvents.createdAt, options.to));
  }

  const baseQuery = db
    .select()
    .from(auditEvents)
    .orderBy(desc(auditEvents.createdAt))
    .limit(options.limit ?? 100);

  const rows = conditions.length > 0
    ? await baseQuery.where(and(...conditions))
    : await baseQuery;

  return rows as AuditEventRecord[];
}

/**
 * Counts audit events matching the given criteria.
 * Useful for delta-counting in tests (since audit_events is immutable).
 */
export async function countAuditEvents(options: AuditQueryOptions = {}): Promise<number> {
  const conditions = [];

  if (options.actorId !== undefined) {
    conditions.push(eq(auditEvents.actorId, options.actorId));
  }
  if (options.action !== undefined) {
    conditions.push(eq(auditEvents.action, options.action));
  }
  if (options.targetType !== undefined) {
    conditions.push(eq(auditEvents.targetType, options.targetType));
  }
  if (options.targetId !== undefined) {
    conditions.push(eq(auditEvents.targetId, options.targetId));
  }
  if (options.result !== undefined) {
    conditions.push(eq(auditEvents.result, options.result));
  }
  if (options.requestId !== undefined) {
    conditions.push(eq(auditEvents.requestId, options.requestId));
  }

  const baseQuery = db
    .select({ cnt: sql<number>`count(*)` })
    .from(auditEvents);

  const rows = conditions.length > 0
    ? await baseQuery.where(and(...conditions))
    : await baseQuery;

  return Number(rows[0]?.cnt ?? 0);
}
