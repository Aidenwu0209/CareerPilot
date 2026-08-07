import { describe, it, expect } from 'vitest';
import {
  ALLOWED_IMAGE_MIME,
  ALLOWED_UPLOAD_MIME,
  MAX_IMAGE_SIZE,
  MAX_FILE_SIZE,
  MAX_PDF_PAGES,
  MAX_CLIENT_MESSAGES,
  MAX_MESSAGE_LENGTH,
  MAX_AI_STEPS,
  MAX_PROMPT_LENGTH,
  MAX_SHORT_TEXT_LENGTH,
  MAX_JSON_BODY_BYTES,
  MAX_ARRAY_LENGTH,
  validateMimeType,
  validateFileSize,
  validateBase64Image,
  validatePromptLength,
  validateChatMessages,
  sanitizedError,
  type ValidationResult,
} from './input-limits';

/** Extract error message from a failed validation result (for test assertions). */
function errMsg(r: ValidationResult): string {
  return (r as { ok: false; error: string }).error;
}

describe('Input Limits Constants', () => {
  it('exports all required limit constants', () => {
    expect(ALLOWED_IMAGE_MIME).toBeDefined();
    expect(ALLOWED_UPLOAD_MIME).toBeDefined();
    expect(MAX_IMAGE_SIZE).toBeGreaterThan(0);
    expect(MAX_FILE_SIZE).toBeGreaterThan(0);
    expect(MAX_PDF_PAGES).toBeGreaterThan(0);
    expect(MAX_CLIENT_MESSAGES).toBeGreaterThan(0);
    expect(MAX_MESSAGE_LENGTH).toBeGreaterThan(0);
    expect(MAX_AI_STEPS).toBeGreaterThan(0);
    expect(MAX_PROMPT_LENGTH).toBeGreaterThan(0);
    expect(MAX_SHORT_TEXT_LENGTH).toBeGreaterThan(0);
    expect(MAX_JSON_BODY_BYTES).toBeGreaterThan(0);
    expect(MAX_ARRAY_LENGTH).toBeGreaterThan(0);
  });

  it('image MIME list only contains valid image types', () => {
    expect(ALLOWED_IMAGE_MIME).toContain('image/png');
    expect(ALLOWED_IMAGE_MIME).toContain('image/jpeg');
    expect(ALLOWED_IMAGE_MIME).toContain('image/webp');
    expect(ALLOWED_IMAGE_MIME).not.toContain('application/pdf');
  });

  it('upload MIME list includes PDF in addition to images', () => {
    expect(ALLOWED_UPLOAD_MIME).toContain('application/pdf');
    for (const mime of ALLOWED_IMAGE_MIME) {
      expect(ALLOWED_UPLOAD_MIME).toContain(mime);
    }
  });

  it('image size limit is smaller than file size limit', () => {
    expect(MAX_IMAGE_SIZE).toBeLessThanOrEqual(MAX_FILE_SIZE);
  });

  it('JSON body size is larger than individual field limits but bounded', () => {
    expect(MAX_JSON_BODY_BYTES).toBeLessThan(1024 * 1024); // < 1MB
    expect(MAX_JSON_BODY_BYTES).toBeGreaterThan(MAX_PROMPT_LENGTH); // body > single field
  });
});

describe('validateMimeType', () => {
  it('accepts valid image MIME types', () => {
    expect(validateMimeType('image/png').ok).toBe(true);
    expect(validateMimeType('image/jpeg').ok).toBe(true);
    expect(validateMimeType('image/webp').ok).toBe(true);
  });

  it('accepts application/pdf for upload MIME list', () => {
    expect(validateMimeType('application/pdf').ok).toBe(true);
  });

  it('rejects forged MIME types', () => {
    // Attacker sets Content-Type to something harmless but uploads executable
    const result = validateMimeType('application/x-msdownload');
    expect(result.ok).toBe(false);
    expect(errMsg(result)).toBeDefined();
  });

  it('rejects generic octet-stream', () => {
    const result = validateMimeType('application/octet-stream');
    expect(result.ok).toBe(false);
  });

  it('rejects empty MIME', () => {
    expect(validateMimeType('').ok).toBe(false);
  });

  it('rejects image/svg+xml (XSS risk)', () => {
    expect(validateMimeType('image/svg+xml').ok).toBe(false);
  });

  it('rejects text/html (XSS risk)', () => {
    expect(validateMimeType('text/html').ok).toBe(false);
  });

  it('respects custom allowed list', () => {
    const result = validateMimeType('image/png', ['image/gif']);
    expect(result.ok).toBe(false);
  });
});

