/**
 * Provider Credential Encryption & Rotation Service
 *
 * Encrypts AI provider credentials (API keys) at rest using AES-256-GCM,
 * independent from AUTH_SECRET. Only masked values are ever exposed to
 * clients or logs.
 *
 * Design goals (US-032):
 * - AC1: Credentials use a dedicated master key (`AI_CREDENTIAL_MASTER_KEY`)
 *   or a pluggable KMS/Secret adapter — never AUTH_SECRET.
 * - AC2: The database stores only the encrypted blob. Services request
 *   short-lived decrypted values via `decryptCredential()`; plaintext is
 *   never persisted, cached globally, or returned alongside other data.
 * - AC3: Credential rotation creates a new encrypted blob with an
 *   incremented version; plaintext is never logged.
 * - AC4: The read API returns only masked keys (e.g. `sk-••••abcd`),
 *   version, and last-validated metadata.
 * - AC5: Missing decryption conditions in production causes a hard
 *   failure — no fallback to reading client-supplied keys.
 */

import crypto from 'crypto';
import { db } from '@/lib/db';
import { aiProviders } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// ── Constants ──

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const KEY_LENGTH = 32; // 256-bit key
const SALT_LENGTH = 16;
const BLOB_VERSION = 1;

// ── KMS / Secret Adapter Pattern ──

/**
 * Adapter interface for resolving the encryption key.
 * Default implementation reads from env var; production may inject
 * a KMS-backed adapter (AWS KMS, Google KMS, HashiCorp Vault, etc.).
 */
export interface CredentialKeyAdapter {
  /** Returns the raw key material (≥32 bytes after derivation). */
  getKey(): string;
  /** Whether the adapter is available and ready. */
  isAvailable(): boolean;
}

class EnvKeyAdapter implements CredentialKeyAdapter {
  getKey(): string {
    const key = process.env.AI_CREDENTIAL_MASTER_KEY || '';
    return key;
  }
  isAvailable(): boolean {
    return !!process.env.AI_CREDENTIAL_MASTER_KEY;
  }
}

let keyAdapter: CredentialKeyAdapter = new EnvKeyAdapter();

/**
 * Override the default env-based key adapter.
 * Use this to inject a KMS-backed adapter in production.
 */
export function setCredentialKeyAdapter(adapter: CredentialKeyAdapter): void {
  keyAdapter = adapter;
}

/** Reset to the default env-based adapter (for tests). */
export function resetCredentialKeyAdapter(): void {
  keyAdapter = new EnvKeyAdapter();
}

// ── Key Derivation ──

/**
 * Derive a 32-byte AES key from the master key string using scrypt.
 * A fresh salt is generated per encryption operation for forward security.
 */
function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return crypto.scryptSync(masterKey, salt, KEY_LENGTH);
}

// ── Encryption / Decryption ──

export interface EncryptedBlob {
  v: number;
  iv: string;
  salt: string;
  tag: string;
  data: string;
}

/**
 * Encrypt a plaintext credential string.
 * Returns a JSON-encoded blob that can be safely stored in the DB.
 */
export function encryptCredential(plaintext: string): string {
  const masterKey = keyAdapter.getKey();
  if (!masterKey) {
    throw new CredentialCryptoError(
      'Encryption key not available. Set AI_CREDENTIAL_MASTER_KEY or configure a KMS adapter.',
      'KEY_NOT_AVAILABLE',
    );
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(masterKey, salt);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const blob: EncryptedBlob = {
    v: BLOB_VERSION,
    iv: iv.toString('base64'),
    salt: salt.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };

  return JSON.stringify(blob);
}

/**
 * Decrypt an encrypted credential blob back to plaintext.
 * The caller must NOT persist or cache the returned value.
 */
export function decryptCredential(encryptedJson: string): string {
  const masterKey = keyAdapter.getKey();
  if (!masterKey) {
    throw new CredentialCryptoError(
      'Decryption key not available. Set AI_CREDENTIAL_MASTER_KEY or configure a KMS adapter.',
      'KEY_NOT_AVAILABLE',
    );
  }

  let blob: EncryptedBlob;
  try {
    blob = JSON.parse(encryptedJson) as EncryptedBlob;
  } catch {
    throw new CredentialCryptoError(
      'Invalid encrypted credential blob: malformed JSON.',
      'INVALID_BLOB',
    );
  }

  if (!blob.iv || !blob.salt || !blob.tag || !blob.data) {
    throw new CredentialCryptoError(
      'Invalid encrypted credential blob: missing required fields.',
      'INVALID_BLOB',
    );
  }

  const iv = Buffer.from(blob.iv, 'base64');
  const salt = Buffer.from(blob.salt, 'base64');
  const tag = Buffer.from(blob.tag, 'base64');
  const data = Buffer.from(blob.data, 'base64');
  const key = deriveKey(masterKey, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(data),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    throw new CredentialCryptoError(
      'Failed to decrypt credential: authentication failed or key mismatch.',
      'DECRYPT_FAILED',
    );
  }
}

// ── Masking ──

/**
 * Mask a credential for display in admin UIs or logs.
 * Shows the first 2 and last 4 characters, e.g. `sk-••••••••abcd`.
 * For very short strings, masks everything except the last character.
 */
export function maskCredential(plaintext: string): string {
  if (plaintext.length <= 5) {
    return '•'.repeat(plaintext.length);
  }
  const prefix = plaintext.slice(0, 2);
  const suffix = plaintext.slice(-4);
  const maskedLen = plaintext.length - 6;
  return `${prefix}${'•'.repeat(maskedLen)}${suffix}`;
}

// ── Error Type ──

export class CredentialCryptoError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = 'CredentialCryptoError';
  }
}

