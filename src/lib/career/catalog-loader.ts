import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import type { CareerCatalogBundle } from './catalog-import';

const FILES = {
  colleges: 'colleges.json',
  majors: 'majors.json',
  occupations: 'occupations.json',
  occupation_aliases: 'occupation_aliases.json',
  major_occupation_edges: 'major_occupation_edges.json',
  occupation_requirements: 'occupation_requirements.json',
  occupation_relations: 'occupation_relations.json',
  sources: 'sources.json',
  legacy_occupation_map: 'legacy_occupation_map.json',
} as const;

type ManifestFile = { sha256?: string; content_sha256?: string; count: number };
type CatalogManifest = Record<string, unknown> & { files: Record<string, ManifestFile> };

function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Load a Python-produced catalog directory and verify every declared byte hash
 * and item count before any database transaction is started.
 */
export async function loadCareerCatalogDirectory(directory: string): Promise<CareerCatalogBundle> {
  const root = resolve(directory);
  const manifestRaw = await readFile(resolve(root, 'catalog_manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestRaw) as CatalogManifest;
  if (!manifest.files || typeof manifest.files !== 'object') {
    throw new Error('catalog_manifest.json must contain a files object.');
  }

  const bundle: Partial<CareerCatalogBundle> = { manifest };
  for (const [key, filename] of Object.entries(FILES) as Array<[keyof typeof FILES, string]>) {
    const declaration = manifest.files[filename] ?? manifest.files[key];
    if (!declaration) throw new Error(`Manifest is missing ${filename}.`);
    const raw = await readFile(resolve(root, filename), 'utf8');
    const expectedHash = declaration.sha256 ?? declaration.content_sha256;
    if (!expectedHash || sha256(raw) !== expectedHash) throw new Error(`SHA-256 mismatch for ${filename}.`);
    const envelope = JSON.parse(raw) as { items?: unknown[] };
    if (!Array.isArray(envelope.items)) throw new Error(`${filename} must contain an items array.`);
    if (envelope.items.length !== declaration.count) {
      throw new Error(`Item count mismatch for ${filename}: expected ${declaration.count}, got ${envelope.items.length}.`);
    }
    (bundle as Record<string, unknown>)[key] = envelope;
  }
  const coverageDeclaration = manifest.files['coverage_report.json'];
  if (!coverageDeclaration) throw new Error('Manifest is missing coverage_report.json.');
  const coverageRaw = await readFile(resolve(root, 'coverage_report.json'), 'utf8');
  if (sha256(coverageRaw) !== (coverageDeclaration.sha256 ?? coverageDeclaration.content_sha256)) {
    throw new Error('SHA-256 mismatch for coverage_report.json.');
  }
  const coverage = JSON.parse(coverageRaw) as { items?: unknown[] };
  if (!Array.isArray(coverage.items) || coverage.items.length !== coverageDeclaration.count) {
    throw new Error('Item count mismatch for coverage_report.json.');
  }
  return bundle as CareerCatalogBundle;
}
