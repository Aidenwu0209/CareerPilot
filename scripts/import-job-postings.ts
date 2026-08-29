import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { dbReady } from '@/lib/db';
import { importJobPosting } from '@/lib/career/job-posting-service';

const manifestSchema = z.object({ source: z.string().min(1), license: z.string().min(1), obtainedAt: z.string().date(), termsUrl: z.string().url() });

function parseArgs() {
  const args = process.argv.slice(2);
  const value = (name: string) => args[args.indexOf(name) + 1];
  const file = value('--file'); const manifest = value('--manifest');
  if (!file || !manifest) throw new Error('Usage: pnpm career:jobs -- --file jobs.csv --manifest jobs.manifest.json');
  return { file: resolve(file), manifest: resolve(manifest) };
}

function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && text[index + 1] === '\n') index += 1; row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift()?.map((item) => item.trim()) ?? [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

const { file, manifest } = parseArgs();
const license = manifestSchema.parse(JSON.parse(await readFile(manifest, 'utf8')));
const rows = parseCsv(await readFile(file, 'utf8'));
await dbReady;
let imported = 0;
for (const row of rows) {
  await importJobPosting({
    source: license.source, externalId: row.external_id || row.id, company: row.company, industry: row.industry,
    title: row.title, city: row.city, description: row.description, skills: row.skills, salary: row.salary,
    occupationCode: row.occupation_code, sourceUrl: row.source_url, publishedAt: row.published_at, expiresAt: row.expires_at,
  });
  imported += 1;
}
process.stdout.write(JSON.stringify({ imported, source: license.source, license: license.license }) + '\n');
