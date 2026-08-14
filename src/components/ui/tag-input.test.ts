import { describe, expect, it } from 'vitest';
import { normalizeTags } from './tag-input';

describe('normalizeTags', () => {
  it('trims, removes empty values and de-duplicates while preserving order', () => {
    expect(normalizeTags([' AI ', '', 'Kuching', 'AI'])).toEqual(['AI', 'Kuching']);
  });
});
