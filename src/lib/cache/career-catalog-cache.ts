import { createHash } from 'node:crypto';
import { logger } from '@/lib/observability/logger';

export interface CatalogCacheStore {
  get(key: string): Promise<string | null>;
  setEx(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  incr(key: string): Promise<number>;
}

export interface CatalogCacheStats {
  hits: number;
  misses: number;
  writes: number;
  errors: number;
}

interface LocalEntry {
  expiresAt: number;
  value: unknown;
}

const DEFAULT_PREFIX = 'careerpilot:career-catalog';
const LOCAL_MAX_ENTRIES = 128;

class RedisCatalogCacheStore implements CatalogCacheStore {
  private clientPromise: Promise<import('redis').RedisClientType> | null = null;

  constructor(private readonly url: string) {}

  private getClient(): Promise<import('redis').RedisClientType> {
    if (!this.clientPromise) {
      this.clientPromise = import('redis').then(async ({ createClient }) => {
        const client = createClient({ url: this.url });
        client.on('error', () => {
          // Individual cache operations report errors and degrade to the database.
        });
        await client.connect();
        return client as import('redis').RedisClientType;
      }).catch((error) => {
        this.clientPromise = null;
        throw error;
      });
    }
    return this.clientPromise;
  }

  async get(key: string): Promise<string | null> {
    return (await this.getClient()).get(key);
  }

  async setEx(key: string, ttlSeconds: number, value: string): Promise<unknown> {
    return (await this.getClient()).setEx(key, ttlSeconds, value);
  }

  async incr(key: string): Promise<number> {
    return (await this.getClient()).incr(key);
  }
}

function digest(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export class CareerCatalogCache {
  private readonly local = new Map<string, LocalEntry>();
  private localGeneration = 0;
  private readonly stats: CatalogCacheStats = { hits: 0, misses: 0, writes: 0, errors: 0 };

  constructor(
    private readonly store: CatalogCacheStore | null,
    private readonly prefix = DEFAULT_PREFIX,
  ) {}

  static fromEnvironment(): CareerCatalogCache {
    const url = process.env.REDIS_URL?.trim();
    return new CareerCatalogCache(url ? new RedisCatalogCacheStore(url) : null);
  }

  private generationKey(): string {
    return `${this.prefix}:generation`;
  }

  private dataKey(generation: number, key: string): string {
    return `${this.prefix}:data:${generation}:${digest(key)}`;
  }

  private async generation(): Promise<number> {
    if (!this.store) return this.localGeneration;
    try {
      const value = await this.store.get(this.generationKey());
      return value == null ? 0 : Number.parseInt(value, 10) || 0;
    } catch (error) {
      this.stats.errors += 1;
      logger.warn('career.catalog_cache_unavailable', { operation: 'generation', error });
      return this.localGeneration;
    }
  }

  private remember(key: string, value: unknown, ttlSeconds: number): void {
    if (this.local.size >= LOCAL_MAX_ENTRIES) {
      const oldest = this.local.keys().next().value;
      if (oldest) this.local.delete(oldest);
    }
    this.local.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async get<T>(key: string): Promise<T | null> {
    const generation = await this.generation();
    const dataKey = this.dataKey(generation, key);
    const local = this.local.get(dataKey);
    if (local && local.expiresAt > Date.now()) {
      this.stats.hits += 1;
      return local.value as T;
    }
    if (local) this.local.delete(dataKey);

    if (this.store) {
      try {
        const raw = await this.store.get(dataKey);
        if (raw != null) {
          const parsed = JSON.parse(raw) as T;
          this.stats.hits += 1;
          return parsed;
        }
      } catch (error) {
        this.stats.errors += 1;
        logger.warn('career.catalog_cache_unavailable', { operation: 'get', error });
      }
    }
    this.stats.misses += 1;
    return null;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const generation = await this.generation();
    const dataKey = this.dataKey(generation, key);
    this.remember(dataKey, value, ttlSeconds);
    if (this.store) {
      try {
        await this.store.setEx(dataKey, ttlSeconds, JSON.stringify(value));
      } catch (error) {
        this.stats.errors += 1;
        logger.warn('career.catalog_cache_unavailable', { operation: 'set', error });
      }
    }
    this.stats.writes += 1;
  }

  async invalidate(): Promise<void> {
    this.local.clear();
    this.localGeneration += 1;
    if (this.store) {
      try {
        this.localGeneration = await this.store.incr(this.generationKey());
      } catch (error) {
        this.stats.errors += 1;
        logger.warn('career.catalog_cache_unavailable', { operation: 'invalidate', error });
      }
    }
  }

  getStats(): Readonly<CatalogCacheStats> {
    return { ...this.stats };
  }
}

export const careerCatalogCache = CareerCatalogCache.fromEnvironment();
