/**
 * SSRF Guard — prevents the server from connecting to arbitrary user-supplied URLs.
 *
 * Primary defense: allowlist of approved AI provider domains.
 * Secondary defense: private/reserved IP range detection (IPv4 + IPv6).
 *
 * Rejection responses never reveal whether a host is reachable, what IP it
 * resolves to, or what service is running — the error is always a generic
 * `UPSTREAM_URL_NOT_ALLOWED`.
 */

// Re-use the shared validation result shape
import type { ValidationResult } from '@/lib/validation/input-limits';

// ─── Approved Upstream Domains ──────────────────────────────────────────────

/**
 * Hostnames that the server is allowed to fetch from when proxying AI requests.
 * Raw IP addresses are never approved — only well-known provider domains.
 */
const APPROVED_UPSTREAM_DOMAINS = new Set<string>([
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'qianfan.baidubce.com',
]);

/**
 * Check if a hostname is in the approved upstream domain allowlist.
 */
export function isApprovedDomain(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  const deploymentDomains = (process.env.AI_UPSTREAM_ALLOWED_DOMAINS || '')
    .split(',').map((domain) => domain.trim().toLowerCase()).filter(Boolean);
  return APPROVED_UPSTREAM_DOMAINS.has(normalized) || deploymentDomains.includes(normalized);
}

// ─── IPv4 Private / Reserved Range Detection ────────────────────────────────

/**
 * Convert a dotted-decimal IPv4 string to a 32-bit unsigned integer.
 * Returns `null` if the string is not a valid IPv4 address.
 */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    // Reject leading zeros, hex, etc. — only plain decimal
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    nums.push(n);
  }
  return (((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3]) >>> 0;
}

/** Private, loopback, link-local, cloud-metadata, and reserved IPv4 ranges. */
const BLOCKED_IPV4_RANGES: Array<[number, number]> = [
  [0x00000000, 0x00FFFFFF],   // 0.0.0.0/8       "This network"
  [0x0A000000, 0x0AFFFFFF],   // 10.0.0.0/8      Private
  [0x64400000, 0x647FFFFF],   // 100.64.0.0/10   CGNAT
  [0x7F000000, 0x7FFFFFFF],   // 127.0.0.0/8     Loopback
  [0xA9FE0000, 0xA9FEFFFF],   // 169.254.0.0/16  Link-local + cloud metadata
  [0xAC100000, 0xAC1FFFFF],   // 172.16.0.0/12   Private
  [0xC0000000, 0xC00000FF],   // 192.0.0.0/24    IETF protocol assignments
  [0xC0000200, 0xC00002FF],   // 192.0.2.0/24    TEST-NET-1
  [0xC0A80000, 0xC0A8FFFF],   // 192.168.0.0/16  Private
  [0xC6120000, 0xC613FFFF],   // 198.18.0.0/15   Benchmark
  [0xC6336400, 0xC63364FF],   // 198.51.100.0/24 TEST-NET-2
  [0xCB007100, 0xCB0071FF],   // 203.0.113.0/24  TEST-NET-3
  [0xE0000000, 0xEFFFFFFF],   // 224.0.0.0/4     Multicast
  [0xF0000000, 0xFFFFFFFF],   // 240.0.0.0/4     Reserved
];

/**
 * Check if an IPv4 address (dotted-decimal string) falls within any
 * blocked private / reserved range.
 */
export function isPrivateIPv4(ip: string): boolean {
  const num = ipv4ToInt(ip);
  if (num === null) return false;
  return BLOCKED_IPV4_RANGES.some(([start, end]) => num >= start && num <= end);
}

// ─── IPv6 Private / Reserved Range Detection ────────────────────────────────

/**
 * Normalize an IPv6 address string to 8 lowercase hex groups.
 * Handles brackets, :: shorthand, and IPv4-mapped mixed notation.
 * Returns the normalized address or `null` if parsing fails.
 */
