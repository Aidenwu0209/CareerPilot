import { NextRequest, NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { getUserIdFromRequest } from '@/lib/auth/helpers';
import {
  validateBase64Image,
  validatePromptLength,
  MAX_SHORT_TEXT_LENGTH,
  sanitizedError,
} from '@/lib/validation/input-limits';
import { executeAiOperation } from '@/lib/ai/gateway';
import { warnLegacyByok } from '@/lib/ai/legacy-detect';
import { dispatchManagedImageEdit } from '@/lib/ai/image-dispatch';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  await warnLegacyByok(request);
  // Verify authentication and active status before any external calls
  const ctx = await resolveActiveContext(getUserIdFromRequest(request));
  if (!ctx) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }
  if (!ctx.ok) {
    return ctx.response;
  }

  const { image, prompt, requirements, aspectRatio, model } = await request.json();

  if (!image || typeof image !== 'string') {
    return NextResponse.json(
      { error: 'Image is required' },
      { status: 400 }
    );
  }

  // Validate image size and MIME type before sending to provider
  const imageCheck = validateBase64Image(image);
  if (!imageCheck.ok) {
    return sanitizedError(imageCheck.error);
  }

  // Validate prompt lengths before concatenation
  if (typeof prompt === 'string') {
    const promptCheck = validatePromptLength(prompt);
    if (!promptCheck.ok) return sanitizedError(promptCheck.error);
  }
  if (typeof requirements === 'string') {
    const reqCheck = validatePromptLength(requirements, MAX_SHORT_TEXT_LENGTH);
    if (!reqCheck.ok) return sanitizedError(reqCheck.error);
  }

  // Build final prompt with aspect ratio and requirements
  let finalPrompt = prompt || 'Generate a professional headshot from this photo.';
  if (aspectRatio && aspectRatio !== '1:1') {
    finalPrompt += `\n\nOutput image aspect ratio: ${aspectRatio} (width:height).`;
  }
  if (requirements) {
    finalPrompt += `\n\nAdditional requirements: ${requirements}`;
  }

  // Extract base64 data and mime type from data URL
  const dataUrlMatch = image.match(/^data:(image\/[\w+]+);base64,([\s\S]+)$/);
  const mimeType = dataUrlMatch ? dataUrlMatch[1] : 'image/jpeg';
  const base64Data = dataUrlMatch ? dataUrlMatch[2] : image;

  // AC1+AC2+AC3: Execute through unified gateway (auth, rate limit, hold, managed credentials)
  const result = await executeAiOperation<{
    image: string;
    text: string | null;
    safetyFiltered?: boolean;
  }>({
    context: ctx.context,
    modelId: model || 'linkedin-photo-default',
    capability: 'image_generation',
    businessCapability: 'linkedin_photo',
    idempotencyKey: `linkedin-photo-${ctx.context.actor.userId}-${Date.now()}`,
    dispatch: (gwCtx) => dispatchManagedImageEdit(gwCtx, {
      prompt: finalPrompt,
      mimeType,
      base64Data,
      aspectRatio,
    }),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.status }
    );
  }

  if (result.data.safetyFiltered) {
    return NextResponse.json({ error: 'safety_filtered' }, { status: 400 });
  }

  return NextResponse.json({ image: result.data.image, text: result.data.text });
}
