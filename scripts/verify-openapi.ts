import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanApiOperations } from './openapi-lib';

const root = process.cwd();
const document = JSON.parse(readFileSync(join(root, 'public/openapi.json'), 'utf8')) as {
  openapi?: string;
  paths?: Record<string, Record<string, { operationId?: string; parameters?: Array<{ name: string; in: string; required?: boolean }> }>>;
};
if (document.openapi !== '3.1.0' || !document.paths) throw new Error('OpenAPI document must be version 3.1.0 and contain paths.');
const source = scanApiOperations(root);
const missing = source.filter((operation) => !document.paths?.[operation.path]?.[operation.method]);
const stale = Object.entries(document.paths).flatMap(([path, methods]) => Object.keys(methods)
  .filter((method) => ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method))
  .filter((method) => !source.some((operation) => operation.path === path && operation.method === method))
  .map((method) => `${method.toUpperCase()} ${path}`));
const operationIds = source.map((operation) => document.paths?.[operation.path]?.[operation.method]?.operationId).filter(Boolean) as string[];
const duplicates = operationIds.filter((id, index) => operationIds.indexOf(id) !== index);
const badParams = source.flatMap((operation) => [...operation.path.matchAll(/{([^}]+)}/g)].map((match) => ({ operation, name: match[1] })))
  .filter(({ operation, name }) => !document.paths?.[operation.path]?.[operation.method]?.parameters?.some((parameter) => parameter.in === 'path' && parameter.name === name && parameter.required));
if (missing.length || stale.length || duplicates.length || badParams.length) {
  throw new Error(JSON.stringify({
    missing: missing.map((item) => `${item.method.toUpperCase()} ${item.path}`), stale,
    duplicateOperationIds: [...new Set(duplicates)], badPathParameters: badParams.map(({ operation, name }) => `${operation.method.toUpperCase()} ${operation.path}:${name}`),
  }, null, 2));
}
console.log(`OpenAPI coverage verified: ${source.length} operations across ${Object.keys(document.paths).length} paths.`);
