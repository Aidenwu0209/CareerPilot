import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  detectLegacyByokHeaders,
  detectLegacyByokBody,
  warnLegacyByok,
} from './legacy-detect';

describe('US-050: Legacy BYOK detection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── detectLegacyByokHeaders ──

  describe('detectLegacyByokHeaders', () => {
    it('returns empty array when no legacy headers present', () => {
      const req = new Request('http://localhost/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      expect(detectLegacyByokHeaders(req)).toEqual([]);
    });

    it('detects x-api-key header', () => {
      const req = new Request('http://localhost/api/ai/chat', {
        method: 'POST',
        headers: { 'x-api-key': 'sk-test123' },
      });
      expect(detectLegacyByokHeaders(req)).toContain('legacy_header:x-api-key');
    });

    it('detects x-provider header', () => {
      const req = new Request('http://localhost/api/ai/chat', {
        method: 'POST',
        headers: { 'x-provider': 'openai' },
      });
      expect(detectLegacyByokHeaders(req)).toContain('legacy_header:x-provider');
    });

    it('detects x-base-url header', () => {
      const req = new Request('http://localhost/api/ai/chat', {
        method: 'POST',
        headers: { 'x-base-url': 'https://evil.example.com' },
      });
      expect(detectLegacyByokHeaders(req)).toContain('legacy_header:x-base-url');
    });

    it('detects x-model header', () => {
      const req = new Request('http://localhost/api/ai/chat', {
        method: 'POST',
        headers: { 'x-model': 'gpt-4' },
      });
      expect(detectLegacyByokHeaders(req)).toContain('legacy_header:x-model');
    });

    it('detects multiple legacy headers at once', () => {
      const req = new Request('http://localhost/api/ai/chat', {
        method: 'POST',
        headers: {
          'x-api-key': 'sk-test',
          'x-provider': 'anthropic',
          'x-base-url': 'https://evil.example.com',
        },
      });
      const warnings = detectLegacyByokHeaders(req);
      expect(warnings).toHaveLength(3);
      expect(warnings).toContain('legacy_header:x-api-key');
      expect(warnings).toContain('legacy_header:x-provider');
      expect(warnings).toContain('legacy_header:x-base-url');
    });
  });

  // ── detectLegacyByokBody ──

  describe('detectLegacyByokBody', () => {
    it('returns empty array for clean body', () => {
      expect(detectLegacyByokBody({ message: 'hello' })).toEqual([]);
    });

    it('returns empty array for null/undefined', () => {
      expect(detectLegacyByokBody(null)).toEqual([]);
      expect(detectLegacyByokBody(undefined)).toEqual([]);
    });

    it('returns empty array for arrays', () => {
      expect(detectLegacyByokBody([1, 2, 3])).toEqual([]);
    });

    it('detects apiKey in body', () => {
      expect(detectLegacyByokBody({ apiKey: 'sk-test' })).toContain('legacy_body:apiKey');
    });

    it('detects api_key in body', () => {
      expect(detectLegacyByokBody({ api_key: 'sk-test' })).toContain('legacy_body:api_key');
    });

    it('detects provider in body', () => {
      expect(detectLegacyByokBody({ provider: 'openai' })).toContain('legacy_body:provider');
    });

    it('detects baseURL in body', () => {
      expect(detectLegacyByokBody({ baseURL: 'https://evil.com' })).toContain('legacy_body:baseURL');
    });

    it('detects baseUrl in body', () => {
      expect(detectLegacyByokBody({ baseUrl: 'https://evil.com' })).toContain('legacy_body:baseUrl');
    });

    it('ignores empty/null values', () => {
      expect(detectLegacyByokBody({ apiKey: '', provider: null })).toEqual([]);
    });

    it('detects multiple body fields', () => {
      const warnings = detectLegacyByokBody({
        apiKey: 'sk-test',
        baseURL: 'https://evil.com',
        provider: 'openai',
      });
      expect(warnings).toHaveLength(3);
    });
  });

  // ── warnLegacyByok (async, integration) ──

  describe('warnLegacyByok', () => {
    it('logs sanitized warning when legacy headers detected', async () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const req = new Request('http://localhost/api/ai/chat', {
        method: 'POST',
        headers: { 'x-api-key': 'sk-super-secret-key' },
      });
      await warnLegacyByok(req);
      expect(spy).toHaveBeenCalledTimes(1);
      const msg = spy.mock.calls[0][0];
      expect(msg).toContain('legacy-byok');
      // Must not contain the actual API key value
      expect(msg).not.toContain('sk-super-secret-key');
    });

    it('does not log when no legacy headers', async () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const req = new Request('http://localhost/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      await warnLegacyByok(req);
      expect(spy).not.toHaveBeenCalled();
    });

    it('detects body apiKey in JSON request', async () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const req = new Request('http://localhost/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'sk-body-key', message: 'hello' }),
      });
      await warnLegacyByok(req);
      expect(spy).toHaveBeenCalledTimes(1);
      const msg = spy.mock.calls[0][0];
      expect(msg).toContain('legacy_body:apiKey');
      // Must not contain the actual key value
      expect(msg).not.toContain('sk-body-key');
    });

    it('preserves request body for downstream consumers after detection', async () => {
      const req = new Request('http://localhost/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'sk-test', message: 'hello' }),
      });
      await warnLegacyByok(req);
      // Body should still be readable
      const body = await req.json();
      expect(body.message).toBe('hello');
    });

    it('handles non-JSON content type without body detection', async () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const req = new Request('http://localhost/api/linkedin-photo', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data' },
      });
      await warnLegacyByok(req);
      expect(spy).not.toHaveBeenCalled();
    });

    it('handles invalid JSON body gracefully', async () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const req = new Request('http://localhost/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not valid json',
      });
      await warnLegacyByok(req);
      expect(spy).not.toHaveBeenCalled();
    });

    it('detects both headers and body fields simultaneously', async () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const req = new Request('http://localhost/api/ai/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-provider': 'openai',
        },
        body: JSON.stringify({ apiKey: 'sk-test' }),
      });
      await warnLegacyByok(req);
      expect(spy).toHaveBeenCalledTimes(1);
      const msg = spy.mock.calls[0][0];
      expect(msg).toContain('legacy_header:x-provider');
      expect(msg).toContain('legacy_body:apiKey');
    });
  });
});
