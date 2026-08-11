import { describe, it, expect } from 'vitest';
import {
  validateUpstreamUrl,
  sanitizeUpstreamUrl,
  isApprovedDomain,
  isPrivateIPv4,
  isPrivateIPv6,
  isLikelyIPAddress,
  SSRF_SAFE_FETCH_OPTIONS,
} from './ssrf-guard';

// ─── Helper: assert rejection without leaking details ────────────────────────

function expectRejected(url: string) {
  const result = validateUpstreamUrl(url);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    // Error must be the generic SSRF rejection — never reveals host reachability
    expect(result.error).toBe('UPSTREAM_URL_NOT_ALLOWED');
    // Must not contain the submitted URL or hostname (skip for empty/trivial)
    if (url.length > 4) {
      expect(result.error).not.toContain(url);
    }
  }
}

// ─── AC1: Approved domains pass ──────────────────────────────────────────────

describe('validateUpstreamUrl — approved domains', () => {
  it('accepts api.openai.com over HTTPS', () => {
    expect(validateUpstreamUrl('https://api.openai.com/v1').ok).toBe(true);
    expect(validateUpstreamUrl('https://api.openai.com/v1/models').ok).toBe(true);
    expect(validateUpstreamUrl('https://api.openai.com/').ok).toBe(true);
    expect(validateUpstreamUrl('https://api.openai.com').ok).toBe(true);
  });

  it('accepts api.anthropic.com over HTTPS', () => {
    expect(validateUpstreamUrl('https://api.anthropic.com/v1/models').ok).toBe(true);
    expect(validateUpstreamUrl('https://api.anthropic.com').ok).toBe(true);
  });

  it('accepts generativelanguage.googleapis.com over HTTPS', () => {
    expect(validateUpstreamUrl('https://generativelanguage.googleapis.com/v1beta/models').ok).toBe(true);
    expect(validateUpstreamUrl('https://generativelanguage.googleapis.com').ok).toBe(true);
  });

  it('is case-insensitive for hostname', () => {
    expect(validateUpstreamUrl('https://API.OpenAI.com/v1').ok).toBe(true);
    expect(validateUpstreamUrl('https://Api.Anthropic.COM').ok).toBe(true);
  });
});

// ─── AC2: Non-HTTPS protocols rejected ──────────────────────────────────────

describe('validateUpstreamUrl — protocol enforcement', () => {
  it('rejects HTTP even for approved domains', () => {
    expectRejected('http://api.openai.com/v1/models');
    expectRejected('http://api.anthropic.com');
    expectRejected('http://generativelanguage.googleapis.com');
  });

  it('rejects file protocol', () => {
    expectRejected('file:///etc/passwd');
    expectRejected('file://localhost/etc/shadow');
  });

  it('rejects FTP protocol', () => {
    expectRejected('ftp://api.openai.com/file');
  });

  it('rejects data protocol', () => {
    expectRejected('data:text/html,<script>alert(1)</script>');
  });

  it('rejects gopher protocol', () => {
    expectRejected('gopher://127.0.0.1:6379/_INFO');
  });

  it('rejects malformed URLs', () => {
    expectRejected('not-a-url');
    expectRejected('');
    expectRejected('   ');
    expectRejected('https://');
    expectRejected('://no-protocol');
  });
});

// ─── AC3: Non-approved domains rejected ─────────────────────────────────────

describe('validateUpstreamUrl — non-approved domains', () => {
  it('rejects arbitrary domains', () => {
    expectRejected('https://evil.com/v1/models');
    expectRejected('https://attacker.example.com/api');
    expectRejected('https://internal-company-server.local/api');
  });

  it('rejects subdomains of approved domains', () => {
    expectRejected('https://evil.api.openai.com/v1');
    expectRejected('https://api.openai.com.evil.com/v1');
    expectRejected('https://notanthropic.api.anthropic.com');
  });

  it('rejects lookalike domains', () => {
    expectRejected('https://api.openai.com.attacker.com/v1');
    expectRejected('https://apiopenai.com/v1');
    expectRejected('https://api-openai.com/v1');
  });

  it('rejects userinfo-based tricks', () => {
    // https://api.openai.com@evil.com → hostname is evil.com
    expectRejected('https://api.openai.com@evil.com/v1');
    expectRejected('https://api.anthropic.com:dummy@internal.host/api');
  });

  it('rejects IDN/punycode domains', () => {
    expectRejected('https://api.öpenai.com/v1');
    expectRejected('https://xn--api-penai-fya.com/v1');
  });
});

