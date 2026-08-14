import 'server-only';

import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, dbReady } from '@/lib/db';
import { supportTickets, users } from '@/lib/db/schema';

export const supportCategories = ['account', 'billing', 'technical', 'career', 'other'] as const;
export const supportStatuses = ['open', 'in_progress', 'replied', 'closed'] as const;
export type SupportCategory = typeof supportCategories[number];
export type SupportStatus = typeof supportStatuses[number];

const createTicketSchema = z.object({
  category: z.enum(supportCategories),
  subject: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(4_000),
});

const updateTicketSchema = z.object({
  status: z.enum(supportStatuses).optional(),
  reply: z.string().trim().min(2).max(4_000).optional(),
}).refine((value) => value.status !== undefined || value.reply !== undefined);

export class SupportValidationError extends Error {
  constructor() {
    super('INVALID_INPUT');
    this.name = 'SupportValidationError';
  }
}

export async function createSupportTicket(userId: string, input: unknown) {
  const parsed = createTicketSchema.safeParse(input);
  if (!parsed.success) throw new SupportValidationError();
  await dbReady;
  const [ticket] = await db.insert(supportTickets).values({
    userId,
    ...parsed.data,
  }).returning();
  return ticket;
}

export async function listUserSupportTickets(userId: string) {
  await dbReady;
  return db.select().from(supportTickets)
    .where(eq(supportTickets.userId, userId))
    .orderBy(desc(supportTickets.createdAt))
    .limit(50);
}

export async function listAdminSupportTickets(input: {
  status?: SupportStatus;
  page?: number;
  pageSize?: number;
}) {
  await dbReady;
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Math.trunc(input.pageSize ?? 20)));
  const conditions: SQL[] = [];
  if (input.status) conditions.push(eq(supportTickets.status, input.status));
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, totals] = await Promise.all([
    db.select({
      id: supportTickets.id,
      userId: supportTickets.userId,
      userName: users.name,
      userEmail: users.email,
      category: supportTickets.category,
      subject: supportTickets.subject,
      description: supportTickets.description,
      status: supportTickets.status,
      adminReply: supportTickets.adminReply,
      repliedAt: supportTickets.repliedAt,
      closedAt: supportTickets.closedAt,
      createdAt: supportTickets.createdAt,
      updatedAt: supportTickets.updatedAt,
    }).from(supportTickets)
      .leftJoin(users, eq(users.id, supportTickets.userId))
      .where(where)
      .orderBy(desc(supportTickets.updatedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(supportTickets).where(where),
  ]);

  const total = Number(totals[0]?.value ?? 0);
  return { rows, page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function updateSupportTicket(
  ticketId: string,
  adminUserId: string,
  input: unknown,
) {
  const parsed = updateTicketSchema.safeParse(input);
  if (!parsed.success) throw new SupportValidationError();
  await dbReady;
  const [existing] = await db.select().from(supportTickets)
    .where(eq(supportTickets.id, ticketId)).limit(1);
  if (!existing) return null;

  const now = new Date();
  const status = parsed.data.status ?? (parsed.data.reply ? 'replied' : existing.status);
  const [updated] = await db.update(supportTickets).set({
    status,
    adminReply: parsed.data.reply ?? existing.adminReply,
    repliedByUserId: parsed.data.reply ? adminUserId : existing.repliedByUserId,
    repliedAt: parsed.data.reply ? now : existing.repliedAt,
    closedAt: status === 'closed' ? (existing.closedAt ?? now) : null,
    updatedAt: now,
  }).where(eq(supportTickets.id, ticketId)).returning();
  return updated ?? null;
}
