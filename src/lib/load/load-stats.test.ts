import { describe, expect, it } from 'vitest';
import { percentile, summarize } from '../../../scripts/load/load-stats.mjs';

describe('load-test statistics', () => {
  it('calculates nearest-rank percentiles', () => {
    expect(percentile([40, 10, 30, 20], 50)).toBe(20);
    expect(percentile([40, 10, 30, 20], 95)).toBe(40);
  });

  it('summarizes errors, throughput and latency', () => {
    expect(summarize([{ ok: true, durationMs: 10 }, { ok: false, durationMs: 30 }], 1000)).toMatchObject({
      requests: 2, failed: 1, errorRate: 0.5, requestsPerSecond: 2,
      latencyMs: { min: 10, p50: 10, p95: 30, p99: 30, max: 30 },
    });
  });
});