// ─── AC3+AC5: IPv4 private/reserved ranges ──────────────────────────────────

describe('validateUpstreamUrl — IPv4 SSRF attacks', () => {
  it('rejects loopback 127.0.0.0/8', () => {
    expectRejected('https://127.0.0.1/v1/models');
    expectRejected('https://127.0.0.0/');
    expectRejected('https://127.1.2.3/');
    expectRejected('https://127.255.255.254/');
  });

  it('rejects private 10.0.0.0/8', () => {
    expectRejected('https://10.0.0.1/api');
    expectRejected('https://10.255.255.255/');
    expectRejected('https://10.1.1.1/');
  });

  it('rejects private 172.16.0.0/12', () => {
    expectRejected('https://172.16.0.1/');
    expectRejected('https://172.31.255.255/');
    expectRejected('https://172.20.5.1/');
    // 172.15.x and 172.32.x are NOT private but still non-approved
    expectRejected('https://172.15.0.1/');
    expectRejected('https://172.32.0.1/');
  });

  it('rejects private 192.168.0.0/16', () => {
    expectRejected('https://192.168.0.1/');
    expectRejected('https://192.168.1.100/');
    expectRejected('https://192.168.255.255/');
  });

  it('rejects cloud metadata 169.254.169.254', () => {
    expectRejected('https://169.254.169.254/latest/meta-data/');
    expectRejected('https://169.254.169.254/computeMetadata/v1/');
    expectRejected('http://169.254.169.254/latest/meta-data/iam/security-credentials/');
  });

  it('rejects link-local 169.254.0.0/16', () => {
    expectRejected('https://169.254.0.1/');
    expectRejected('https://169.254.1.1/');
    expectRejected('https://169.254.255.255/');
  });

  it('rejects 0.0.0.0/8', () => {
    expectRejected('https://0.0.0.0/');
    expectRejected('https://0.1.2.3/');
  });

  it('rejects CGNAT 100.64.0.0/10', () => {
    expectRejected('https://100.64.0.1/');
    expectRejected('https://100.100.100.100/');
    expectRejected('https://100.127.255.255/');
  });

  it('rejects TEST-NET and documentation ranges', () => {
    expectRejected('https://192.0.2.1/');
    expectRejected('https://198.51.100.1/');
    expectRejected('https://203.0.113.1/');
  });

  it('rejects multicast and reserved', () => {
    expectRejected('https://224.0.0.1/');
    expectRejected('https://239.255.255.255/');
    expectRejected('https://240.0.0.1/');
    expectRejected('https://255.255.255.255/');
  });

  it('rejects ports on private IPs', () => {
    expectRejected('https://127.0.0.1:8080/');
    expectRejected('https://10.0.0.1:3000/api');
    expectRejected('https://169.254.169.254:80/');
  });

  it('rejects public IPs (not in approved domains)', () => {
    expectRejected('https://1.1.1.1/');
    expectRejected('https://8.8.8.8/');
    expectRejected('https://93.184.216.34/');
  });
});

// ─── AC3+AC5: IPv6 private/reserved ranges ──────────────────────────────────

