import { NextRequest } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { getUserIdFromRequest } from '@/lib/auth/helpers';
import {
  checkRateLimit,
  rateLimitedResponse,
  RATE_LIMIT_POLICIES,
  rateLimitKey,
} from '@/lib/rate-limit/rate-limit';

export async function GET(request: NextRequest) {
  // Verify authentication and active status before any provider calls
  const ctx = await resolveActiveContext(getUserIdFromRequest(request));
  if (!ctx) {
    return Response.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }
  if (!ctx.ok) {
    return ctx.response;
  }

  // Rate limit: per-user, fail-open (read-only catalog lookup)
  const rlResult = await checkRateLimit(
    rateLimitKey('ai-models', 'user', ctx.context.actor.userId),
    RATE_LIMIT_POLICIES.aiModels,
  );
  if (!rlResult.allowed) {
    return rateLimitedResponse(rlResult.retryAfter);
  }

  const provider = request.headers.get('x-provider') || 'openai';
  const apiKey = request.headers.get('x-api-key') || '';
  const baseURL = request.headers.get('x-base-url') || '';

  if (!apiKey) {
    return Response.json({ models: [] });
  }

  try {
    let models: { id: string }[] = [];

    switch (provider) {
      case 'anthropic': {
        const url = baseURL
          ? `${baseURL.replace(/\/$/, '')}/v1/models`
          : 'https://api.anthropic.com/v1/models';
        const res = await fetch(url, {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
        });
        if (!res.ok) return Response.json({ models: [] });
        const data = await res.json();
        models = (data.data ?? []).map((m: { id: string }) => ({ id: m.id }));
        break;
      }

      case 'gemini': {
        const url = baseURL
          ? `${baseURL.replace(/\/$/, '')}/models?key=${apiKey}`
          : `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const res = await fetch(url);
        if (!res.ok) return Response.json({ models: [] });
        const data = await res.json();
        models = (data.models ?? []).map((m: { name: string }) => ({
          id: m.name.replace(/^models\//, ''),
        }));
        break;
      }

      default: {
        // openai
        const effectiveBaseURL = baseURL || 'https://api.openai.com/v1';
        const res = await fetch(`${effectiveBaseURL}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return Response.json({ models: [] });
        const data = await res.json();
        models = (data.data ?? data).map((m: { id: string }) => ({ id: m.id }));
        break;
      }
    }

    return Response.json({ models });
  } catch {
    return Response.json({ models: [] });
  }
}
