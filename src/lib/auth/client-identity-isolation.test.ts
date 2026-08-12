import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const PROJECT_ROOT = process.cwd();
const CLIENT_SOURCE_ROOTS = ['src/app', 'src/components', 'src/hooks', 'src/stores'];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!['.ts', '.tsx'].includes(extname(entry.name)) || entry.name.includes('.test.')) return [];
    return [path];
  });
}

describe('product client identity isolation', () => {
  it('never reads or sends the legacy fingerprint identity from client data flows', () => {
    const violations = CLIENT_SOURCE_ROOTS.flatMap((root) =>
      sourceFiles(join(PROJECT_ROOT, root)).flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return source.includes('jade_fingerprint') || source.includes('x-fingerprint')
          ? [relative(PROJECT_ROOT, file)]
          : [];
      }),
    );

    expect(violations).toEqual([]);
  });
});
