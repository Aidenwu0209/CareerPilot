import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { CareerCatalogCache, type CatalogCacheStore } from './career-catalog-cache';

class SharedMemoryStore implements CatalogCacheStore {
  values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setEx(key: string, _ttlSeconds: number, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async incr(key: string): Promise<number> {
    const next = Number(this.values.get(key) ?? '0') + 1;
    this.values.set(key, String(next));
    return next;
  }
}

describe('CareerCatalogCache', () => {
  it('shares cached results across instances and invalidates through a generation bump', async () => {
    const store = new SharedMemoryStore();
    const writer = new CareerCatalogCache(store, 'test:catalog');
    const reader = new CareerCatalogCache(store, 'test:catalog');
    await writer.set('detail:OCC-1', { name: '旧名称' }, 60);
    expect(await reader.get('detail:OCC-1')).toEqual({ name: '旧名称' });
    await writer.invalidate();
    expect(await reader.get('detail:OCC-1')).toBeNull();
  });

  it('falls back to the process cache when the shared store is unavailable', async () => {
    const unavailable: CatalogCacheStore = {
      get: async () => { throw new Error('offline'); },
      setEx: async () => { throw new Error('offline'); },
      incr: async () => { throw new Error('offline'); },
    };
    const cache = new CareerCatalogCache(unavailable, 'test:fallback');
    await cache.set('list:{}', { items: ['ok'] }, 60);
    expect(await cache.get('list:{}')).toEqual({ items: ['ok'] });
    expect(cache.getStats().errors).toBeGreaterThan(0);
  });
});
