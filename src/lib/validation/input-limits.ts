/**
 * Shared input limits and validation for high-cost request protection.
 *
 * Every constant here is the single source of truth for that limit.
 * Routes must import from here rather than re-declaring magic numbers.
 */

// ─── File Upload Limits ─────────────────────────────────────────────────────

/** Accepted MIME types for image uploads. */
export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Maximum image file size: 5 MB. */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/** Accepted MIME types for file uploads including PDF. */
export const ALLOWED_UPLOAD_MIME = [...ALLOWED_IMAGE_MIME, 'application/pdf'] as const;

/** Maximum PDF/document file size: 10 MB. */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Maximum number of pages in a PDF before we reject it (prevents memory exhaustion). */
export const MAX_PDF_PAGES = 30;

// ─── AI Chat & Prompt Limits ────────────────────────────────────────────────

/** Maximum number of messages a client may send in a single chat request. */
export const MAX_CLIENT_MESSAGES = 100;

/** Maximum characters in a single message's text content. */
export const MAX_MESSAGE_LENGTH = 20_000;

/** Hard ceiling on AI tool-call steps within a single streamText call. */
export const MAX_AI_STEPS = 25;

/** Maximum characters for a free-text prompt (job descriptions, experience text, etc.). */
export const MAX_PROMPT_LENGTH = 10_000;

/** Maximum characters for a short text field (job title, industry, etc.). */
export const MAX_SHORT_TEXT_LENGTH = 500;

// ─── JSON Body Limits ───────────────────────────────────────────────────────

/** Maximum raw JSON body size in bytes for API routes (256 KB). */
export const MAX_JSON_BODY_BYTES = 256 * 1024;

/** Maximum number of items in an array field (sections, interviewers, etc.). */
export const MAX_ARRAY_LENGTH = 50;

// ─── Validation Result ──────────────────────────────────────────────────────

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string };

// ─── Validation Helpers ─────────────────────────────────────────────────────

/**
 * Validate a file's MIME type against the allowed list.
 * Forged MIME (e.g. `application/pdf` header with non-PDF content) is not
 * detected here — that's the parser's job. This only catches obvious lies.
 */
export function validateMimeType(
  mimeType: string,
  allowed: readonly string[] = ALLOWED_UPLOAD_MIME,
): ValidationResult {
  if (!mimeType) {
    return { ok: false, error: 'Missing file type' };
  }
  if (!allowed.includes(mimeType as typeof allowed[number])) {
    return { ok: false, error: 'Unsupported file type' };
  }
  return { ok: true };
}

/** Validate file size against a byte limit. */
export function validateFileSize(size: number, maxBytes: number = MAX_FILE_SIZE): ValidationResult {
  if (size <= 0) {
    return { ok: false, error: 'Empty file' };
  }
  if (size > maxBytes) {
    return { ok: false, error: `File too large (max ${Math.floor(maxBytes / 1024 / 1024)}MB)` };
  }
  return { ok: true };
}

/**
 * Validate an image sent as a base64 data URL.
 * Checks: data URL format, MIME whitelist, decoded byte size.
 */
export function validateBase64Image(dataUrl: string): ValidationResult {
  const match = dataUrl.match(/^data:(image\/[\w+]+);base64,(.+)$/);
  if (!match) {
    return { ok: false, error: 'Invalid image format' };
  }

  const mimeType = match[1];
  const mimeCheck = validateMimeType(mimeType, ALLOWED_IMAGE_MIME);
  if (!mimeCheck.ok) return mimeCheck;

  // Base64 encodes 3 bytes → 4 chars. Approximate decoded size.
  const decodedBytes = Math.floor((match[2].length * 3) / 4);
  const sizeCheck = validateFileSize(decodedBytes, MAX_IMAGE_SIZE);
  if (!sizeCheck.ok) {
    return { ok: false, error: `Image too large (max ${Math.floor(MAX_IMAGE_SIZE / 1024 / 1024)}MB)` };
  }

  return { ok: true };
}

/** Validate a free-text prompt field. */
export function validatePromptLength(text: string, maxLength: number = MAX_PROMPT_LENGTH): ValidationResult {
  if (text.length > maxLength) {
    return { ok: false, error: `Input too long (max ${maxLength} characters)` };
  }
  return { ok: true };
}

/**
 * Validate the messages array sent to AI chat.
 * Checks: array length, each message's text content length.
 */
export function validateChatMessages(messages: unknown[]): ValidationResult {
  if (messages.length > MAX_CLIENT_MESSAGES) {
    return { ok: false, error: `Too many messages (max ${MAX_CLIENT_MESSAGES})` };
  }

  for (const msg of messages) {
    if (typeof msg !== 'object' || msg === null) continue;
    const m = msg as Record<string, unknown>;

    // Check `content` if it's a string
    if (typeof m.content === 'string' && m.content.length > MAX_MESSAGE_LENGTH) {
      return { ok: false, error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` };
    }

    // Check `parts` array for text length
    if (Array.isArray(m.parts)) {
      for (const part of m.parts) {
        if (typeof part !== 'object' || part === null) continue;
        const p = part as Record<string, unknown>;
        if (p.type === 'text' && typeof p.text === 'string' && p.text.length > MAX_MESSAGE_LENGTH) {
          return { ok: false, error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` };
        }
      }
    }
  }

  return { ok: true };
}

/**
 * Sanitize an error response so it never contains uploaded content
 * or internal stack traces.
 */
export function sanitizedError(message: string, status: number = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