function normalizeIPv6(hostname: string): string | null {
  let addr = hostname;
  // Strip surrounding brackets
  if (addr.startsWith('[') && addr.endsWith(']')) {
    addr = addr.slice(1, -1);
  }
  // Must contain at least one colon to be IPv6
  if (!addr.includes(':')) return null;
  // Basic character validation
  if (!/^[0-9a-fA-F:.]+$/.test(addr)) return null;

  // Handle mixed notation: trailing IPv4 dotted-decimal (e.g. ::ffff:127.0.0.1)
  const dottedMatch = addr.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dottedMatch) {
    const ipParts = dottedMatch[1].split('.').map(Number);
    if (ipParts.some(p => p < 0 || p > 255)) return null;
    const g1 = ((ipParts[0] << 8) | ipParts[1]).toString(16).padStart(4, '0');
    const g2 = ((ipParts[2] << 8) | ipParts[3]).toString(16).padStart(4, '0');
    addr = addr.slice(0, addr.length - dottedMatch[1].length - 1) + ':' + g1 + ':' + g2;
  }

  // Expand :: shorthand
  const dblColonIdx = addr.indexOf('::');
  if (dblColonIdx !== -1) {
    // Only one :: allowed
    if (addr.indexOf('::', dblColonIdx + 2) !== -1) return null;

    const head = addr.slice(0, dblColonIdx).split(':').filter(p => p !== '');
    const tail = addr.slice(dblColonIdx + 2).split(':').filter(p => p !== '');
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;

    const expanded = [
      ...head.map(p => p.padStart(4, '0')),
      ...Array(missing).fill('0000'),
      ...tail.map(p => p.padStart(4, '0')),
    ];
    return expanded.join(':').toLowerCase();
  }

  // No shorthand — just split and pad
  const parts = addr.split(':');
  if (parts.length === 8) {
    return parts.map(p => p.padStart(4, '0')).join(':').toLowerCase();
  }

  return null;
}

/**
 * Check if an IPv6 address string is loopback, link-local, unique-local,
 * or other reserved/private range.
 */
export function isPrivateIPv6(ip: string): boolean {
  const addr = normalizeIPv6(ip);
  if (!addr) return false;
  const groups = addr.split(':');

  // ::1 — loopback
  if (addr === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
  // :: — unspecified
  if (addr === '0000:0000:0000:0000:0000:0000:0000:0000') return true;

  // fc00::/7 — unique local (first byte fc or fd)
  const firstByte = parseInt(groups[0].slice(0, 2), 16);
  if (firstByte >= 0xfc && firstByte <= 0xfd) return true;

  // fe80::/10 — link-local
  if (groups[0].startsWith('fe8') || groups[0].startsWith('fe9') ||
      groups[0].startsWith('fea') || groups[0].startsWith('feb')) return true;

  // ::ffff:0:0/96 — IPv4-mapped IPv6 (check the embedded IPv4)
  if (groups.slice(0, 5).every(g => g === '0000') && groups[5] === 'ffff') {
    const embeddedIp = `${parseInt(groups[6].slice(0, 2), 16)}.${parseInt(groups[6].slice(2, 4), 16)}.${parseInt(groups[7].slice(0, 2), 16)}.${parseInt(groups[7].slice(2, 4), 16)}`;
    return isPrivateIPv4(embeddedIp);
  }

  // 64:ff9b::/96 — NAT64 well-known prefix
  if (groups[0] === '0064' && groups[1] === 'ff9b') return true;

  // 100::/64 — discard prefix (first 4 groups = 0100:0000:0000:0000)
  if (groups[0] === '0100' && groups[1] === '0000' &&
      groups[2] === '0000' && groups[3] === '0000') return true;

  // ff00::/8 — multicast
  if (groups[0].startsWith('ff')) return true;

  return false;
}

// ─── IP Address Detection ───────────────────────────────────────────────────

/**
 * Detect if a hostname string represents an IP address in any common encoding.
 *
 * Covers: standard dotted decimal, bare decimal integer, hexadecimal,
 * octal dotted, and IPv6.
 */
export function isLikelyIPAddress(hostname: string): boolean {
  const h = hostname.toLowerCase();

  // Standard IPv4: 1.2.3.4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;

  // Bare decimal integer: 167772161 (>= 2^24 to avoid false positives)
  if (/^\d{8,}$/.test(h) && Number(h) <= 0xffffffff) return true;

  // Hex: 0x0a000001
  if (/^0x[0-9a-f]{1,8}$/.test(h)) return true;

  // Octal dotted: 012.000.000.001
  if (/^0\d{1,3}(\.0?\d{1,3}){3}$/.test(h)) return true;

  // IPv6 (presence of colon, possibly bracketed)
  if ((h.includes(':') || (h.startsWith('[') && h.endsWith(']'))) &&
      /^[0-9a-fA-F:.]+$/.test(h.replace(/[\[\]]/g, ''))) return true;

  // Mixed notation: ::ffff:1.2.3.4
  if (h.includes('::ffff:') && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h.split('::ffff:')[1])) return true;

  return false;
}

