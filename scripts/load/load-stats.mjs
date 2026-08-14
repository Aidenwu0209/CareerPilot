export function percentile(values, target) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((target / 100) * sorted.length) - 1)];
}

export function summarize(samples, elapsedMs) {
  const latencies = samples.map((sample) => sample.durationMs);
  const failed = samples.filter((sample) => !sample.ok).length;
  return {
    requests: samples.length,
    failed,
    errorRate: samples.length ? failed / samples.length : 0,
    requestsPerSecond: elapsedMs > 0 ? samples.length / (elapsedMs / 1000) : 0,
    latencyMs: {
      min: latencies.length ? Math.min(...latencies) : 0,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies.length ? Math.max(...latencies) : 0,
    },
  };
}
