import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;
type Method = typeof METHODS[number];

export interface RouteOperation { method: Method; path: string; sourceFile: string }

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : entry.name === 'route.ts' ? [path] : [];
  });
}

function apiPath(file: string, apiRoot: string) {
  const segments = relative(apiRoot, file).split(sep).slice(0, -1)
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
    .map((segment) => segment.replace(/^\[\.\.\.(.+)]$/, '{$1}').replace(/^\[(.+)]$/, '{$1}'));
  return `/api/${segments.join('/')}`.replace(/\/$/, '');
}

export function scanApiOperations(root = process.cwd()): RouteOperation[] {
  const apiRoot = join(root, 'src/app/api');
  return walk(apiRoot).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    const path = apiPath(file, apiRoot);
    return METHODS.filter((method) => {
      const upper = method.toUpperCase();
      return new RegExp(`export\\s+(?:async\\s+)?function\\s+${upper}\\b|export\\s+const\\s+${upper}\\b|export\\s+const\\s*\\{[^}]*\\b${upper}\\b[^}]*\\}\\s*=`).test(source);
    }).map((method) => ({ method, path, sourceFile: relative(root, file).split(sep).join('/') }));
  }).sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function humanize(value: string) {
  return value.replace(/[{}]/g, '').replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function tagFor(path: string) {
  const parts = path.split('/').filter(Boolean).slice(1);
  if (parts[0] === 'admin') return `Admin ${humanize(parts[1] ?? 'Platform')}`;
  if (parts[0] === 'organizations') return 'Organizations';
  if (parts[0] === 'schools') return 'Schools';
  return humanize(parts[0] ?? 'Platform');
}

function responseSchema(path: string) {
  if (path.startsWith('/api/career')) return 'CareerResponse';
  if (path.startsWith('/api/billing') || path.startsWith('/api/credits')) return 'BillingResponse';
  if (path.startsWith('/api/organizations') || path.startsWith('/api/schools') || path.startsWith('/api/admin/organizations')) return 'OrganizationResponse';
  if (path.includes('/ai/') || path.startsWith('/api/models')) return 'AiResponse';
  if (path.startsWith('/api/auth') || path.includes('password')) return 'AuthResponse';
  return 'DataResponse';
}

function requestSchema(path: string) {
  if (path === '/api/billing/checkout') return 'CheckoutRequest';
  if (path === '/api/career/access') return 'CareerUnlockRequest';
  if (path === '/api/schools/invite/redeem') return 'SchoolInviteRequest';
  return 'JsonRequest';
}

function isPublic(path: string, method: Method) {
  return path.startsWith('/api/auth/')
    || path.startsWith('/api/health')
    || path.startsWith('/api/config')
    || path.startsWith('/api/legal/')
    || path.startsWith('/api/password/')
    || path.startsWith('/api/webhooks/')
    || (method === 'get' && path.startsWith('/api/public/'));
}

export function buildOpenApiDocument(root = process.cwd()) {
  const operations = scanApiOperations(root);
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of operations) {
    const params = [...operation.path.matchAll(/{([^}]+)}/g)].map((match) => ({
      name: match[1], in: 'path', required: true, schema: { type: 'string', minLength: 1 },
    }));
    const leaf = operation.path.split('/').filter(Boolean).slice(-2).join(' ');
    const operationId = `${operation.method}_${operation.path.replace(/^\/api\//, '').replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]+/g, '_')}`;
    const successStatus = operation.method === 'post' ? '201' : operation.method === 'delete' ? '200' : '200';
    paths[operation.path] ??= {};
    paths[operation.path][operation.method] = {
      tags: [tagFor(operation.path)],
      summary: `${operation.method.toUpperCase()} ${humanize(leaf)}`,
      operationId,
      'x-source-file': operation.sourceFile,
      ...(operation.path === '/api/resume/{id}/share' ? { deprecated: true } : {}),
      ...(isPublic(operation.path, operation.method) ? { security: [] } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(!['get', 'head', 'options'].includes(operation.method) ? {
        requestBody: {
          required: operation.method !== 'delete',
          content: { 'application/json': { schema: { $ref: `#/components/schemas/${requestSchema(operation.path)}` } } },
        },
      } : {}),
      responses: {
        [successStatus]: { description: 'Successful response', content: { 'application/json': { schema: { $ref: `#/components/schemas/${responseSchema(operation.path)}` } } } },
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '404': { $ref: '#/components/responses/NotFound' },
        '409': { $ref: '#/components/responses/Conflict' },
        '429': { $ref: '#/components/responses/RateLimited' },
        '500': { $ref: '#/components/responses/ServerError' },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'CareerPilot API', version: '0.4.1',
      description: `Generated from ${operations.length} implemented Route Handler operations. Regenerate with pnpm openapi:generate and verify with pnpm openapi:check.`,
    },
    servers: [{ url: '/', description: 'Current CareerPilot deployment' }],
    security: [{ CookieAuth: [] }, { BearerAuth: [] }],
    tags: [...new Set(operations.map((operation) => tagFor(operation.path)))].sort().map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        CookieAuth: { type: 'apiKey', in: 'cookie', name: 'authjs.session-token', description: 'CareerPilot authenticated session cookie.' },
        BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      responses: {
        BadRequest: { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        Unauthorized: { description: 'Authentication required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        Forbidden: { description: 'Authenticated but not authorized for this operation', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        NotFound: { description: 'Requested resource not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        Conflict: { description: 'The request conflicts with current resource state', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        RateLimited: { description: 'Rate limit exceeded', headers: { 'Retry-After': { schema: { type: 'integer' }, description: 'Seconds before retrying.' } }, content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        ServerError: { description: 'Unexpected server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      },
      schemas: {
        ErrorResponse: { type: 'object', required: ['error'], properties: { error: { type: 'string', examples: ['AUTH_REQUIRED'] }, message: { type: 'string' }, requestId: { type: 'string' } }, additionalProperties: true },
        Pagination: { type: 'object', properties: { limit: { type: 'integer' }, offset: { type: 'integer' }, count: { type: 'integer' } } },
        JsonRequest: { type: 'object', description: 'Request fields are validated by the linked Route Handler. See x-source-file for its exact Zod or runtime contract.', additionalProperties: true },
        CheckoutRequest: { type: 'object', required: ['planId'], properties: { planId: { type: 'string' }, locale: { type: 'string', enum: ['zh', 'en'], default: 'zh' } }, additionalProperties: false },
        CareerUnlockRequest: { type: 'object', required: ['feature'], properties: { feature: { type: 'string', enum: ['assessment_report', 'match_heatmap', 'full_path'] } }, additionalProperties: false },
        SchoolInviteRequest: { type: 'object', required: ['code'], properties: { code: { type: 'string', minLength: 6, maxLength: 128 } }, additionalProperties: false },
        DataResponse: { type: 'object', properties: { ok: { type: 'boolean' }, data: {}, pagination: { $ref: '#/components/schemas/Pagination' } }, additionalProperties: true },
        AuthResponse: { type: 'object', properties: { authenticated: { type: 'boolean' }, user: { type: ['object', 'null'], properties: { id: { type: 'string' }, email: { type: ['string', 'null'] }, name: { type: ['string', 'null'] } }, additionalProperties: true } }, additionalProperties: true },
        CareerResponse: { type: 'object', properties: { match: { type: ['object', 'null'] }, path: { type: ['object', 'null'] }, reports: { type: 'array', items: { type: 'object' } }, access: { type: 'object' }, locked: { type: 'boolean' }, history: { type: 'array', items: { type: 'object' } } }, additionalProperties: true },
        BillingResponse: { type: 'object', properties: { plans: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, code: { type: 'string' }, priceMinor: { type: 'integer' }, effectivePriceMinor: { type: 'integer' }, currency: { type: 'string' }, credits: { type: 'integer' } }, additionalProperties: true } }, orderId: { type: 'string' }, checkoutUrl: { type: ['string', 'null'], format: 'uri' }, balance: { type: 'integer' } }, additionalProperties: true },
        OrganizationResponse: { type: 'object', properties: { organization: { type: 'object' }, membership: { type: ['object', 'null'] }, domains: { type: 'array', items: { type: 'object' } }, invites: { type: 'array', items: { type: 'object' } }, discounts: { type: 'array', items: { type: 'object' } } }, additionalProperties: true },
        AiResponse: { type: 'object', properties: { operationId: { type: 'string' }, status: { type: 'string' }, result: {}, usage: { type: 'object' } }, additionalProperties: true },
      },
    },
  };
}
