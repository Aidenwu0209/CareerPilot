import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'path';
import * as schema from './schema';

/**
 * US-007 tests: AI providers, model catalog, and pricing schema integrity.
 *
 * Verifies:
 * - ai_providers: type, base_url, status, encrypted credentials, credential version
 * - ai_models: provider FK, model_identifier unique per provider, capabilities, tier, status,
 *   visibility, input/output limits, max_steps, fixed/token pricing
 * - CHECK constraints: fixed_price, token_price_input, token_price_output all >= 0
 * - FK constraints: models reference valid providers, cascade delete on provider removal
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

// ── ai_providers ──

describe('US-007: ai_providers table structure', () => {
  it('has all required columns after migration', () => {
    const tableInfo = sqlite.prepare('PRAGMA table_info(ai_providers)').all() as { name: string }[];
    const columnNames = tableInfo.map((c) => c.name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('type');
    expect(columnNames).toContain('name');
    expect(columnNames).toContain('base_url');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('encrypted_credentials');
    expect(columnNames).toContain('credential_version');
    expect(columnNames).toContain('last_validated_at');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  it('defaults status to active and credential_version to 1', () => {
    sqlite
      .prepare(
        "INSERT INTO ai_providers (id, type, name) VALUES ('prov-defaults', 'google', 'Google AI')",
      )
      .run();

    const row = sqlite
      .prepare('SELECT status, credential_version FROM ai_providers WHERE id = ?')
      .get('prov-defaults') as { status: string; credential_version: number };
    expect(row.status).toBe('active');
    expect(row.credential_version).toBe(1);
  });

  it('supports disabled status', () => {
    sqlite
      .prepare(
        "INSERT INTO ai_providers (id, type, name, status) VALUES ('prov-disabled', 'openai', 'OpenAI', 'disabled')",
      )
      .run();

    const row = sqlite
      .prepare('SELECT status FROM ai_providers WHERE id = ?')
      .get('prov-disabled') as { status: string };
    expect(row.status).toBe('disabled');
  });

  it('stores encrypted credentials and version for rotation', () => {
    sqlite
      .prepare(
        `INSERT INTO ai_providers (id, type, name, encrypted_credentials, credential_version)
         VALUES ('prov-creds', 'anthropic', 'Anthropic', 'encrypted-blob-v2', 2)`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT encrypted_credentials, credential_version FROM ai_providers WHERE id = ?')
      .get('prov-creds') as { encrypted_credentials: string; credential_version: number };
    expect(row.encrypted_credentials).toBe('encrypted-blob-v2');
    expect(row.credential_version).toBe(2);
  });

  it('supports controlled base_url', () => {
    sqlite
      .prepare(
        `INSERT INTO ai_providers (id, type, name, base_url)
         VALUES ('prov-baseurl', 'nanobanana', 'NanoBanana', 'https://api.nanobanana.com')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT base_url FROM ai_providers WHERE id = ?')
      .get('prov-baseurl') as { base_url: string };
    expect(row.base_url).toBe('https://api.nanobanana.com');
  });

  it('allows base_url to be null (use provider default)', () => {
    sqlite
      .prepare(
        "INSERT INTO ai_providers (id, type, name) VALUES ('prov-null-url', 'google', 'Google Default')",
      )
      .run();

    const row = sqlite
      .prepare('SELECT base_url FROM ai_providers WHERE id = ?')
      .get('prov-null-url') as { base_url: string | null };
    expect(row.base_url).toBeNull();
  });
});

// ── ai_models ──

describe('US-007: ai_models table structure', () => {
  it('has all required columns after migration', () => {
    const tableInfo = sqlite.prepare('PRAGMA table_info(ai_models)').all() as { name: string }[];
    const columnNames = tableInfo.map((c) => c.name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('provider_id');
    expect(columnNames).toContain('model_identifier');
    expect(columnNames).toContain('display_name');
    expect(columnNames).toContain('capabilities');
    expect(columnNames).toContain('tier');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('visibility');
    expect(columnNames).toContain('input_token_limit');
    expect(columnNames).toContain('output_token_limit');
    expect(columnNames).toContain('max_steps');
    expect(columnNames).toContain('fixed_price');
    expect(columnNames).toContain('token_price_input');
    expect(columnNames).toContain('token_price_output');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  it('defaults capabilities to [], tier to standard, status to active, visibility to public', () => {
    sqlite
      .prepare(
        `INSERT INTO ai_models (id, provider_id, model_identifier, display_name)
         VALUES ('model-defaults', 'prov-defaults', 'gemini-flash', 'Gemini Flash')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT capabilities, tier, status, visibility FROM ai_models WHERE id = ?')
      .get('model-defaults') as {
        capabilities: string;
        tier: string;
        status: string;
        visibility: string;
      };
    expect(row.capabilities).toBe('[]');
    expect(row.tier).toBe('standard');
    expect(row.status).toBe('active');
    expect(row.visibility).toBe('public');
  });

  it('defaults pricing fields to 0', () => {
    sqlite
      .prepare(
        `INSERT INTO ai_models (id, provider_id, model_identifier, display_name)
         VALUES ('model-price-default', 'prov-defaults', 'price-default-model', 'Price Default')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT fixed_price, token_price_input, token_price_output FROM ai_models WHERE id = ?')
      .get('model-price-default') as {
        fixed_price: number;
        token_price_input: number;
        token_price_output: number;
      };
    expect(row.fixed_price).toBe(0);
    expect(row.token_price_input).toBe(0);
    expect(row.token_price_output).toBe(0);
  });
});

describe('US-007: ai_models unique model_identifier per provider', () => {
  it('compound unique on (provider_id, model_identifier) prevents duplicates', () => {
    sqlite
      .prepare(
        `INSERT INTO ai_providers (id, type, name) VALUES ('prov-unique-test', 'google', 'Google Unique')`,
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO ai_models (id, provider_id, model_identifier, display_name)
         VALUES ('model-a', 'prov-unique-test', 'gemini-pro', 'Gemini Pro')`,
      )
      .run();

    // Same provider + same model_identifier must fail
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO ai_models (id, provider_id, model_identifier, display_name)
           VALUES ('model-b', 'prov-unique-test', 'gemini-pro', 'Duplicate')`,
        )
        .run();
    }).toThrow();

    // Same model_identifier on a DIFFERENT provider is allowed
    sqlite
      .prepare(
        `INSERT INTO ai_providers (id, type, name) VALUES ('prov-other', 'openai', 'OpenAI Other')`,
      )
      .run();
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO ai_models (id, provider_id, model_identifier, display_name)
           VALUES ('model-c', 'prov-other', 'gemini-pro', 'Different Provider Same ID')`,
        )
        .run();
    }).not.toThrow();
  });
});

describe('US-007: ai_models FK to ai_providers', () => {
  it('rejects model with non-existent provider_id', () => {
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO ai_models (id, provider_id, model_identifier, display_name)
           VALUES ('model-fk-fail', 'nonexistent-provider', 'test-model', 'Test')`,
        )
        .run();
    }).toThrow();
  });

  it('cascade deletes models when provider is deleted', () => {
    sqlite
      .prepare(
        `INSERT INTO ai_providers (id, type, name) VALUES ('prov-cascade', 'google', 'Cascade Test')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO ai_models (id, provider_id, model_identifier, display_name)
         VALUES ('model-cascade-1', 'prov-cascade', 'cascade-model-1', 'Cascade 1')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO ai_models (id, provider_id, model_identifier, display_name)
         VALUES ('model-cascade-2', 'prov-cascade', 'cascade-model-2', 'Cascade 2')`,
      )
      .run();

    // Verify models exist
    const before = sqlite
      .prepare('SELECT COUNT(*) as count FROM ai_models WHERE provider_id = ?')
      .get('prov-cascade') as { count: number };
    expect(before.count).toBe(2);

    // Delete the provider
    sqlite.prepare('DELETE FROM ai_providers WHERE id = ?').run('prov-cascade');

    // Models should be cascade deleted
    const after = sqlite
      .prepare('SELECT COUNT(*) as count FROM ai_models WHERE provider_id = ?')
      .get('prov-cascade') as { count: number };
    expect(after.count).toBe(0);
  });
});

describe('US-007: ai_models capabilities (text and image generation)', () => {
  it('stores text-only capabilities', () => {
    sqlite
      .prepare(
        `INSERT INTO ai_providers (id, type, name) VALUES ('prov-cap-text', 'openai', 'OpenAI Cap')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO ai_models (id, provider_id, model_identifier, display_name, capabilities)
         VALUES ('model-text-only', 'prov-cap-text', 'gpt-4', 'GPT-4', '["text"]')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT capabilities FROM ai_models WHERE id = ?')
      .get('model-text-only') as { capabilities: string };
    expect(JSON.parse(row.capabilities)).toEqual(['text']);
  });

  it('stores image generation capabilities', () => {
    sqlite
      .prepare(
        `INSERT INTO ai_models (id, provider_id, model_identifier, display_name, capabilities)
         VALUES ('model-image', 'prov-cap-text', 'dall-e-3', 'DALL-E 3', '["image_generation"]')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT capabilities FROM ai_models WHERE id = ?')
      .get('model-image') as { capabilities: string };
    expect(JSON.parse(row.capabilities)).toEqual(['image_generation']);
  });

  it('stores both text and image generation capabilities', () => {
    sqlite
      .prepare(
        `INSERT INTO ai_models (id, provider_id, model_identifier, display_name, capabilities)
         VALUES ('model-both', 'prov-cap-text', 'gemini-2.0-flash', 'Gemini 2.0 Flash', '["text","image_generation"]')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT capabilities FROM ai_models WHERE id = ?')
      .get('model-both') as { capabilities: string };
    expect(JSON.parse(row.capabilities)).toEqual(['text', 'image_generation']);
  });
});

describe('US-007: ai_models non-negative pricing CHECK constraints', () => {
  it('rejects negative fixed_price', () => {
    sqlite
      .prepare(
        `INSERT INTO ai_providers (id, type, name) VALUES ('prov-price-check', 'google', 'Price Check')`,
      )
      .run();

    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO ai_models (id, provider_id, model_identifier, display_name, fixed_price)
           VALUES ('model-neg-fixed', 'prov-price-check', 'neg-fixed', 'Neg Fixed', -5)`,
        )
        .run();
    }).toThrow();
  });

  it('rejects negative token_price_input', () => {
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO ai_models (id, provider_id, model_identifier, display_name, token_price_input)
           VALUES ('model-neg-input', 'prov-price-check', 'neg-input', 'Neg Input', -1)`,
        )
        .run();
    }).toThrow();
  });

  it('rejects negative token_price_output', () => {
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO ai_models (id, provider_id, model_identifier, display_name, token_price_output)
           VALUES ('model-neg-output', 'prov-price-check', 'neg-output', 'Neg Output', -1)`,
        )
        .run();
    }).toThrow();
  });

  it('accepts zero pricing (free model)', () => {
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO ai_models (id, provider_id, model_identifier, display_name, fixed_price, token_price_input, token_price_output)
           VALUES ('model-free', 'prov-price-check', 'free-model', 'Free Model', 0, 0, 0)`,
        )
        .run();
    }).not.toThrow();
  });
});

describe('US-007: ai_models tier and visibility', () => {
  it('supports different tiers', () => {
    sqlite
      .prepare(
        `INSERT INTO ai_providers (id, type, name) VALUES ('prov-tier', 'anthropic', 'Anthropic Tier')`,
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO ai_models (id, provider_id, model_identifier, display_name, tier)
         VALUES ('model-free-tier', 'prov-tier', 'claude-free', 'Claude Free', 'free')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO ai_models (id, provider_id, model_identifier, display_name, tier)
         VALUES ('model-premium-tier', 'prov-tier', 'claude-premium', 'Claude Premium', 'premium')`,
      )
      .run();

    const freeRow = sqlite
      .prepare('SELECT tier FROM ai_models WHERE id = ?')
      .get('model-free-tier') as { tier: string };
    const premiumRow = sqlite
      .prepare('SELECT tier FROM ai_models WHERE id = ?')
      .get('model-premium-tier') as { tier: string };
    expect(freeRow.tier).toBe('free');
    expect(premiumRow.tier).toBe('premium');
  });

  it('supports different visibility scopes', () => {
    sqlite
      .prepare(
        `INSERT INTO ai_models (id, provider_id, model_identifier, display_name, visibility)
         VALUES ('model-private', 'prov-tier', 'private-model', 'Private', 'private')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO ai_models (id, provider_id, model_identifier, display_name, visibility)
         VALUES ('model-restricted', 'prov-tier', 'restricted-model', 'Restricted', 'restricted')`,
      )
      .run();

    const privateRow = sqlite
      .prepare('SELECT visibility FROM ai_models WHERE id = ?')
      .get('model-private') as { visibility: string };
    const restrictedRow = sqlite
      .prepare('SELECT visibility FROM ai_models WHERE id = ?')
      .get('model-restricted') as { visibility: string };
    expect(privateRow.visibility).toBe('private');
    expect(restrictedRow.visibility).toBe('restricted');
  });
});

describe('US-007: ai_models input/output limits and max_steps', () => {
  it('stores token limits and max_steps for image models', () => {
    sqlite
      .prepare(
        `INSERT INTO ai_models (id, provider_id, model_identifier, display_name, input_token_limit, output_token_limit, max_steps)
         VALUES ('model-limits', 'prov-tier', 'limited-model', 'Limited',
          128000, 4096, 50)`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT input_token_limit, output_token_limit, max_steps FROM ai_models WHERE id = ?')
      .get('model-limits') as {
        input_token_limit: number;
        output_token_limit: number;
        max_steps: number;
      };
    expect(row.input_token_limit).toBe(128000);
    expect(row.output_token_limit).toBe(4096);
    expect(row.max_steps).toBe(50);
  });

  it('allows null token limits and max_steps', () => {
    sqlite
      .prepare(
        `INSERT INTO ai_models (id, provider_id, model_identifier, display_name)
         VALUES ('model-null-limits', 'prov-tier', 'null-limits-model', 'Null Limits')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT input_token_limit, output_token_limit, max_steps FROM ai_models WHERE id = ?')
      .get('model-null-limits') as {
        input_token_limit: number | null;
        output_token_limit: number | null;
        max_steps: number | null;
      };
    expect(row.input_token_limit).toBeNull();
    expect(row.output_token_limit).toBeNull();
    expect(row.max_steps).toBeNull();
  });
});

describe('US-007: ai_models supports both fixed and token pricing', () => {
  it('stores fixed-price model (e.g. image generation)', () => {
    sqlite
      .prepare(
        `INSERT INTO ai_models (id, provider_id, model_identifier, display_name, fixed_price, capabilities)
         VALUES ('model-fixed-price', 'prov-tier', 'fixed-img-model', 'Fixed Img',
          10, '["image_generation"]')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT fixed_price FROM ai_models WHERE id = ?')
      .get('model-fixed-price') as { fixed_price: number };
    expect(row.fixed_price).toBe(10);
  });

  it('stores token-based pricing model', () => {
    sqlite
      .prepare(
        `INSERT INTO ai_models (id, provider_id, model_identifier, display_name, token_price_input, token_price_output, capabilities)
         VALUES ('model-token-price', 'prov-tier', 'token-text-model', 'Token Text',
          2, 8, '["text"]')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT token_price_input, token_price_output FROM ai_models WHERE id = ?')
      .get('model-token-price') as { token_price_input: number; token_price_output: number };
    expect(row.token_price_input).toBe(2);
    expect(row.token_price_output).toBe(8);
  });
});

// ── PG schema verification ──

describe('US-007: PG schema defines AI provider and model tables', () => {
  it('pg-schema.ts exports aiProviders and aiModels', async () => {
    const pgSchema = await import('./pg-schema');
    expect(pgSchema.aiProviders).toBeDefined();
    expect(pgSchema.aiModels).toBeDefined();
  });
});
