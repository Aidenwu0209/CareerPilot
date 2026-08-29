import { NextRequest, NextResponse } from 'next/server';
import { getCareerPath } from '@/lib/career/service';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';
import { getCareerAccess } from '@/lib/career/growth-service';

export async function GET(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const [path, access] = await Promise.all([getCareerPath(user.id), getCareerAccess(user.id)]);
    const locked = !access.features.full_path.unlocked;
    return NextResponse.json({
      path: locked ? { ...path, stages: path.stages.slice(0, 1) } : path,
      access,
      locked,
      lockedStageCount: locked ? Math.max(0, path.stages.length - 1) : 0,
    });
  } catch (error) {
    return careerApiError(error, 'GET /api/career/path');
  }
}
