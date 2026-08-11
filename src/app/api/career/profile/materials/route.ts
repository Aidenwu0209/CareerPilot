import { NextRequest, NextResponse } from 'next/server';
import { syncCareerMaterials } from '@/lib/career/materials';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';

export async function POST(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    return NextResponse.json({ result: await syncCareerMaterials(user.id) });
  } catch (error) {
    return careerApiError(error, 'POST /api/career/profile/materials');
  }
}
