import { describe, expect, it } from 'vitest';
import { isValidRequestId, resolveRequestId } from './request-id';

describe('request correlation IDs', () => {
  it('preserves a safe upstream request ID', () => {
    expect(resolveRequestId('edge:req-42')).toBe('edge:req-42');
  });

  it('replaces missing or unsafe values with a UUID', () => {
    for (const value of [null, '', 'contains spaces', 'a'.repeat(129), '<script>']) {
      const requestId = resolveRequestId(value);
      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(isValidRequestId(requestId)).toBe(true);
    }
  });
});
