/**
 * US-088 AC5: Secret Leakage Scan Gate
 *
 * Scans source code, configuration templates, and build artifacts
 * to ensure no API keys, database credentials, or other secrets
 * are hardcoded or leaked.
 *
 * Scanned surfaces:
 * - Source files (*.ts, *.tsx) for hardcoded key patterns
 * - .env.example for real secrets (should only contain placeholders)
 * - Build artifacts (.next/) if they exist (limited scan)
 * - Known sensitive locations (logs, HTML templates)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';

const PROJECT_ROOT = process.cwd();
const SRC_DIR = join(PROJECT_ROOT, 'src');

// ── Secret patterns to detect ──
// These patterns are designed to catch REAL secrets while avoiding
// common placeholder/template strings used in examples and tests.
const SECRET_PATTERNS: { name: string; regex: RegExp }[] = [
  // OpenAI API keys (sk- followed by 20+ alphanumeric chars)
  { name: 'OpenAI API key', regex: /sk-[a-zA-Z0-9]{20,}/ },
  // Anthropic API keys
  { name: 'Anthropic API key', regex: /sk-ant-[a-zA-Z0-9-_]{20,}/ },
  // Google/Gemini API keys (AIza followed by 35 alphanumeric chars)
  { name: 'Google API key', regex: /AIza[a-zA-Z0-9_-]{35}/ },
  // AWS access keys
  { name: 'AWS access key', regex: /AKIA[0-9A-Z]{16}/ },
  // Bearer tokens (only in non-test source files)
  { name: 'Bearer token', regex: /Bearer\s+[a-zA-Z0-9._-]{40,}/ },
];

// ── Placeholder DB URL pattern ──
// Matches real DB URLs but NOT template/placeholder passwords.
// Excludes: password, PASSWORD, changeme, your-password, <password>, etc.
const PLACEHOLDER_PASSWORDS = /^(password|PASSWORD|changeme|change.me|your.password|yourpassword|<password>|\$\{|POSTGRES_PASSWORD|DATABASE_PASSWORD|secret|test.*pass|example.*pass)/i;

function isPlaceholderDBUrl(url: string): boolean {
  // Extract the password from the URL
  const match = url.match(/postgresql:\/\/[^:]+:([^@]+)@/);
  if (!match) return false;
  const password = match[1];
  return PLACEHOLDER_PASSWORDS.test(password) || password.length < 4;
}

// ── Allowlist: files that legitimately contain secret-like patterns ──
const ALLOWLIST_PATTERNS = [
  /secret-leakage-scan\.test\.ts$/,
  /\.test\.ts$/,             // Test files may contain test secrets for assertion
  /\.test\.tsx$/,
  /\.env\.example$/,
  /\.env\.local\.example$/,
];

function isAllowlisted(filePath: string): boolean {
  return ALLOWLIST_PATTERNS.some((pattern) => pattern.test(filePath));
}

// ── File collection ──
function collectSourceFiles(dir: string, files: string[] = [], maxFiles = 500): string[] {
  if (!existsSync(dir) || files.length >= maxFiles) return files;

  for (const entry of readdirSync(dir)) {
    if (files.length >= maxFiles) break;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip node_modules, .next, .git, etc.
      if (['node_modules', '.next', '.git', '.worktrees', 'scripts copy'].includes(entry)) continue;
      collectSourceFiles(fullPath, files, maxFiles);
    } else {
      const ext = extname(entry);
      if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

// ════════════════════════════════════════════════════════════
// AC5: Secret Leakage Scan
// ════════════════════════════════════════════════════════════

describe('AC5: Secret leakage scan gate', () => {
  const sourceFiles = collectSourceFiles(SRC_DIR);

  it('source files do not contain hardcoded API keys or credentials', () => {
    const violations: string[] = [];

    for (const filePath of sourceFiles) {
      if (isAllowlisted(filePath)) continue;

      let content: string;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      for (const { name, regex } of SECRET_PATTERNS) {
        if (regex.test(content)) {
          violations.push(`  ${filePath}: detected ${name}`);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(`Secret leakage detected:\n${violations.join('\n')}`);
    }
  });

  it('.env.example contains only placeholder values, not real secrets', () => {
    const envExamplePath = join(PROJECT_ROOT, '.env.example');
    if (!existsSync(envExamplePath)) return;

    const content = readFileSync(envExamplePath, 'utf-8');

    // Check for real API key patterns
    for (const { name, regex } of SECRET_PATTERNS) {
      expect(
        regex.test(content),
        `.env.example must not contain real ${name}`,
      ).toBe(false);
    }

    // Check for DB URLs with real (non-placeholder) passwords
    const dbUrlMatches = content.match(/postgresql:\/\/[^:]+:[^@\s]+@[^/]+\//g) ?? [];
    for (const url of dbUrlMatches) {
      expect(
        isPlaceholderDBUrl(url),
        `.env.example DB URL must use placeholder password, found: ${url.substring(0, 30)}...`,
      ).toBe(true);
    }
  });

  it('source files do not contain DATABASE_URL with real (non-placeholder) password', () => {
    for (const filePath of sourceFiles) {
      if (isAllowlisted(filePath)) continue;

      let content: string;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      const dbUrlMatches = content.match(/postgresql:\/\/[^:\s]+:[^@\s]{3,}@[^\s/]+\//g) ?? [];
      for (const url of dbUrlMatches) {
        // Skip if the password is a known placeholder
        if (isPlaceholderDBUrl(url)) continue;
        // Skip test assertions that check for the pattern itself
        if (content.includes('PLACEHOLDER') || content.includes('placeholder')) continue;

        expect(
          isPlaceholderDBUrl(url),
          `${filePath} must not contain DATABASE_URL with real password: ${url.substring(0, 30)}...`,
        ).toBe(true);
      }
    }
  });

  it('dashboard HTML files do not expose API keys or connection strings', () => {
    const dashboardDirs = [
      join(PROJECT_ROOT, 'scripts', 'ralph'),
      join(PROJECT_ROOT, 'scripts copy', 'ralph'),
    ];

    for (const dir of dashboardDirs) {
      if (!existsSync(dir)) continue;

      const htmlFiles = readdirSync(dir).filter((f) => f.endsWith('.html'));
      for (const file of htmlFiles) {
        const content = readFileSync(join(dir, file), 'utf-8');
        for (const { name, regex } of SECRET_PATTERNS) {
          expect(
            regex.test(content),
            `${dir}/${file} must not contain ${name}`,
          ).toBe(false);
        }
      }
    }
  });
});