describe('validateFileSize', () => {
  it('accepts files within limit', () => {
    expect(validateFileSize(1024).ok).toBe(true);
    expect(validateFileSize(MAX_FILE_SIZE).ok).toBe(true);
  });

  it('rejects zero-size files', () => {
    expect(validateFileSize(0).ok).toBe(false);
  });

  it('rejects negative sizes', () => {
    expect(validateFileSize(-1).ok).toBe(false);
  });

  it('rejects files exceeding limit', () => {
    const result = validateFileSize(MAX_FILE_SIZE + 1);
    expect(result.ok).toBe(false);
    expect(errMsg(result)).toContain('too large');
  });

  it('boundary: exactly at limit passes', () => {
    expect(validateFileSize(MAX_FILE_SIZE).ok).toBe(true);
  });

  it('boundary: one byte over limit fails', () => {
    expect(validateFileSize(MAX_FILE_SIZE + 1).ok).toBe(false);
  });

  it('uses custom max when provided', () => {
    expect(validateFileSize(1024, 512).ok).toBe(false);
    expect(validateFileSize(512, 512).ok).toBe(true);
  });
});

describe('validateBase64Image', () => {
  function makeDataUrl(mime: string, base64: string): string {
    return `data:${mime};base64,${base64}`;
  }

  function makeBase64(byteLen: number): string {
    return 'A'.repeat(Math.ceil((byteLen * 4) / 3));
  }

  it('accepts valid PNG data URL', () => {
    const result = validateBase64Image(makeDataUrl('image/png', makeBase64(100)));
    expect(result.ok).toBe(true);
  });

  it('accepts valid JPEG data URL', () => {
    const result = validateBase64Image(makeDataUrl('image/jpeg', makeBase64(100)));
    expect(result.ok).toBe(true);
  });

  it('accepts valid WebP data URL', () => {
    const result = validateBase64Image(makeDataUrl('image/webp', makeBase64(100)));
    expect(result.ok).toBe(true);
  });

  it('rejects forged MIME: image/gif not in whitelist', () => {
    const result = validateBase64Image(makeDataUrl('image/gif', makeBase64(100)));
    expect(result.ok).toBe(false);
  });

  it('rejects forged MIME: image/svg+xml (XSS)', () => {
    const result = validateBase64Image(makeDataUrl('image/svg+xml', makeBase64(100)));
    expect(result.ok).toBe(false);
  });

  it('rejects non-data-url format', () => {
    expect(validateBase64Image('just-a-string').ok).toBe(false);
    expect(validateBase64Image('http://example.com/image.png').ok).toBe(false);
  });

  it('rejects oversized base64 image', () => {
    // Encode more than MAX_IMAGE_SIZE bytes
    const oversized = makeBase64(MAX_IMAGE_SIZE + 1);
    const result = validateBase64Image(makeDataUrl('image/png', oversized));
    expect(result.ok).toBe(false);
    expect(errMsg(result)).toContain('too large');
  });

  it('boundary: image at exactly MAX_IMAGE_SIZE bytes', () => {
    // Create base64 that decodes to exactly MAX_IMAGE_SIZE bytes
    const exactB64 = 'A'.repeat((MAX_IMAGE_SIZE * 4) / 3);
    const result = validateBase64Image(makeDataUrl('image/png', exactB64));
    expect(result.ok).toBe(true);
  });

  it('boundary: image one byte over MAX_IMAGE_SIZE', () => {
    const overB64 = 'A'.repeat(Math.ceil(((MAX_IMAGE_SIZE + 1) * 4) / 3));
    const result = validateBase64Image(makeDataUrl('image/png', overB64));
    expect(result.ok).toBe(false);
  });
});

describe('validatePromptLength', () => {
  it('accepts text within limit', () => {
    expect(validatePromptLength('hello').ok).toBe(true);
  });

  it('accepts text at exactly the limit', () => {
    const text = 'A'.repeat(MAX_PROMPT_LENGTH);
    expect(validatePromptLength(text).ok).toBe(true);
  });

  it('rejects text one character over the limit', () => {
    const text = 'A'.repeat(MAX_PROMPT_LENGTH + 1);
    const result = validatePromptLength(text);
    expect(result.ok).toBe(false);
    expect(errMsg(result)).toContain('too long');
  });

  it('accepts custom max length', () => {
    expect(validatePromptLength('hello', 3).ok).toBe(false);
    expect(validatePromptLength('hi', 3).ok).toBe(true);
  });

  it('boundary: empty string passes', () => {
    expect(validatePromptLength('').ok).toBe(true);
  });

  it('boundary: exactly at custom limit', () => {
    expect(validatePromptLength('AB', 2).ok).toBe(true);
  });

  it('boundary: one over custom limit', () => {
    expect(validatePromptLength('ABC', 2).ok).toBe(false);
  });
});

