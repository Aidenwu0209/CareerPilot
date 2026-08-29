import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveOrgAdmin } from '@/lib/auth/org-guard';
import { resolveActiveContext } from '@/lib/auth/guards';
import {
  addSchoolDomain,
  createSchoolInvite,
  deactivateSchoolSetting,
  getSchoolSettings,
  SchoolError,
  upsertSchoolDiscount,
  verifySchoolDomain,
} from '@/lib/organizations/school-service';

const createSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add_domain'), domain: z.string().min(4).max(253) }),
  z.object({ action: z.literal('create_invite'), maxUses: z.number().int().min(1).max(100_000).optional(), expiresAt: z.string().datetime().nullable().optional() }),
  z.object({ action: z.literal('upsert_discount'), planCode: z.string().max(80).default('*'), percentOff: z.number().int().min(1).max(90) }),
]);
const deleteSchema = z.object({ resource: z.enum(['invite', 'discount', 'domain']), id: z.string().min(1) });
const verifySchema = z.object({ domainId: z.string().min(1) });

function schoolError(error: unknown) {
  if (error instanceof SchoolError) return NextResponse.json({ error: error.code }, { status: 400 });
  throw error;
}

export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const auth = await resolveOrgAdmin(orgId);
  if (!auth.ok) return auth.response;
  try { return NextResponse.json(await getSchoolSettings(orgId)); } catch (error) { return schoolError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const auth = await resolveOrgAdmin(orgId);
  if (!auth.ok) return auth.response;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  try {
    if (parsed.data.action === 'add_domain') return NextResponse.json(await addSchoolDomain(orgId, auth.adminId, parsed.data.domain), { status: 201 });
    if (parsed.data.action === 'create_invite') return NextResponse.json(await createSchoolInvite(orgId, auth.adminId, parsed.data), { status: 201 });
    return NextResponse.json(await upsertSchoolDiscount(orgId, auth.adminId, parsed.data.planCode, parsed.data.percentOff), { status: 201 });
  } catch (error) { return schoolError(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const auth = await resolveOrgAdmin(orgId);
  if (!auth.ok) return auth.response;
  const ctx = await resolveActiveContext();
  if (!ctx || !ctx.ok || ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'SUPER_ADMIN_REQUIRED' }, { status: 403 });
  }
  const parsed = verifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  try { return NextResponse.json(await verifySchoolDomain(orgId, parsed.data.domainId)); } catch (error) { return schoolError(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const auth = await resolveOrgAdmin(orgId);
  if (!auth.ok) return auth.response;
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  try { return NextResponse.json(await deactivateSchoolSetting(orgId, parsed.data.resource, parsed.data.id)); } catch (error) { return schoolError(error); }
}
