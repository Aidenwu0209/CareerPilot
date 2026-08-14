import { readFile } from 'node:fs/promises';
import { summarize } from './load-stats.mjs';

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const baseUrl = argument('base-url', 'http://127.0.0.1:3000').replace(/\/$/, '');
const concurrency = Math.max(1, Number(argument('concurrency', '10')));
const durationSeconds = Math.max(1, Number(argument('duration', '30')));
const cookie = argument('cookie', process.env.CAREERPILOT_LOAD_COOKIE ?? '');
const scenarioPath = argument('scenario', 'scripts/load/scenarios/career-read-only.json');
const allowWrites = process.argv.includes('--allow-writes');
const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'));

if (!Array.isArray(scenario.requests) || scenario.requests.length === 0) throw new Error('Scenario must contain requests.');
if (!allowWrites && scenario.requests.some((item) => !['GET', 'HEAD'].includes((item.method ?? 'GET').toUpperCase()))) {
  throw new Error('Scenario contains mutations. Re-run with --allow-writes only against an isolated test database.');
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl) && !process.argv.includes('--allow-remote')) {
  throw new Error('Remote load tests require --allow-remote to prevent accidental production traffic.');
}

const deadline = Date.now() + durationSeconds * 1000;
const samples = [];
let cursor = 0;

async function worker() {
  while (Date.now() < deadline) {
    const request = scenario.requests[cursor++ % scenario.requests.length];
    const started = performance.now();
    try {
      const response = await fetch(`${baseUrl}${request.path}`, {
        method: request.method ?? 'GET',
        headers: { ...(cookie ? { cookie } : {}), ...(request.headers ?? {}) },
        body: request.body == null ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(Number(request.timeoutMs ?? 20_000)),
      });
      await response.arrayBuffer();
      samples.push({ ok: response.ok, status: response.status, durationMs: performance.now() - started, path: request.path });
    } catch (error) {
      samples.push({ ok: false, status: 0, durationMs: performance.now() - started, path: request.path, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, () => worker()));
const summary = summarize(samples, performance.now() - started);
const byStatus = Object.fromEntries([...new Set(samples.map((sample) => sample.status))].map((status) => [status, samples.filter((sample) => sample.status === status).length]));
const report = { scenario: scenario.name, baseUrl, concurrency, durationSeconds, ...summary, byStatus };
console.log(JSON.stringify(report, null, 2));

const maxErrorRate = Number(argument('max-error-rate', String(scenario.thresholds?.maxErrorRate ?? 0.01)));
const maxP95 = Number(argument('max-p95-ms', String(scenario.thresholds?.maxP95Ms ?? 1500)));
if (summary.errorRate > maxErrorRate || summary.latencyMs.p95 > maxP95) process.exitCode = 1;