// ─── URL Validation ─────────────────────────────────────────────────────────

/** Generic rejection error (never leaks internal probe details). */
const SSRF_REJECTION: ValidationResult = { ok: false, error: 'UPSTREAM_URL_NOT_ALLOWED' };

/**
 * Validate that a URL is safe for the server to fetch.
 *
 * Checks:
 * 1. Must be a parseable URL
 * 2. Must use HTTPS protocol
 * 3. Hostname must be in the approved domain allowlist
 *
 * Raw IP addresses are never in the approved list and are always rejected.
 * Private/reserved IPs are detected as a secondary defense.
 *
 * Returns `{ ok: true }` on success, or `{ ok: false, error: 'UPSTREAM_URL_NOT_ALLOWED' }`
 * on any failure. The error never reveals whether the host is reachable,
 * what IP it resolves to, or what service is running.
 */
export function validateUpstreamUrl(url: string): ValidationResult {
  // 1. Parse URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return SSRF_REJECTION;
  }

  // 2. HTTPS only
  if (parsed.protocol !== 'https:') {
    return SSRF_REJECTION;
  }

  // 3. Extract hostname (URL already normalizes to lowercase for hostnames)
  const hostname = parsed.hostname.toLowerCase();

  // 4. Approved domain allowlist — primary defense
  if (isApprovedDomain(hostname)) {
    return { ok: true };
  }

  // 5. Defense-in-depth: detect and reject IP addresses
  // (the allowlist already excludes them, but this documents intent
  //  and provides a hook for future relaxation)
  if (isLikelyIPAddress(hostname)) {
    // Double-check: if it somehow looks like a private IP, definitely reject
    // (already rejected by allowlist, this is documentation)
    return SSRF_REJECTION;
  }

  // 6. Non-approved domain
  return SSRF_REJECTION;
}

/**
 * Validate an upstream URL and return either the original (if safe) or a
 * fallback default URL.
 *
 * This is the convenience wrapper for code paths that need a safe URL and
 * want to silently fall back rather than error out.
 */
export function sanitizeUpstreamUrl(url: string | null | undefined, fallback: string): string {
  if (!url) return fallback;
  const result = validateUpstreamUrl(url);
  return result.ok ? url : fallback;
}

// ─── Fetch Hardening ────────────────────────────────────────────────────────

/**
 * Fetch options that prevent redirect-based SSRF attacks.
 *
 * `redirect: 'error'` causes fetch to throw if the server responds with a
 * 3xx redirect, preventing attackers from using an approved domain that
 * redirects to an internal address.
 *
 * Usage: `fetch(url, { ...SSRF_SAFE_FETCH_OPTIONS, headers: {...} })`
 */
export const SSRF_SAFE_FETCH_OPTIONS: RequestInit = {
  redirect: 'error',
};