// ── Provider Credential Service (DB-level operations) ──

export interface ProviderCredentialInfo {
  id: string;
  type: string;
  name: string;
  status: string;
  baseUrl: string | null;
  maskedCredential: string | null;
  hasCredentials: boolean;
  credentialVersion: number;
  lastValidatedAt: Date | null;
}

/**
 * Get masked credential info for a provider — safe to return to admin UI.
 * Never returns plaintext credentials.
 */
export function getProviderCredentialInfo(provider: {
  id: string;
  type: string;
  name: string;
  status: string;
  baseUrl: string | null;
  encryptedCredentials: string | null;
  credentialVersion: number;
  lastValidatedAt: Date | null;
}): ProviderCredentialInfo {
  let maskedCredential: string | null = null;
  let hasCredentials = false;

  if (provider.encryptedCredentials) {
    try {
      const plaintext = decryptCredential(provider.encryptedCredentials);
      maskedCredential = maskCredential(plaintext);
      hasCredentials = true;
    } catch {
      // Decryption failure — report that credentials exist but are unreadable
      hasCredentials = true;
      maskedCredential = '[undecryptable]';
    }
  }

  return {
    id: provider.id,
    type: provider.type,
    name: provider.name,
    status: provider.status,
    baseUrl: provider.baseUrl,
    maskedCredential,
    hasCredentials,
    credentialVersion: provider.credentialVersion,
    lastValidatedAt: provider.lastValidatedAt,
  };
}

/**
 * Rotate the credential for a provider.
 * Encrypts the new plaintext, increments the version, and updates the DB.
 * Never logs the plaintext.
 */
export function rotateProviderCredential(providerId: string, newPlaintext: string): {
  credentialVersion: number;
  maskedCredential: string;
} {
  if (!newPlaintext) {
    throw new CredentialCryptoError(
      'Cannot rotate with empty credential.',
      'EMPTY_CREDENTIAL',
    );
  }

  const provider = db
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.id, providerId))
    .all();

  if (provider.length === 0) {
    throw new CredentialCryptoError(
      `Provider ${providerId} not found.`,
      'PROVIDER_NOT_FOUND',
    );
  }

  const newEncrypted = encryptCredential(newPlaintext);
  const newVersion = provider[0].credentialVersion + 1;

  db.update(aiProviders)
    .set({
      encryptedCredentials: newEncrypted,
      credentialVersion: newVersion,
      updatedAt: new Date(),
    })
    .where(eq(aiProviders.id, providerId))
    .run();

  return {
    credentialVersion: newVersion,
    maskedCredential: maskCredential(newPlaintext),
  };
}

/**
 * Resolve the decrypted credential for a provider — short-lived, in-memory only.
 * Callers MUST NOT persist, cache globally, or log the returned value.
 */
export function resolveProviderCredential(providerId: string): string {
  const provider = db
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.id, providerId))
    .all();

  if (provider.length === 0) {
    throw new CredentialCryptoError(
      `Provider ${providerId} not found.`,
      'PROVIDER_NOT_FOUND',
    );
  }

  if (!provider[0].encryptedCredentials) {
    throw new CredentialCryptoError(
      `Provider ${providerId} has no stored credentials.`,
      'NO_CREDENTIALS',
    );
  }

  return decryptCredential(provider[0].encryptedCredentials);
}