describe('validateChatMessages', () => {
  it('accepts a small message array', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];
    expect(validateChatMessages(messages).ok).toBe(true);
  });

  it('accepts messages with parts array format', () => {
    const messages = [
      { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ];
    expect(validateChatMessages(messages).ok).toBe(true);
  });

  it('accepts array at exactly MAX_CLIENT_MESSAGES', () => {
    const messages = Array.from({ length: MAX_CLIENT_MESSAGES }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'ok',
    }));
    expect(validateChatMessages(messages).ok).toBe(true);
  });

  it('rejects array exceeding MAX_CLIENT_MESSAGES', () => {
    const messages = Array.from({ length: MAX_CLIENT_MESSAGES + 1 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'ok',
    }));
    const result = validateChatMessages(messages);
    expect(result.ok).toBe(false);
    expect(errMsg(result)).toContain('Too many messages');
  });

  it('rejects single message content exceeding MAX_MESSAGE_LENGTH', () => {
    const messages = [
      { role: 'user', content: 'A'.repeat(MAX_MESSAGE_LENGTH + 1) },
    ];
    const result = validateChatMessages(messages);
    expect(result.ok).toBe(false);
    expect(errMsg(result)).toContain('too long');
  });

  it('boundary: message content at exactly MAX_MESSAGE_LENGTH', () => {
    const messages = [
      { role: 'user', content: 'A'.repeat(MAX_MESSAGE_LENGTH) },
    ];
    expect(validateChatMessages(messages).ok).toBe(true);
  });

  it('rejects parts text exceeding MAX_MESSAGE_LENGTH', () => {
    const messages = [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'A'.repeat(MAX_MESSAGE_LENGTH + 1) }],
      },
    ];
    const result = validateChatMessages(messages);
    expect(result.ok).toBe(false);
  });

  it('boundary: parts text at exactly MAX_MESSAGE_LENGTH', () => {
    const messages = [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'A'.repeat(MAX_MESSAGE_LENGTH) }],
      },
    ];
    expect(validateChatMessages(messages).ok).toBe(true);
  });

  it('handles messages with non-string content gracefully', () => {
    const messages = [
      { role: 'user', content: 123 },
      { role: 'assistant', content: null },
    ];
    expect(validateChatMessages(messages).ok).toBe(true);
  });

  it('handles empty array', () => {
    expect(validateChatMessages([]).ok).toBe(true);
  });

  it('handles non-object entries gracefully', () => {
    expect(validateChatMessages(['string', 123, null]).ok).toBe(true);
  });
});

describe('sanitizedError', () => {
  it('returns a Response with JSON error body', async () => {
    const res = sanitizedError('Something went wrong');
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Something went wrong');
  });

  it('does not include uploaded content in error body', async () => {
    const maliciousContent = 'A'.repeat(10000);
    const res = sanitizedError('File too large');
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(maliciousContent);
  });

  it('does not include stack traces', async () => {
    const res = sanitizedError('Bad input');
    const body = await res.json();
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('at ');
    expect(bodyStr).not.toContain('stack');
    expect(bodyStr).not.toContain('Error:');
  });

  it('accepts custom status code', () => {
    const res = sanitizedError('Forbidden', 403);
    expect(res.status).toBe(403);
  });

  it('error message is short and generic', async () => {
    const res = sanitizedError('File too large (max 5MB)');
    const body = await res.json();
    expect(body.error.length).toBeLessThan(100);
  });
});

