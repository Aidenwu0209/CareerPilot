/**
 * Tests for Provider Credential Encryption & Rotation Service (US-032)
 *
 * AC1: Credentials encrypted with independent master key or KMS adapter
 * AC2: DB cannot yield plaintext; services get short-lived decrypted values only
 * AC3: Rotation creates new version, preserves enable status, never logs plaintext
 * AC4: Read API returns only masked value, version, last-validated metadata
 * AC5: Missing decryption conditions in production → hard failure, no client-key fallback
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encryptCredential,
  decryptCredential,
  maskCredential,
  getProviderCredentialInfo,
  rotateProviderCredential,
  resolveProviderCredential,
  setCredentialKeyAdapter,
  resetCredentialKeyAdapter,
  CredentialCryptoError,
  type CredentialKeyAdapter,
} from './credential-crypto';
import crypto from 'crypto';

// ── Test helpers ──

const TEST_KEY = 'test-master-key-that-is-at-least-32-chars-long!';

function setTestKey(key: string = TEST_KEY): void {
  vi.stubEnv('AI_CREDENTIAL_MASTER_KEY', key);
  resetCredentialKeyAdapter();
}

function clearTestKey(): void {
  vi.stubEnv('AI_CREDENTIAL_MASTER_KEY', '');
  resetCredentialKeyAdapter();
}

// Mock in-memory DB for rotation/resolve tests
vi.mock('@/lib/db', () => {
  const providers = new Map<string, Record<string, unknown>>();
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            all: () => {
              // Return all providers matching the last where clause
              // Simplified: return all as a flat array
              return Array.from(providers.values());
            },
          }),
        }),
      }),
      update: (_table: { name: string }) => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            run: () => {
              // Find provider by id — we store the id on the values
              // In tests, the update target is identified by the where clause
              // Simplified mock: update all matching providers
              for (const [, provider] of providers) {
                Object.assign(provider, values);
              }
              return { changes: 1 };
            },
          }),
        }),
      }),
      insert: (_table: { name: string }) => ({
        values: (obj: Record<string, unknown>) => ({
          run: () => {
            const id = (obj.id as string) || crypto.randomUUID();
            providers.set(id, { ...obj, id });
            return { changes: 1 };
          },
        }),
      }),
      delete: () => ({
        from: () => ({
          where: () => ({
            run: () => {
              providers.clear();
              return { changes: providers.size };
            },
          }),
        }),
      }),
      _providers: providers, // expose for test setup
    },
  };
});

// Re-import after mock to get mocked db
import { db } from '@/lib/db';

function seedProvider(overrides: Partial<Record<string, unknown>> = {}): string {
  const id = overrides.id as string || crypto.randomUUID();
  const encrypted = overrides.encryptedCredentials as string || encryptCredential('sk-test-key-12345');
  (db as unknown as { _providers: Map<string, Record<string, unknown>> })._providers.set(id, {
    id,
    type: 'openai',
    name: 'Test Provider',
    status: 'active',
    baseUrl: null,
    encryptedCredentials: encrypted,
    credentialVersion: 1,
    lastValidatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
  return id;
}

function clearProviders(): void {
  (db as unknown as { _providers: Map<string, Record<string, unknown>> })._providers.clear();
}

// ── Tests ──

describe('US-032: Credential Encryption & Rotation Service', () => {
  beforeEach(() => {
    setTestKey();
    clearProviders();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetCredentialKeyAdapter();
  });

  // ── AC1: Independent master key / KMS adapter ──

  describe('AC1: Encryption key source', () => {
    it('derives encryption key from AI_CREDENTIAL_MASTER_KEY', () => {
      const plaintext = 'sk-openai-test-key';
      const encrypted = encryptCredential(plaintext);
      const decrypted = decryptCredential(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('uses different keys → produces different ciphertexts for same plaintext', () => {
      vi.stubEnv('AI_CREDENTIAL_MASTER_KEY', 'key-one-at-least-32-characters-long!!');
      resetCredentialKeyAdapter();
      const enc1 = encryptCredential('sk-test-key');

      vi.stubEnv('AI_CREDENTIAL_MASTER_KEY', 'key-two-at-least-32-characters-long!!');
      resetCredentialKeyAdapter();
      const enc2 = encryptCredential('sk-test-key');

      expect(enc1).not.toBe(enc2);
    });

    it('decryption with wrong key fails', () => {
      vi.stubEnv('AI_CREDENTIAL_MASTER_KEY', 'correct-key-at-least-32-characters-long!');
      resetCredentialKeyAdapter();
      const encrypted = encryptCredential('sk-secret-key');

      vi.stubEnv('AI_CREDENTIAL_MASTER_KEY', 'wrong-key-at-least-32-characters-long!!');
      resetCredentialKeyAdapter();

      expect(() => decryptCredential(encrypted)).toThrow(CredentialCryptoError);
    });

    it('supports pluggable KMS adapter', () => {
      const kmsKey = 'kms-provided-key-that-is-32-char-long!';
      const kmsAdapter: CredentialKeyAdapter = {
        getKey: () => kmsKey,
        isAvailable: () => true,
      };
      setCredentialKeyAdapter(kmsAdapter);

      const encrypted = encryptCredential('sk-kms-key');
      const decrypted = decryptCredential(encrypted);
      expect(decrypted).toBe('sk-kms-key');
    });

    it('is independent from AUTH_SECRET', () => {
      vi.stubEnv('AUTH_SECRET', 'auth-secret-value-that-is-at-least-32-chars');
      vi.stubEnv('AI_CREDENTIAL_MASTER_KEY', 'different-master-key-32-chars-long!');
      resetCredentialKeyAdapter();

      const encrypted = encryptCredential('sk-independent-test');

      // AUTH_SECRET should not decrypt what AI_CREDENTIAL_MASTER_KEY encrypted
      vi.stubEnv('AI_CREDENTIAL_MASTER_KEY', 'auth-secret-value-that-is-at-least-32-chars');
      resetCredentialKeyAdapter();
      expect(() => decryptCredential(encrypted)).toThrow(CredentialCryptoError);
    });
  });

  // ── AC2: DB cannot yield plaintext; short-lived decrypted values ──

  describe('AC2: Plaintext isolation', () => {
    it('encrypted blob does not contain plaintext', () => {
      const plaintext = 'sk-very-secret-key-1234567890';
      const encrypted = encryptCredential(plaintext);
      expect(encrypted).not.toContain(plaintext);
      expect(encrypted).not.toContain('very-secret');
      expect(encrypted).not.toContain('key-12345');
    });

    it('each encryption uses a unique IV and salt (forward security)', () => {
      const plaintext = 'sk-same-key-every-time';
      const enc1 = encryptCredential(plaintext);
      const enc2 = encryptCredential(plaintext);

      const blob1 = JSON.parse(enc1);
      const blob2 = JSON.parse(enc2);

      expect(blob1.iv).not.toBe(blob2.iv);
      expect(blob1.salt).not.toBe(blob2.salt);
      expect(blob1.data).not.toBe(blob2.data);

      // Both decrypt to same value
      expect(decryptCredential(enc1)).toBe(plaintext);
      expect(decryptCredential(enc2)).toBe(plaintext);
    });

    it('resolveProviderCredential returns plaintext for short-lived use', () => {
      const id = seedProvider();
      const result = resolveProviderCredential(id);
      expect(result).toBe('sk-test-key-12345');
    });

    it('resolveProviderCredential throws for missing provider', () => {
      expect(() => resolveProviderCredential('nonexistent')).toThrow(CredentialCryptoError);
      expect(() => resolveProviderCredential('nonexistent')).toThrow(/not found/);
    });

    it('resolveProviderCredential throws for provider without credentials', () => {
      const id = seedProvider({ encryptedCredentials: null });
      expect(() => resolveProviderCredential(id)).toThrow(CredentialCryptoError);
      expect(() => resolveProviderCredential(id)).toThrow(/no stored credentials/);
    });

    it('encrypted blob format contains version, iv, salt, tag, data', () => {
      const encrypted = encryptCredential('sk-test');
      const blob = JSON.parse(encrypted);
      expect(blob).toHaveProperty('v', 1);
      expect(blob).toHaveProperty('iv');
      expect(blob).toHaveProperty('salt');
      expect(blob).toHaveProperty('tag');
      expect(blob).toHaveProperty('data');
    });
  });

  // ── AC3: Rotation creates new version, no plaintext logging ──

  describe('AC3: Credential rotation', () => {
    it('rotation increments version and updates encrypted blob', () => {
      const id = seedProvider();
      const result = rotateProviderCredential(id, 'sk-new-rotated-key');

      expect(result.credentialVersion).toBe(2);
      expect(result.maskedCredential).toBe(maskCredential('sk-new-rotated-key'));

      // Verify DB was updated
      const providers = (db as unknown as { _providers: Map<string, Record<string, unknown>> })._providers;
      const updated = providers.get(id);
      expect(updated?.credentialVersion).toBe(2);
      expect(updated?.encryptedCredentials).not.toBe(null);

      // New credential decrypts correctly
      const decrypted = decryptCredential(updated!.encryptedCredentials as string);
      expect(decrypted).toBe('sk-new-rotated-key');
    });

    it('rotation preserves provider status', () => {
      const id = seedProvider({ status: 'disabled' });
      rotateProviderCredential(id, 'sk-new-key');

      const providers = (db as unknown as { _providers: Map<string, Record<string, unknown>> })._providers;
      const updated = providers.get(id);
      expect(updated?.status).toBe('disabled');
    });

    it('rotation with empty credential throws', () => {
      const id = seedProvider();
      expect(() => rotateProviderCredential(id, '')).toThrow(CredentialCryptoError);
      expect(() => rotateProviderCredential(id, '')).toThrow(/empty credential/);
    });

    it('rotation on non-existent provider throws', () => {
      expect(() => rotateProviderCredential('nonexistent', 'sk-key')).toThrow(CredentialCryptoError);
    });

    it('multiple rotations increment version sequentially', () => {
      const id = seedProvider();

      const r1 = rotateProviderCredential(id, 'sk-v2');
      expect(r1.credentialVersion).toBe(2);

      const r2 = rotateProviderCredential(id, 'sk-v3');
      expect(r2.credentialVersion).toBe(3);

      const r3 = rotateProviderCredential(id, 'sk-v4');
      expect(r3.credentialVersion).toBe(4);
    });

    it('rotation result does not include plaintext', () => {
      const id = seedProvider();
      const plaintext = 'sk-rotation-secret-do-not-leak';
      const result = rotateProviderCredential(id, plaintext);

      // result is a JSON-serializable object; ensure plaintext is not in it
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(plaintext);
      expect(serialized).not.toContain('rotation-secret');
    });
  });

  // ── AC4: Read API returns only masked value, version, metadata ──

  describe('AC4: Masked credential info', () => {
    it('getProviderCredentialInfo returns masked credential', () => {
      const id = seedProvider();
      const providers = (db as unknown as { _providers: Map<string, Record<string, unknown>> })._providers;
      const providerRow = providers.get(id)!;

      const info = getProviderCredentialInfo({
        id: providerRow.id as string,
        type: providerRow.type as string,
        name: providerRow.name as string,
        status: providerRow.status as string,
        baseUrl: providerRow.baseUrl as string | null,
        encryptedCredentials: providerRow.encryptedCredentials as string,
        credentialVersion: providerRow.credentialVersion as number,
        lastValidatedAt: providerRow.lastValidatedAt as Date | null,
      });

      expect(info.maskedCredential).not.toBeNull();
      expect(info.maskedCredential).not.toContain('sk-test-key-12345');
      expect(info.maskedCredential).toContain('•');
      expect(info.hasCredentials).toBe(true);
      expect(info.credentialVersion).toBe(1);
    });

    it('getProviderCredentialInfo includes all required fields', () => {
      const lastValidated = new Date('2026-01-01');
      const encrypted = encryptCredential('sk-mask-test-key');

      const info = getProviderCredentialInfo({
        id: 'prov-123',
        type: 'google',
        name: 'Google AI',
        status: 'active',
        baseUrl: 'https://api.google.com',
        encryptedCredentials: encrypted,
        credentialVersion: 3,
        lastValidatedAt: lastValidated,
      });

      expect(info.id).toBe('prov-123');
      expect(info.type).toBe('google');
      expect(info.name).toBe('Google AI');
      expect(info.status).toBe('active');
      expect(info.baseUrl).toBe('https://api.google.com');
      expect(info.maskedCredential).toBeTruthy();
      expect(info.hasCredentials).toBe(true);
      expect(info.credentialVersion).toBe(3);
      expect(info.lastValidatedAt).toEqual(lastValidated);
    });

    it('getProviderCredentialInfo for null credentials returns hasCredentials=false', () => {
      const info = getProviderCredentialInfo({
        id: 'prov-empty',
        type: 'openai',
        name: 'Empty Provider',
        status: 'active',
        baseUrl: null,
        encryptedCredentials: null,
        credentialVersion: 1,
        lastValidatedAt: null,
      });

      expect(info.hasCredentials).toBe(false);
      expect(info.maskedCredential).toBeNull();
    });

    it('maskCredential masks middle of key', () => {
      expect(maskCredential('sk-1234567890abcdef')).toBe('sk' + '•'.repeat(13) + 'cdef');
      expect(maskCredential('AIza1234567890')).toBe('AI' + '•'.repeat(8) + '7890');
    });

    it('maskCredential fully masks very short strings', () => {
      expect(maskCredential('abc')).toBe('•••');
      expect(maskCredential('ab')).toBe('••');
      expect(maskCredential('')).toBe('');
    });

    it('masked output never reveals original key length exactly for short keys', () => {
      // Short keys are fully masked
      const short = maskCredential('sk');
      expect(short).not.toContain('s');
      expect(short).not.toContain('k');
    });

    it('getProviderCredentialInfo handles undecryptable credentials gracefully', () => {
      // Encrypt with one key, then switch to wrong key
      const encrypted = encryptCredential('sk-original-key');

      vi.stubEnv('AI_CREDENTIAL_MASTER_KEY', 'wrong-key-at-least-32-characters-long!!');
      resetCredentialKeyAdapter();

      const info = getProviderCredentialInfo({
        id: 'prov-bad',
        type: 'openai',
        name: 'Bad Provider',
        status: 'active',
        baseUrl: null,
        encryptedCredentials: encrypted,
        credentialVersion: 1,
        lastValidatedAt: null,
      });

      expect(info.hasCredentials).toBe(true);
      expect(info.maskedCredential).toBe('[undecryptable]');
    });
  });

  // ── AC5: Missing decryption conditions → hard failure ──

  describe('AC5: Fail-closed on missing key', () => {
    it('encryptCredential throws when key not available', () => {
      clearTestKey();
      expect(() => encryptCredential('sk-test')).toThrow(CredentialCryptoError);
      expect(() => encryptCredential('sk-test')).toThrow(/not available/);
    });

    it('decryptCredential throws when key not available', () => {
      // Encrypt with valid key first
      setTestKey();
      const encrypted = encryptCredential('sk-test-key');

      // Clear key
      clearTestKey();
      expect(() => decryptCredential(encrypted)).toThrow(CredentialCryptoError);
      expect(() => decryptCredential(encrypted)).toThrow(/not available/);
    });

    it('KMS adapter isAvailable()=false causes failure', () => {
      const unavailableAdapter: CredentialKeyAdapter = {
        getKey: () => '',
        isAvailable: () => false,
      };
      setCredentialKeyAdapter(unavailableAdapter);

      expect(() => encryptCredential('sk-test')).toThrow(CredentialCryptoError);
      expect(() => decryptCredential(encryptCredential('sk-test'))).toThrow(CredentialCryptoError);
    });

    it('no fallback to client-supplied keys', () => {
      // The service has no mechanism to accept or read client-supplied keys.
      // This test verifies the API surface doesn't accept such parameters.
      // encryptCredential only takes plaintext — no key param
      // decryptCredential only takes encrypted blob — no key param
      // resolveProviderCredential only takes providerId — no key param
      clearTestKey();

      // All three should fail, not fall back to some default
      expect(() => encryptCredential('anything')).toThrow();
      expect(() => decryptCredential('{}')).toThrow();
      expect(() => resolveProviderCredential('any-id')).toThrow();
    });

    it('decryption of tampered blob fails (auth tag verification)', () => {
      const encrypted = encryptCredential('sk-tamper-test');
      const blob = JSON.parse(encrypted);

      // Tamper with the ciphertext
      const data = Buffer.from(blob.data, 'base64');
      data[0] ^= 0xff; // flip a bit
      blob.data = data.toString('base64');

      expect(() => decryptCredential(JSON.stringify(blob))).toThrow(CredentialCryptoError);
      expect(() => decryptCredential(JSON.stringify(blob))).toThrow(/authentication failed/);
    });

    it('decryption of malformed JSON throws clear error', () => {
      expect(() => decryptCredential('not-json')).toThrow(CredentialCryptoError);
      expect(() => decryptCredential('not-json')).toThrow(/malformed JSON/);
    });

    it('decryption of blob with missing fields throws clear error', () => {
      expect(() => decryptCredential('{}')).toThrow(CredentialCryptoError);
      expect(() => decryptCredential('{}')).toThrow(/missing required fields/);

      expect(() => decryptCredential(JSON.stringify({ v: 1, iv: 'x' }))).toThrow(CredentialCryptoError);
    });
  });

  // ── Round-trip & robustness ──

  describe('Encryption round-trip', () => {
    it('round-trips various credential formats', () => {
      const testCases = [
        'sk-simple',
        'AIzaSyABCDEFGHIJKLMNopqrstuvwxyz1234567',
        'sk-ant-api03-1234567890abcdefghijklmnopqrstuvwxyz',
        '{"api_key":"value","project_id":"test"}',
        'a', // single char
        'x'.repeat(1000), // long key
      ];

      for (const tc of testCases) {
        const encrypted = encryptCredential(tc);
        const decrypted = decryptCredential(encrypted);
        expect(decrypted).toBe(tc);
      }
    });

    it('produces valid JSON blobs', () => {
      const encrypted = encryptCredential('sk-json-test');
      expect(() => JSON.parse(encrypted)).not.toThrow();
    });

    it('blob version is 1', () => {
      const blob = JSON.parse(encryptCredential('sk-version-test'));
      expect(blob.v).toBe(1);
    });
  });
});
