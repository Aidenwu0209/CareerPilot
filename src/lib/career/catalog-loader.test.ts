import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCareerCatalogDirectory } from './catalog-loader';

const catalogFiles = [
  'colleges.json',
  'majors.json',
  'occupations.json',
  'occupation_aliases.json',
  'major_occupation_edges.json',
  'occupation_requirements.json',
  'occupation_relations.json',
  'sources.json',
  'legacy_occupation_map.json',
  'coverage_report.json',
];

const temporaryDirectories: string[] = [];

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function createCatalogFixture(lineEnding: '\n' | '\r\n') {
  const directory = await mkdtemp(join(tmpdir(), 'careerpilot-catalog-'));
  temporaryDirectories.push(directory);
  const canonical = `${JSON.stringify({ schema_version: '1.0.0', items: [] }, null, 2)}\n`;
  const manifest = {
    files: Object.fromEntries(catalogFiles.map((filename) => [
      filename,
      { count: 0, sha256: hash(canonical) },
    ])),
  };
  await Promise.all([
    ...catalogFiles.map((filename) => writeFile(
      join(directory, filename),
      canonical.replace(/\n/g, lineEnding),
      'utf8',
    )),
    writeFile(join(directory, 'catalog_manifest.json'), JSON.stringify(manifest), 'utf8'),
  ]);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('loadCareerCatalogDirectory', () => {
  it('accepts a Windows CRLF checkout when canonical LF hashes match', async () => {
    const directory = await createCatalogFixture('\r\n');

    const bundle = await loadCareerCatalogDirectory(directory);

    expect(bundle.occupations.items).toEqual([]);
  });

  it('still rejects content changes unrelated to line endings', async () => {
    const directory = await createCatalogFixture('\r\n');
    await writeFile(
      join(directory, 'colleges.json'),
      JSON.stringify({ schema_version: '1.0.0', items: [{ code: 'tampered' }] }),
      'utf8',
    );

    await expect(loadCareerCatalogDirectory(directory)).rejects.toThrow(
      'SHA-256 mismatch for colleges.json',
    );
  });
});
