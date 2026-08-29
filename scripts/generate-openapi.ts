import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOpenApiDocument } from './openapi-lib';

const root = process.cwd();
const output = join(root, 'public/openapi.json');
mkdirSync(join(root, 'public'), { recursive: true });
const document = buildOpenApiDocument(root);
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
console.log(`Generated ${Object.keys(document.paths).length} paths at ${output}`);
