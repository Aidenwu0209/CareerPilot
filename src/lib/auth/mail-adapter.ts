/**
 * Mail adapter abstraction for sending OTP emails.
 *
 * - TestMailAdapter: stores sent emails in memory for automated test retrieval.
 * - SmtpMailAdapter: production adapter configured by SMTP_* environment variables.
 *
 * The adapter is selected by environment:
 * - NODE_ENV=test → TestMailAdapter (singleton)
 * - NODE_ENV=development (no SMTP_HOST) → TestMailAdapter
 * - NODE_ENV=development (with SMTP_HOST) → SmtpMailAdapter
 * - NODE_ENV=production → SmtpMailAdapter (requires SMTP_HOST)
 */

export interface MailAdapter {
  sendOTP(email: string, code: string): Promise<void>;
}

/**
 * Test adapter — stores all sent emails in memory.
 * Tests call `getLastCode(email)` to retrieve the OTP without reading real email.
 */
export class TestMailAdapter implements MailAdapter {
  private sentEmails: { email: string; code: string; timestamp: Date }[] = [];

  async sendOTP(email: string, code: string): Promise<void> {
    this.sentEmails.push({ email, code, timestamp: new Date() });
  }

  /** Returns the most recent code sent to this email, or null. */
  getLastCode(email: string): string | null {
    for (let i = this.sentEmails.length - 1; i >= 0; i--) {
      if (this.sentEmails[i].email === email) {
        return this.sentEmails[i].code;
      }
    }
    return null;
  }

  /** Clear all stored emails (useful between tests). */
  clear(): void {
    this.sentEmails = [];
  }
}

/**
 * Production SMTP adapter — configured by SMTP_* environment variables.
 *
 * Required env vars:
 * - SMTP_HOST: SMTP server hostname
 * - SMTP_PORT: SMTP server port (default 587)
 * - SMTP_USER: SMTP username
 * - SMTP_PASS: SMTP password
 * - SMTP_FROM: From email address
 *
 * If SMTP_HOST is not set in production, sending fails with a clear error.
 * The actual SMTP implementation uses nodemailer (loaded lazily).
 */
export class SmtpMailAdapter implements MailAdapter {
  private getConfig() {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || 'noreply@careerpilot.com';

    if (!host) {
      throw new Error(
        'SMTP_HOST is required for production email delivery. ' +
          'Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM environment variables.',
      );
    }

    return { host, port, user, pass, from };
  }

  async sendOTP(email: string, code: string): Promise<void> {
    const cfg = this.getConfig();

    // Load the SMTP client only when an email is actually sent.
    let nodemailer: typeof import('nodemailer');
    try {
      nodemailer = await import('nodemailer');
    } catch {
      throw new Error(
        'nodemailer is not installed. Install it with: npm install nodemailer',
      );
    }

    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });

    await transporter.sendMail({
      from: cfg.from,
      to: email,
      subject: 'Your CareerPilot Verification Code',
      text: `Your verification code is: ${code}\n\nThis code expires in 10 minutes.`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>CareerPilot Verification Code</h2>
          <p>Your verification code is:</p>
          <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #2563eb;">${code}</p>
          <p style="color: #6b7280;">This code expires in 10 minutes. If you did not request this code, please ignore this email.</p>
        </div>
      `,
    });
  }
}

// ── Singleton management ──

let _adapter: MailAdapter | null = null;
let _testAdapter: TestMailAdapter | null = null;

/**
 * Returns the mail adapter appropriate for the current environment.
 */
export function getMailAdapter(): MailAdapter {
  // Explicit override takes priority
  if (_adapter) return _adapter;

  // Always return the shared TestMailAdapter in test environment
  if (process.env.NODE_ENV === 'test') {
    if (!_testAdapter) _testAdapter = new TestMailAdapter();
    return _testAdapter;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const hasSmtp = !!process.env.SMTP_HOST;

  if (isProduction) {
    _adapter = new SmtpMailAdapter();
  } else if (hasSmtp) {
    _adapter = new SmtpMailAdapter();
  } else {
    // Dev/test without SMTP — use TestMailAdapter for easy code retrieval
    if (!_testAdapter) _testAdapter = new TestMailAdapter();
    _adapter = _testAdapter;
  }

  return _adapter;
}

/**
 * Override the mail adapter (for testing).
 * Pass null to reset to the environment default.
 */
export function setMailAdapter(adapter: MailAdapter | null): void {
  _adapter = adapter;
  if (adapter === null && _testAdapter) {
    _testAdapter.clear();
  }
}

/**
 * Get the shared TestMailAdapter instance (if one exists).
 * Useful in tests to retrieve the OTP code that was sent.
 */
export function getTestMailAdapter(): TestMailAdapter | null {
  const adapter = getMailAdapter();
  return adapter instanceof TestMailAdapter ? adapter : _testAdapter;
}