describe('Zod schema integration', () => {
  it('cover-letter schema rejects oversized jobDescription', async () => {
    const { coverLetterInputSchema } = await import('@/lib/ai/cover-letter-schema');
    const result = coverLetterInputSchema.safeParse({
      resumeId: 'r1',
      jobDescription: 'A'.repeat(MAX_PROMPT_LENGTH + 1),
      tone: 'formal',
    });
    expect(result.success).toBe(false);
  });

  it('cover-letter schema accepts jobDescription at limit', async () => {
    const { coverLetterInputSchema } = await import('@/lib/ai/cover-letter-schema');
    const result = coverLetterInputSchema.safeParse({
      resumeId: 'r1',
      jobDescription: 'A'.repeat(MAX_PROMPT_LENGTH),
      tone: 'formal',
    });
    expect(result.success).toBe(true);
  });

  it('jd-analysis schema rejects oversized jobDescription', async () => {
    const { jdAnalysisInputSchema } = await import('@/lib/ai/jd-analysis-schema');
    const result = jdAnalysisInputSchema.safeParse({
      resumeId: 'r1',
      jobDescription: 'A'.repeat(MAX_PROMPT_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it('generate-resume schema rejects oversized experience text', async () => {
    const { generateResumeInputSchema } = await import('@/lib/ai/generate-resume-schema');
    const result = generateResumeInputSchema.safeParse({
      jobTitle: 'Engineer',
      experience: 'A'.repeat(MAX_PROMPT_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it('generate-resume schema rejects too many skills', async () => {
    const { generateResumeInputSchema } = await import('@/lib/ai/generate-resume-schema');
    const result = generateResumeInputSchema.safeParse({
      jobTitle: 'Engineer',
      skills: Array.from({ length: MAX_ARRAY_LENGTH + 1 }, (_, i) => `skill-${i}`),
    });
    expect(result.success).toBe(false);
  });

  it('generate-resume schema rejects oversized jobTitle', async () => {
    const { generateResumeInputSchema } = await import('@/lib/ai/generate-resume-schema');
    const result = generateResumeInputSchema.safeParse({
      jobTitle: 'A'.repeat(MAX_SHORT_TEXT_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it('translate schema rejects too many sectionIds', async () => {
    const { translateInputSchema } = await import('@/lib/ai/translate-schema');
    const result = translateInputSchema.safeParse({
      resumeId: 'r1',
      targetLanguage: 'en',
      sectionIds: Array.from({ length: MAX_ARRAY_LENGTH + 1 }, (_, i) => `s-${i}`),
    });
    expect(result.success).toBe(false);
  });

  it('grammar-check schema rejects too many sectionIds', async () => {
    const { grammarCheckInputSchema } = await import('@/lib/ai/grammar-check-schema');
    const result = grammarCheckInputSchema.safeParse({
      resumeId: 'r1',
      sectionIds: Array.from({ length: MAX_ARRAY_LENGTH + 1 }, (_, i) => `s-${i}`),
    });
    expect(result.success).toBe(false);
  });
});

describe('Repeatable boundary tests', () => {
  // AC4: "边界值、刚好超限和伪造 MIME 的测试结果可重复"
  // These tests ensure deterministic, repeatable results for boundary conditions.

  it('repeatable: file size at limit always passes (run 5x)', () => {
    for (let i = 0; i < 5; i++) {
      expect(validateFileSize(MAX_FILE_SIZE).ok).toBe(true);
    }
  });

  it('repeatable: file size 1 byte over always fails (run 5x)', () => {
    for (let i = 0; i < 5; i++) {
      expect(validateFileSize(MAX_FILE_SIZE + 1).ok).toBe(false);
    }
  });

  it('repeatable: prompt at limit always passes (run 5x)', () => {
    for (let i = 0; i < 5; i++) {
      expect(validatePromptLength('A'.repeat(MAX_PROMPT_LENGTH)).ok).toBe(true);
    }
  });

  it('repeatable: prompt 1 char over always fails (run 5x)', () => {
    for (let i = 0; i < 5; i++) {
      expect(validatePromptLength('A'.repeat(MAX_PROMPT_LENGTH + 1)).ok).toBe(false);
    }
  });

  it('repeatable: forged MIME (image/gif) always rejected (run 5x)', () => {
    for (let i = 0; i < 5; i++) {
      expect(validateMimeType('image/gif').ok).toBe(false);
    }
  });

  it('repeatable: forged MIME (image/svg+xml) always rejected (run 5x)', () => {
    for (let i = 0; i < 5; i++) {
      const dataUrl = `data:image/svg+xml;base64,${btoa('<svg></svg>')}`;
      expect(validateBase64Image(dataUrl).ok).toBe(false);
    }
  });

  it('repeatable: messages at limit always passes (run 5x)', () => {
    for (let i = 0; i < 5; i++) {
      const msgs = Array.from({ length: MAX_CLIENT_MESSAGES }, () => ({
        role: 'user',
        content: 'ok',
      }));
      expect(validateChatMessages(msgs).ok).toBe(true);
    }
  });

  it('repeatable: messages 1 over limit always fails (run 5x)', () => {
    for (let i = 0; i < 5; i++) {
      const msgs = Array.from({ length: MAX_CLIENT_MESSAGES + 1 }, () => ({
        role: 'user',
        content: 'ok',
      }));
      expect(validateChatMessages(msgs).ok).toBe(false);
    }
  });
});
