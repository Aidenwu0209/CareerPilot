import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectLegacyByok, warnLegacyByok } from './legacy-detect';

describe('US-050: Legacy BYOK detection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array when no legacy headers present', () => {
    const req = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(detectLegacyByok(req)).toEqual([]);
  });

  it('detects x-api-key header', () => {
    const req = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-test123' },
    });
    const warnings = detectLegacyByok(req);
    expect(warnings).toContain('legacy_header:x-api-key');
  });

  it('detects x-provider header', () => {
    const req = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: { 'x-provider': 'openai' },
    });
    expect(detectLegacyByok(req)).toContain('legacy_header:x-provider');
  });

  it('detects x-base-url header', () => {
    const req = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: { 'x-base-url': 'https://evil.example.com' },
    });
    expect(detectLegacyByok(req)).toContain('legacy_header:x-base-url');
  });

  it('detects x-model header', () => {
    const req = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: { 'x-model': 'gpt-4' },
    });
    expect(detectLegacyByok(req)).toContain('legacy_header:x-model');
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
    const warnings = detectLegacyByok(req);
    expect(warnings).toHaveLength(3);
    expect(warnings).toContain('legacy_header:x-api-key');
    expect(warnings).toContain('legacy_header:x-provider');
    expect(warnings).toContain('legacy_header:x-base-url');
  });

  it('warnLegacyByok logs sanitized warning when headers detected', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const req = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-super-secret-key' },
    });
    warnLegacyByok(req);
    expect(spy).toHaveBeenCalledTimes(1);
    const msg = spy.mock.calls[0][0];
    expect(msg).toContain('legacy-byok');
    // Must not contain the actual API key value
    expect(msg).not.toContain('sk-super-secret-key');
  });

  it('warnLegacyByok does not log when no legacy headers', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const req = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    warnLegacyByok(req);
    expect(spy).not.toHaveBeenCalled();
  });
});
