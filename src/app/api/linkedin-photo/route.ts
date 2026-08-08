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

export const maxDuration = 60;

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models';

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

  const { image, prompt, requirements, aspectRatio } = await request.json();

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
    modelId: 'linkedin-photo-default',
    capability: 'image_generation',
    businessCapability: 'linkedin_photo',
    idempotencyKey: `linkedin-photo-${ctx.context.actor.userId}-${Date.now()}`,
    dispatch: async (gwCtx) => {
      const endpoint = `${GEMINI_ENDPOINT}/${gwCtx.modelIdentifier}:generateContent?key=${encodeURIComponent(gwCtx.apiKey)}`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: finalPrompt },
                {
                  inlineData: {
                    mimeType,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
          },
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        const err = new Error(`Gemini API error: ${res.status}`);
        // Attach sanitized detail for logging, but don't expose to client
        console.error('Gemini API error:', res.status, errBody.slice(0, 200));
        throw err;
      }

      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts;

      if (!parts || parts.length === 0) {
        const candidate = data?.candidates?.[0];
        const finishReason = candidate?.finishReason ?? candidate?.finish_reason;
        if (finishReason === 'SAFETY') {
          return {
            image: '',
            text: null,
            safetyFiltered: true,
            usage: { totalTokens: 1 },
          };
        }
        throw new Error('No content in Gemini response');
      }

      // Extract image and text from parts
      let resultImage: string | null = null;
      let resultText: string | null = null;

      for (const part of parts) {
        const inlineData = part.inlineData ?? part.inline_data;
        if (inlineData) {
          const mime = inlineData.mimeType ?? inlineData.mime_type ?? 'image/png';
          resultImage = `data:${mime};base64,${inlineData.data}`;
        }
        if (part.text) {
          resultText = part.text;
        }
      }

      if (!resultImage) {
        throw new Error('No image in Gemini response');
      }

      // Return result with usage info for gateway settlement
      return {
        image: resultImage,
        text: resultText,
        usage: { totalTokens: 1 },
      };
    },
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
