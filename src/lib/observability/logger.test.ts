import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from './logger';

afterEach(() => vi.restoreAllMocks());

describe('structured logger', () => {
  it('writes machine-readable JSON and redacts sensitive fields', () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    log('info', 'test.event', { requestId: 'req-1', accessToken: 'secret-value' });
    const parsed = JSON.parse(String(output.mock.calls[0][0]));
    expect(parsed).toMatchObject({ level: 'info', event: 'test.event', requestId: 'req-1', accessToken: '[redacted]' });
    expect(parsed.timestamp).toBeTypeOf('string');
  });
});
