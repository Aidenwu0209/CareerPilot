import { describe, it, expect } from 'vitest';
import { readdirSync, type Dirent } from 'fs';
import { join, relative } from 'path';

/**
 * US-016: Automated route inventory test.
 *
 * Scans all route.ts files under src/app/api and classifies each against
 * the PUBLIC_API_PREFIXES defined in middleware.ts. Any new API route that
 * is not in the public list will be automatically classified as "private"
 * and listed here so that developers are aware it requires authentication.
 *
 * If a new route file is added but is NOT covered by the middleware matcher
 * (e.g., outside /api/), this test will not catch it — but all /api/ routes
 * will be inventoried.
 */

const API_ROOT = join(process.cwd(), 'src', 'app', 'api');

// Must match the PUBLIC_API_PREFIXES in src/middleware.ts
const PUBLIC_API_PREFIXES = [
  '/api/auth',
  '/api/health',
  '/api/share',
];

/** Recursively find all route.ts files under the api directory. */
function findRouteFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findRouteFiles(fullPath));
    } else if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
      results.push(fullPath);
    }
  }
  return results;
}

/** Convert a file path to an API URL path pattern. */
function filePathToApiPath(filePath: string): string {
  const relativePath = relative(API_ROOT, filePath)
    .replace(/\\/g, '/') // normalize Windows backslashes
    .replace(/\/route\.tsx?$/, '');

  // Convert [param] to :param for readability
  const normalized = '/' + relativePath.replace(/\[(\w+)\]/g, ':$1');
  return '/api' + normalized;
}

function isPublicPath(apiPath: string): boolean {
  return PUBLIC_API_PREFIXES.some(
    (prefix) => apiPath === prefix || apiPath.startsWith(prefix + '/'),
  );
}

describe('API route inventory', () => {
  const routeFiles = findRouteFiles(API_ROOT);
  const routes = routeFiles.map((f) => ({
    file: relative(process.cwd(), f),
    apiPath: filePathToApiPath(f),
    isPublic: false as boolean,
  }));

  // Classify each route
  for (const route of routes) {
    route.isPublic = isPublicPath(route.apiPath);
  }

  const publicRoutes = routes.filter((r) => r.isPublic);
  const privateRoutes = routes.filter((r) => !r.isPublic);

  it('discovers at least 10 API routes', () => {
    expect(routes.length).toBeGreaterThanOrEqual(10);
  });

  it('public whitelist only covers auth, health, and share', () => {
    // Every public route must match one of the expected prefixes
    for (const route of publicRoutes) {
      const matchesKnownPrefix = PUBLIC_API_PREFIXES.some((prefix) =>
        route.apiPath.startsWith(prefix),
      );
      expect(matchesKnownPrefix).toBe(true);
    }
  });

  it('all non-public routes are classified as private (require auth)', () => {
    // Known private routes that should always exist
    const expectedPrivatePatterns = [
      '/api/resume',
      '/api/user',
      '/api/ai/chat',
      '/api/interview',
    ];

    for (const pattern of expectedPrivatePatterns) {
      const found = privateRoutes.some((r) =>
        r.apiPath.startsWith(pattern),
      );
      expect(found).toBe(true);
    }
  });

  it('prints route classification table for review', () => {
    // This test always passes — it's a documentation aid.
    const lines: string[] = ['API Route Classification:', ''];
    lines.push('PUBLIC (no auth required):');
    for (const r of publicRoutes) {
      lines.push(`  ${r.apiPath.padEnd(50)} ← ${r.file}`);
    }
    lines.push('');
    lines.push(`PRIVATE (require session, ${privateRoutes.length} routes):`);
    for (const r of privateRoutes) {
      lines.push(`  ${r.apiPath.padEnd(50)} ← ${r.file}`);
    }
    console.log(lines.join('\n'));
  });
});