describe('validateUpstreamUrl — IPv6 SSRF attacks', () => {
  it('rejects IPv6 loopback ::1', () => {
    expectRejected('https://[::1]/');
    expectRejected('https://[0:0:0:0:0:0:0:1]/');
    expectRejected('https://[0000:0000:0000:0000:0000:0000:0000:0001]/');
  });

  it('rejects IPv6 unspecified ::', () => {
    expectRejected('https://[::]/');
    expectRejected('https://[0:0:0:0:0:0:0:0]/');
  });

  it('rejects IPv6 link-local fe80::/10', () => {
    expectRejected('https://[fe80::1]/');
    expectRejected('https://[fe80::1234:5678:9abc:def0]/');
    expectRejected('https://[fe90::1]/');
    expectRejected('https://[fea0::1]/');
    expectRejected('https://[feb0::1]/');
  });

  it('rejects IPv6 unique-local fc00::/7', () => {
    expectRejected('https://[fc00::1]/');
    expectRejected('https://[fd00::1]/');
    expectRejected('https://[fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]/');
  });

  it('rejects IPv6 multicast ff00::/8', () => {
    expectRejected('https://[ff02::1]/');
    expectRejected('https://[ff00::1]/');
  });

  it('rejects IPv4-mapped IPv6 addresses', () => {
    expectRejected('https://[::ffff:127.0.0.1]/');
    expectRejected('https://[::ffff:10.0.0.1]/');
    expectRejected('https://[::ffff:169.254.169.254]/');
    expectRejected('https://[0:0:0:0:0:ffff:7f00:001]/');
  });

  it('rejects NAT64 well-known prefix', () => {
    expectRejected('https://[64:ff9b::1]/');
    expectRejected('https://[64:ff9b::7f00:1]/');
  });

  it('rejects discard prefix 100::', () => {
    expectRejected('https://[100::]/');
    expectRejected('https://[100::1]/');
  });

  it('rejects public IPv6 addresses (not in approved domains)', () => {
    expectRejected('https://[2606:4700:4700::1111]/');
    expectRejected('https://[2001:4860:4860::8888]/');
  });
});

// ─── AC5: IP encoding variations ────────────────────────────────────────────

describe('validateUpstreamUrl — IP encoding tricks', () => {
  it('rejects decimal integer IP encoding', () => {
    // 167772161 = 10.0.0.1
    expectRejected('https://167772161/');
    // 2130706433 = 127.0.0.1
    expectRejected('https://2130706433/');
  });

  it('rejects hexadecimal IP encoding', () => {
    // 0x7f000001 = 127.0.0.1
    expectRejected('https://0x7f000001/');
    // 0x0a000001 = 10.0.0.1
    expectRejected('https://0x0a000001/');
  });

  it('rejects octal dotted IP encoding', () => {
    // 0177.0.0.1 = 127.0.0.1
    expectRejected('https://0177.0.0.1/');
    // 012.0.0.1 = 10.0.0.1
    expectRejected('https://012.0.0.1/');
  });

  it('rejects mixed encoding', () => {
    expectRejected('https://0x7f.0.0.1/');
    expectRejected('https://127.0x00.0.1/');
  });
});

// ─── AC5: DNS variation tests ───────────────────────────────────────────────

describe('validateUpstreamUrl — DNS variations', () => {
  it('rejects DNS rebinding-style domains', () => {
    // An attacker-controlled domain that might resolve to a private IP
    expectRejected('https://rebind.attacker.com/');
    expectRejected('https://private.local/');
    expectRejected('https://internal.corp/');
  });

  it('rejects domains that look like IPs', () => {
    expectRejected('https://127.0.0.1.nip.io/');
    expectRejected('https://10.0.0.1.sslip.io/');
    expectRejected('https://169.254.169.249.nip.io/');
  });

  it('rejects very long hostnames', () => {
    const long = 'a'.repeat(300) + '.com';
    expectRejected(`https://${long}/`);
  });
});

// ─── AC4: No probe result leakage ───────────────────────────────────────────

