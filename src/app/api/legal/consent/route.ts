import { NextRequest, NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import {
  getAllCurrentVersions,
  getUserConsents,
  recordAllConsents,
} from '@/lib/legal/consent-service';

/**
 * GET /api/legal/consent
 *
 * Returns the current required document versions and the user's latest consent records.
 * AC5: Users can only read their own consent records.
 */
export async function GET() {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  const userId = ctx.context.actor.userId;
  const requiredVersions = getAllCurrentVersions();
  const userConsents = await getUserConsents(userId);

  return NextResponse.json({
    required: {
      privacy_policy: {
        version: requiredVersions.privacy_policy.version,
        effectiveDate: requiredVersions.privacy_policy.effectiveDate.toISOString(),
      },
      terms_of_service: {
        version: requiredVersions.terms_of_service.version,
        effectiveDate: requiredVersions.terms_of_service.effectiveDate.toISOString(),
      },
    },
    current: {
      privacy_policy: userConsents.privacy_policy
        ? {
            version: userConsents.privacy_policy.version,
            source: userConsents.privacy_policy.source,
            consentedAt: userConsents.privacy_policy.createdAt.toISOString(),
          }
        : null,
      terms_of_service: userConsents.terms_of_service
        ? {
            version: userConsents.terms_of_service.version,
            source: userConsents.terms_of_service.source,
            consentedAt: userConsents.terms_of_service.createdAt.toISOString(),
          }
        : null,
    },
  });
}

/**
 * POST /api/legal/consent
 *
 * Records the user's consent for the current document versions.
 * AC1: First authentication must submit consent.
 * AC3: Submitted versions are validated against known versions — client cannot forge.
 */
export async function POST(request: NextRequest) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  const userId = ctx.context.actor.userId;
  let body: { privacyVersion?: string; termsVersion?: string; source?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const required = getAllCurrentVersions();

  // Validate that submitted versions match current required versions
  // AC3: Client cannot submit non-existent or expired versions
  if (body.privacyVersion && body.privacyVersion !== required.privacy_policy.version) {
    return NextResponse.json({ error: 'VERSION_MISMATCH', document: 'privacy_policy' }, { status: 400 });
  }
  if (body.termsVersion && body.termsVersion !== required.terms_of_service.version) {
    return NextResponse.json({ error: 'VERSION_MISMATCH', document: 'terms_of_service' }, { status: 400 });
  }

  // If neither version is provided, record consent for all current versions
  const source = (body.source as 'registration' | 'explicit_reconsent' | 'login') || 'explicit_reconsent';

  const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;

  try {
    const result = await recordAllConsents({
      userId,
      source,
      ipAddress,
    });

    return NextResponse.json({
      ok: true,
      privacy_policy: {
        version: result.privacyPolicy.version,
        consentedAt: result.privacyPolicy.createdAt.toISOString(),
      },
      terms_of_service: {
        version: result.termsOfService.version,
        consentedAt: result.termsOfService.createdAt.toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.startsWith('INVALID_VERSION')) {
      return NextResponse.json({ error: 'INVALID_VERSION' }, { status: 400 });
    }
    return NextResponse.json({ error: 'CONSENT_RECORD_FAILED' }, { status: 500 });
  }
}
