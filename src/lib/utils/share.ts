import { NextRequest } from 'next/server';

export function generateShareToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export function getShareUrl(token: string, request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const origin = host ? `${proto}://${host}` : request.nextUrl.origin;
  return `${origin}/share/${token}`;
}

export async function hashPassword(password: string): Promise<string> {
  const iterations = 210_000;
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const derived = await derivePassword(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${base64UrlEncode(salt)}$${base64UrlEncode(derived)}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (storedHash.startsWith('pbkdf2-sha256$')) {
    const [, rawIterations, rawSalt, rawExpected] = storedHash.split('$');
    const iterations = Number(rawIterations);
    if (!Number.isInteger(iterations) || iterations < 100_000 || !rawSalt || !rawExpected) {
      return false;
    }
    try {
      const salt = base64UrlDecode(rawSalt);
      const expected = base64UrlDecode(rawExpected);
      const actual = await derivePassword(password, salt, iterations, expected.length);
      return constantTimeEqual(actual, expected);
    } catch {
      return false;
    }
  }

  // Backward compatibility for existing unsalted SHA-256 shares. Successful
  // verification is upgraded by the route to the current slow hash format.
  if (/^[a-f0-9]{64}$/i.test(storedHash)) {
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password)),
    );
    return constantTimeEqual(digest, hexDecode(storedHash));
  }
  return false;
}

export function isLegacyPasswordHash(storedHash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(storedHash);
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
  length = 32,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    length * 8,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

function base64UrlEncode(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

function hexDecode(value: string): Uint8Array {
  return new Uint8Array(value.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
}