describe('validateUpstreamUrl — no information leakage', () => {
  it('error message is always the same generic string', () => {
    const results = [
      validateUpstreamUrl('http://127.0.0.1:8080/'),
      validateUpstreamUrl('https://169.254.169.254/latest/meta-data/'),
      validateUpstreamUrl('https://evil.com/'),
      validateUpstreamUrl('file:///etc/passwd'),
      validateUpstreamUrl('not-a-url'),
      validateUpstreamUrl('https://[::1]:8080/'),
      validateUpstreamUrl('ftp://10.0.0.1/'),
    ];
    for (const r of results) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('UPSTREAM_URL_NOT_ALLOWED');
      }
    }
  });

  it('error never contains the submitted URL or hostname', () => {
    const urls = [
      'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      'https://internal-server.local/api/keys',
      'https://127.0.0.1:3000/admin',
      'https://10.0.0.5:9090/metrics',
    ];
    for (const url of urls) {
      const r = validateUpstreamUrl(url);
      if (!r.ok) {
        expect(r.error).not.toContain('169');
        expect(r.error).not.toContain('127');
        expect(r.error).not.toContain('10.0');
        expect(r.error).not.toContain('internal');
        expect(r.error).not.toContain('meta-data');
      }
    }
  });
});

// ─── sanitizeUpstreamUrl ────────────────────────────────────────────────────

describe('sanitizeUpstreamUrl', () => {
  it('returns the URL if approved', () => {
    expect(sanitizeUpstreamUrl('https://api.openai.com/v1', 'fallback'))
      .toBe('https://api.openai.com/v1');
  });

  it('returns fallback for rejected URLs', () => {
    expect(sanitizeUpstreamUrl('http://127.0.0.1/', 'https://api.openai.com/v1'))
      .toBe('https://api.openai.com/v1');
    expect(sanitizeUpstreamUrl('https://evil.com/', 'fallback'))
      .toBe('fallback');
  });

  it('returns fallback for null/undefined/empty', () => {
    expect(sanitizeUpstreamUrl(null, 'fallback')).toBe('fallback');
    expect(sanitizeUpstreamUrl(undefined, 'fallback')).toBe('fallback');
    expect(sanitizeUpstreamUrl('', 'fallback')).toBe('fallback');
  });
});

// ─── isApprovedDomain ───────────────────────────────────────────────────────

describe('isApprovedDomain', () => {
  it('returns true for known providers', () => {
    expect(isApprovedDomain('api.openai.com')).toBe(true);
    expect(isApprovedDomain('api.anthropic.com')).toBe(true);
    expect(isApprovedDomain('generativelanguage.googleapis.com')).toBe(true);
  });

  it('returns false for unknown domains', () => {
    expect(isApprovedDomain('evil.com')).toBe(false);
    expect(isApprovedDomain('localhost')).toBe(false);
    expect(isApprovedDomain('127.0.0.1')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isApprovedDomain('API.OPENAI.COM')).toBe(true);
    expect(isApprovedDomain('Api.Anthropic.com')).toBe(true);
  });
});

// ─── isPrivateIPv4 ──────────────────────────────────────────────────────────

describe('isPrivateIPv4', () => {
  it('detects loopback', () => {
    expect(isPrivateIPv4('127.0.0.1')).toBe(true);
    expect(isPrivateIPv4('127.255.255.255')).toBe(true);
  });

  it('detects private ranges', () => {
    expect(isPrivateIPv4('10.0.0.1')).toBe(true);
    expect(isPrivateIPv4('172.16.0.1')).toBe(true);
    expect(isPrivateIPv4('172.31.255.255')).toBe(true);
    expect(isPrivateIPv4('192.168.1.1')).toBe(true);
  });

  it('detects cloud metadata', () => {
    expect(isPrivateIPv4('169.254.169.254')).toBe(true);
    expect(isPrivateIPv4('169.254.0.1')).toBe(true);
  });

  it('detects other reserved ranges', () => {
    expect(isPrivateIPv4('0.0.0.0')).toBe(true);
    expect(isPrivateIPv4('100.64.0.1')).toBe(true);
    expect(isPrivateIPv4('224.0.0.1')).toBe(true);
    expect(isPrivateIPv4('240.0.0.1')).toBe(true);
  });

  it('returns false for public IPs', () => {
    expect(isPrivateIPv4('1.1.1.1')).toBe(false);
    expect(isPrivateIPv4('8.8.8.8')).toBe(false);
    expect(isPrivateIPv4('93.184.216.34')).toBe(false);
  });

  it('returns false for non-IP strings', () => {
    expect(isPrivateIPv4('not-an-ip')).toBe(false);
    expect(isPrivateIPv4('api.openai.com')).toBe(false);
    expect(isPrivateIPv4('')).toBe(false);
  });

  it('handles boundary cases', () => {
    // 172.15.x is NOT private (just below 172.16)
    expect(isPrivateIPv4('172.15.255.255')).toBe(false);
    // 172.32.x is NOT private (just above 172.31)
    expect(isPrivateIPv4('172.32.0.0')).toBe(false);
    // 100.63.x is NOT CGNAT
    expect(isPrivateIPv4('100.63.255.255')).toBe(false);
    // 100.128.x is NOT CGNAT
    expect(isPrivateIPv4('100.128.0.0')).toBe(false);
  });
});

