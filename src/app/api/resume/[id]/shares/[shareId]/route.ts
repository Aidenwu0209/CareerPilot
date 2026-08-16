import { NextRequest, NextResponse } from 'next/server';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { shareRepository } from '@/lib/db/repositories/share.repository';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { hashPassword } from '@/lib/utils/share';
import { logger } from '@/lib/observability/logger';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  try {
    const { id, shareId } = await params;
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resume = await resumeRepository.findById(id);
    if (!resume || resume.userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const share = await shareRepository.findById(shareId);
    if (!share || share.resumeId !== id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const { label, password, isActive } = body as {
      label?: string;
      password?: string | null;
      isActive?: boolean;
    };

    const updates: { label?: string; password?: string | null; isActive?: boolean } = {};
    if (label !== undefined) updates.label = label;
    if (password !== undefined) {
      updates.password = password ? await hashPassword(password) : null;
    }
    if (isActive !== undefined) updates.isActive = isActive;

    const updated = await shareRepository.update(shareId, updates);
    logger.info('resume.share_updated', { shareId, isActive: updated?.isActive, updatedFields: Object.keys(updates) });
    return NextResponse.json({
      ...updated,
      hasPassword: !!updated?.password,
      password: undefined,
    });
  } catch (error) {
    logger.error('resume.share_update_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  try {
    const { id, shareId } = await params;
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resume = await resumeRepository.findById(id);
    if (!resume || resume.userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const share = await shareRepository.findById(shareId);
    if (!share || share.resumeId !== id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await shareRepository.delete(shareId);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('resume.share_delete_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
