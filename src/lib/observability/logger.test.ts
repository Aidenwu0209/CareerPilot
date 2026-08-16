import { afterEach, describe, expect, it, vi } from 'vitest';
import { trace } from '@opentelemetry/api';
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

  it('adds active OpenTelemetry trace correlation', () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
      spanContext: () => ({
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: '0123456789abcdef',
        traceFlags: 1,
      }),
    } as never);
    log('info', 'trace.test');

    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      event: 'trace.test',
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
    });
  });
});
