/**
 * Legal Consent Service
 *
 * Manages recording and verifying user consent for privacy policy and terms of service.
 *
 * Design goals (US-053):
 * - AC1: First authentication must submit consent for current document versions
 * - AC2: Consent records are immutable and maintain full history
 * - AC3: Client cannot forge non-existent or expired document versions
 * - AC4: Re-consent enforcement: users without current consent can only access legal/consent flow
 * - AC5: Users can read their own consent records, not others'
 */

import { db } from '@/lib/db';
import { legalConsents } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

// ── Types ──

export type DocumentType = 'privacy_policy' | 'terms_of_service';
export type ConsentSource = 'registration' | 'explicit_reconsent' | 'login';

export interface DocumentVersion {
  version: string;
  effectiveDate: Date;
}

export interface ConsentRecord {
  id: string;
  userId: string;
  documentType: string;
  version: string;
  effectiveDate: Date;
  source: string;
  ipAddress: string | null;
  createdAt: Date;
}

// ── Document version registry ──
// These versions must match the version numbers in the legal page translations.
// When a document is updated, add the new version here and mark the old one as superseded.

interface DocumentConfig {
  current: DocumentVersion;
  /** Previous versions that are still considered valid for existing consents. */
  accepted: string[];
}

const DOCUMENT_REGISTRY: Record<DocumentType, DocumentConfig> = {
  privacy_policy: {
    current: {
      version: '2026-08-01-v1',
      effectiveDate: new Date('2026-08-01T00:00:00Z'),
    },
    accepted: ['2026-08-01-v1'],
  },
  terms_of_service: {
    current: {
      version: '2026-08-01-v1',
      effectiveDate: new Date('2026-08-01T00:00:00Z'),
    },
    accepted: ['2026-08-01-v1'],
  },
};

/**
 * Returns the current required version for a document type.
 */
export function getCurrentVersion(documentType: DocumentType): DocumentVersion {
  return DOCUMENT_REGISTRY[documentType].current;
}

/**
 * Returns the current versions for all document types.
 */
export function getAllCurrentVersions(): Record<DocumentType, DocumentVersion> {
  return {
    privacy_policy: DOCUMENT_REGISTRY.privacy_policy.current,
    terms_of_service: DOCUMENT_REGISTRY.terms_of_service.current,
  };
}

/**
 * Validates that a submitted version is a known, accepted document version.
 * This prevents clients from forging non-existent or expired versions (AC3).
 */
export function isValidVersion(documentType: DocumentType, version: string): boolean {
  const config = DOCUMENT_REGISTRY[documentType];
  return config.accepted.includes(version);
}

// ── Consent recording ──

/**
 * Records a user's consent for a specific document version.
 * Creates a new immutable row in legal_consents.
 *
 * @throws {Error} if the version is not a valid accepted version
 */
export async function recordConsent(params: {
  userId: string;
  documentType: DocumentType;
  version: string;
  source: ConsentSource;
  ipAddress?: string | null;
}): Promise<ConsentRecord> {
  const { userId, documentType, version, source, ipAddress = null } = params;

  // AC3: Validate version against known versions
  if (!isValidVersion(documentType, version)) {
    throw new Error(`INVALID_VERSION: ${documentType} version ${version} is not recognized`);
  }

  const effectiveDate = DOCUMENT_REGISTRY[documentType].current.effectiveDate;

  const [row] = await db
    .insert(legalConsents)
    .values({
      userId,
      documentType,
      version,
      effectiveDate,
      source,
      ipAddress,
    })
    .returning();

  return row as ConsentRecord;
}

/**
 * Records consent for all current document versions in one call.
 * Useful for registration flow where both privacy and terms need to be accepted.
 */
export async function recordAllConsents(params: {
  userId: string;
  source: ConsentSource;
  ipAddress?: string | null;
}): Promise<{ privacyPolicy: ConsentRecord; termsOfService: ConsentRecord }> {
  const { userId, source, ipAddress = null } = params;

  const ppVersion = getCurrentVersion('privacy_policy');
  const tosVersion = getCurrentVersion('terms_of_service');

  const [privacyPolicy, termsOfService] = await Promise.all([
    recordConsent({
      userId,
      documentType: 'privacy_policy',
      version: ppVersion.version,
      source,
      ipAddress,
    }),
    recordConsent({
      userId,
      documentType: 'terms_of_service',
      version: tosVersion.version,
      source,
      ipAddress,
    }),
  ]);

  return { privacyPolicy, termsOfService };
}

// ── Consent verification ──

/**
 * Checks whether a user has consented to the CURRENT version of a document.
 */
export async function hasCurrentConsent(
  userId: string,
  documentType: DocumentType,
): Promise<boolean> {
  const currentVersion = getCurrentVersion(documentType).version;

  const rows = await db
    .select({ version: legalConsents.version })
    .from(legalConsents)
    .where(
      and(
        eq(legalConsents.userId, userId),
        eq(legalConsents.documentType, documentType),
        eq(legalConsents.version, currentVersion),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * Checks whether a user has consented to ALL current document versions.
 * This is the main gate for AC4 (re-consent enforcement).
 *
 * Returns the list of missing document types if consent is incomplete.
 */
export async function checkAllCurrentConsents(
  userId: string,
): Promise<{ allConsented: boolean; missing: DocumentType[] }> {
  const [hasPrivacy, hasTerms] = await Promise.all([
    hasCurrentConsent(userId, 'privacy_policy'),
    hasCurrentConsent(userId, 'terms_of_service'),
  ]);

  const missing: DocumentType[] = [];
  if (!hasPrivacy) missing.push('privacy_policy');
  if (!hasTerms) missing.push('terms_of_service');

  return { allConsented: missing.length === 0, missing };
}

// ── Consent reading ──

/**
 * Returns a user's latest consent record for each document type.
 * AC5: Only returns the caller's own records.
 */
export async function getUserConsents(
  userId: string,
): Promise<Record<DocumentType, ConsentRecord | null>> {
  const [privacyRows, termsRows] = await Promise.all([
    db
      .select()
      .from(legalConsents)
      .where(
        and(
          eq(legalConsents.userId, userId),
          eq(legalConsents.documentType, 'privacy_policy'),
        ),
      )
      .orderBy(desc(legalConsents.createdAt))
      .limit(1),
    db
      .select()
      .from(legalConsents)
      .where(
        and(
          eq(legalConsents.userId, userId),
          eq(legalConsents.documentType, 'terms_of_service'),
        ),
      )
      .orderBy(desc(legalConsents.createdAt))
      .limit(1),
  ]);

  return {
    privacy_policy: (privacyRows[0] as ConsentRecord) ?? null,
    terms_of_service: (termsRows[0] as ConsentRecord) ?? null,
  };
}

/**
 * Returns the full consent history for a user.
 */
export async function getConsentHistory(
  userId: string,
  documentType?: DocumentType,
): Promise<ConsentRecord[]> {
  const conditions = documentType
    ? and(
        eq(legalConsents.userId, userId),
        eq(legalConsents.documentType, documentType),
      )
    : eq(legalConsents.userId, userId);

  const rows = await db
    .select()
    .from(legalConsents)
    .where(conditions)
    .orderBy(desc(legalConsents.createdAt));

  return rows as ConsentRecord[];
}
