import { sqliteTable, text, integer, unique, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ── AI providers and model catalog ──

/**
 * AI provider — a managed upstream supplier (Google, OpenAI, Anthropic, etc.).
 * Credentials are encrypted at rest; only masked values are ever exposed to clients.
 */
export const aiProviders = sqliteTable('ai_providers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  type: text('type').notNull(), // e.g. 'google', 'openai', 'anthropic', 'nanobanana'
  name: text('name').notNull(),
  baseUrl: text('base_url'), // controlled service URL; null = use provider default
  status: text('status', { enum: ['active', 'disabled'] }).notNull().default('active'),
  encryptedCredentials: text('encrypted_credentials'), // encrypted JSON blob
  credentialVersion: integer('credential_version').notNull().default(1),
  lastValidatedAt: integer('last_validated_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  typeIdx: index('ai_providers_type_idx').on(table.type),
  statusIdx: index('ai_providers_status_idx').on(table.status),
}));

/**
 * AI model — an individual model offered by a provider.
 * Unique per provider (e.g. google+gemini-2.0-flash).
 * Supports text and/or image-generation capabilities with pricing info.
 */
export const aiModels = sqliteTable('ai_models', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  providerId: text('provider_id').notNull().references(() => aiProviders.id, { onDelete: 'cascade' }),
  modelIdentifier: text('model_identifier').notNull(), // unique per provider
  displayName: text('display_name').notNull(),
  capabilities: text('capabilities', { mode: 'json' }).notNull().default('[]'), // ['text','image_generation']
  tier: text('tier').notNull().default('standard'),
  status: text('status', { enum: ['active', 'disabled'] }).notNull().default('active'),
  visibility: text('visibility').notNull().default('public'),
  inputTokenLimit: integer('input_token_limit'),
  outputTokenLimit: integer('output_token_limit'),
  maxSteps: integer('max_steps'),
  fixedPrice: integer('fixed_price').default(0), // credits per call (fixed-price models)
  tokenPriceInput: integer('token_price_input').default(0), // credits per 1K input tokens
  tokenPriceOutput: integer('token_price_output').default(0), // credits per 1K output tokens
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  providerModelUnique: unique('ai_models_provider_id_model_identifier_unique').on(table.providerId, table.modelIdentifier),
  providerIdx: index('ai_models_provider_id_idx').on(table.providerId),
  statusIdx: index('ai_models_status_idx').on(table.status),
  tierIdx: index('ai_models_tier_idx').on(table.tier),
}));