// ─── isPrivateIPv6 ──────────────────────────────────────────────────────────

describe('isPrivateIPv6', () => {
  it('detects loopback ::1', () => {
    expect(isPrivateIPv6('::1')).toBe(true);
    expect(isPrivateIPv6('[::1]')).toBe(true);
    expect(isPrivateIPv6('0:0:0:0:0:0:0:1')).toBe(true);
  });

  it('detects unspecified ::', () => {
    expect(isPrivateIPv6('::')).toBe(true);
    expect(isPrivateIPv6('[::]')).toBe(true);
  });

  it('detects link-local fe80::/10', () => {
    expect(isPrivateIPv6('fe80::1')).toBe(true);
    expect(isPrivateIPv6('fe80::1234')).toBe(true);
    expect(isPrivateIPv6('fe90::1')).toBe(true);
    expect(isPrivateIPv6('fea0::1')).toBe(true);
    expect(isPrivateIPv6('feb0::1')).toBe(true);
    // fec0:: is NOT link-local (site-local deprecated, outside fe80::/10)
    expect(isPrivateIPv6('fec0::1')).toBe(false);
  });

  it('detects unique-local fc00::/7', () => {
    expect(isPrivateIPv6('fc00::1')).toBe(true);
    expect(isPrivateIPv6('fd00::1')).toBe(true);
    expect(isPrivateIPv6('fdff::1')).toBe(true);
  });

  it('detects multicast ff00::/8', () => {
    expect(isPrivateIPv6('ff00::1')).toBe(true);
    expect(isPrivateIPv6('ff02::1')).toBe(true);
  });

  it('detects IPv4-mapped IPv6', () => {
    expect(isPrivateIPv6('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIPv6('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateIPv6('::ffff:169.254.169.254')).toBe(true);
    // Public IPv4 mapped should NOT be private from IPv6 perspective
    // (but it would be rejected by the allowlist anyway)
  });

  it('detects NAT64 prefix', () => {
    expect(isPrivateIPv6('64:ff9b::1')).toBe(true);
  });

  it('detects discard prefix', () => {
    expect(isPrivateIPv6('100::')).toBe(true);
    expect(isPrivateIPv6('100::1')).toBe(true);
  });

  it('returns false for public IPv6', () => {
    expect(isPrivateIPv6('2606:4700:4700::1111')).toBe(false);
    expect(isPrivateIPv6('2001:4860:4860::8888')).toBe(false);
  });

  it('returns false for non-IPv6 strings', () => {
    expect(isPrivateIPv6('127.0.0.1')).toBe(false);
    expect(isPrivateIPv6('api.openai.com')).toBe(false);
    expect(isPrivateIPv6('')).toBe(false);
  });
});

// ─── isLikelyIPAddress ──────────────────────────────────────────────────────

describe('isLikelyIPAddress', () => {
  it('detects standard IPv4', () => {
    expect(isLikelyIPAddress('127.0.0.1')).toBe(true);
    expect(isLikelyIPAddress('10.0.0.1')).toBe(true);
    expect(isLikelyIPAddress('8.8.8.8')).toBe(true);
  });

  it('detects decimal integer IPs', () => {
    expect(isLikelyIPAddress('167772161')).toBe(true);
    expect(isLikelyIPAddress('2130706433')).toBe(true);
  });

  it('detects hex IPs', () => {
    expect(isLikelyIPAddress('0x7f000001')).toBe(true);
    expect(isLikelyIPAddress('0x0a000001')).toBe(true);
  });

  it('detects octal dotted IPs', () => {
    expect(isLikelyIPAddress('0177.0.0.1')).toBe(true);
    expect(isLikelyIPAddress('012.0.0.1')).toBe(true);
  });

  it('detects IPv6 addresses', () => {
    expect(isLikelyIPAddress('::1')).toBe(true);
    expect(isLikelyIPAddress('[::1]')).toBe(true);
    expect(isLikelyIPAddress('fe80::1')).toBe(true);
    expect(isLikelyIPAddress('2001:db8::1')).toBe(true);
  });

  it('detects IPv4-mapped IPv6', () => {
    expect(isLikelyIPAddress('::ffff:127.0.0.1')).toBe(true);
  });

  it('returns false for domain names', () => {
    expect(isLikelyIPAddress('api.openai.com')).toBe(false);
    expect(isLikelyIPAddress('localhost')).toBe(false);
    expect(isLikelyIPAddress('evil.com')).toBe(false);
  });

  it('returns false for short numbers (not IPs)', () => {
    expect(isLikelyIPAddress('123')).toBe(false);
    expect(isLikelyIPAddress('42')).toBe(false);
  });
});

// ─── SSRF_SAFE_FETCH_OPTIONS ────────────────────────────────────────────────

describe('SSRF_SAFE_FETCH_OPTIONS', () => {
  it('sets redirect to error', () => {
    expect(SSRF_SAFE_FETCH_OPTIONS.redirect).toBe('error');
  });
});

// ─── Integration: full validation flow ──────────────────────────────────────

describe('SSRF guard integration', () => {
  it('approved provider URLs pass end-to-end', () => {
    const urls = [
      'https://api.openai.com/v1',
      'https://api.openai.com/v1/chat/completions',
      'https://api.anthropic.com/v1/messages',
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
    ];
    for (const url of urls) {
      expect(validateUpstreamUrl(url).ok).toBe(true);
    }
  });

  it('all common SSRF payloads are blocked', () => {
    const payloads = [
      // AWS metadata
      'http://169.254.169.254/latest/meta-data/',
      'http://169.254.169.254/computeMetadata/v1/',
      // GCP metadata
      'http://metadata.google.internal/computeMetadata/v1/',
      // Azure metadata
      'http://169.254.169.254/metadata/instance?api-version=2021-02-01',
      // Localhost variations
      'http://localhost/',
      'http://localhost:8080/',
      'http://127.0.0.1/',
      'http://127.0.0.1:3000/',
      'http://[::1]/',
      // Private network
      'http://10.0.0.1/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      // Non-HTTP protocols
      'file:///etc/passwd',
      'gopher://127.0.0.1:6379/_INFO',
      // DNS rebinding services
      'http://127.0.0.1.nip.io/',
      'http://10.0.0.1.sslip.io/',
      // Encoded IPs
      'http://0x7f000001/',
      'http://2130706433/',
      // Arbitrary domains
      'https://evil.com/',
      'https://attacker.example.com/',
    ];
    for (const payload of payloads) {
      expectRejected(payload);
    }
  });

  it('does not leak probe results in any rejection', () => {
    // Every rejection uses the exact same generic error
    const payloads = [
      'http://127.0.0.1/',
      'https://evil.com/',
      'file:///etc/passwd',
      'http://169.254.169.254/',
      'not-a-url',
    ];
    const errors = payloads.map(p => {
      const r = validateUpstreamUrl(p);
      return r.ok ? null : r.error;
    });
    // All errors are identical
    const unique = new Set(errors);
    expect(unique.size).toBe(1);
    expect([...unique][0]).toBe('UPSTREAM_URL_NOT_ALLOWED');
  });
});
