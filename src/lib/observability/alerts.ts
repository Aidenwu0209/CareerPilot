import { createHmac } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { alertDeliveries, alertEvents } from '@/lib/db/schema';
import { logger } from '@/lib/observability/logger';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertInput {
  fingerprint: string;
  source: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Durable deduplication plus webhook and SMTP on-call delivery. */
export async function dispatchAlert(input: AlertInput) {
  const cooldownMs = Math.max(60_000, Number(process.env.ALERT_COOLDOWN_MS) || 300_000);
  const now = new Date();
  let eventId = crypto.randomUUID();
  let shouldDeliver = true;
  try {
    const [existing] = await db.select().from(alertEvents)
      .where(eq(alertEvents.fingerprint, input.fingerprint)).limit(1);
    if (existing) {
      eventId = existing.id;
      shouldDeliver = !existing.lastDeliveredAt
        || now.getTime() - existing.lastDeliveredAt.getTime() >= cooldownMs
        || existing.status === 'resolved';
      await db.update(alertEvents).set({
        source: input.source,
        severity: input.severity,
        title: input.title,
        message: input.message,
        status: 'open',
        occurrenceCount: existing.occurrenceCount + 1,
        lastSeenAt: now,
        resolvedAt: null,
      }).where(eq(alertEvents.id, existing.id));
    } else {
      const stored = {
        fingerprint: input.fingerprint, source: input.source, severity: input.severity,
        title: input.title, message: input.message,
      };
      await db.insert(alertEvents).values({ id: eventId, ...stored });
    }
  } catch (error) {
    logger.error('alerts.durable_state_unavailable', { error, fingerprint: input.fingerprint });
  }
  if (!shouldDeliver) return { eventId, delivered: false, deduplicated: true };

  const results = await Promise.allSettled([sendWebhook(input, eventId), sendOnCallEmail(input, eventId)]);
  const attempted = results.filter((result) => result.status === 'fulfilled' && result.value !== null);
  const failures = results.filter((result) => result.status === 'rejected');
  const status = failures.length > 0 ? 'failed' : attempted.length > 0 ? 'succeeded' : 'not_configured';
  try {
    await db.update(alertEvents).set({
      lastDeliveryStatus: status,
      lastDeliveredAt: attempted.length > 0 ? now : null,
    }).where(eq(alertEvents.id, eventId));
  } catch { /* external delivery must not depend on audit persistence */ }
  return { eventId, delivered: attempted.length > 0, failures: failures.length };
}

async function sendWebhook(input: AlertInput, eventId: string) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return null;
  const payload = JSON.stringify({
    version: 1,
    eventId,
    service: process.env.OTEL_SERVICE_NAME || 'careerpilot',
    environment: process.env.DEPLOYMENT_ENV || process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
    ...input,
  });
  const secret = process.env.ALERT_WEBHOOK_SECRET;
  const signature = secret ? createHmac('sha256', secret).update(payload).digest('hex') : '';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'CareerPilot-Alerts/1.0',
      ...(signature ? { 'X-CareerPilot-Signature': `sha256=${signature}` } : {}),
    },
    body: payload,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`ALERT_WEBHOOK_${response.status}`);
  await recordDelivery(eventId, 'webhook', maskDestination(url));
  return true;
}

async function sendOnCallEmail(input: AlertInput, eventId: string) {
  const recipients = (process.env.ONCALL_EMAILS || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (recipients.length === 0 || !process.env.SMTP_HOST) return null;
  const nodemailer = await import('nodemailer');
  const port = Number(process.env.SMTP_PORT) || 587;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'alerts@careerpilot.com',
    to: recipients,
    subject: `[${input.severity.toUpperCase()}] CareerPilot: ${input.title}`,
    text: `${input.message}\n\nSource: ${input.source}\nEvent: ${eventId}\nTime: ${new Date().toISOString()}\n\n${JSON.stringify(input.details ?? {}, null, 2)}`,
  });
  await recordDelivery(eventId, 'email', `${recipients.length} on-call recipient(s)`);
  return true;
}

async function recordDelivery(eventId: string, channel: 'webhook' | 'email', destination: string) {
  try {
    await db.insert(alertDeliveries).values({ alertEventId: eventId, channel, destination, status: 'succeeded' });
  } catch { /* delivery already happened; audit persistence is best effort */ }
}

function maskDestination(value: string) {
  try { return new URL(value).origin; } catch { return 'configured-webhook'; }
}

export async function resolveAlert(fingerprint: string) {
  await db.update(alertEvents).set({ status: 'resolved', resolvedAt: new Date() })
    .where(eq(alertEvents.fingerprint, fingerprint));
}
