import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { config } from '@/lib/config';
import { creditAccounts, creditTransactions } from '@/lib/db/schema';
import {
  AccountFrozenError,
  AccountNotFoundError,
  CreditError,
  InsufficientCreditsError,
  postTransaction,
  type AccountRecord,
  type PostTransactionParams,
  type PostTransactionResult,
  type TransactionRecord,
} from './ledger';

/**
 * Async, cross-adapter ledger entry point for payment workflows.
 * SQLite delegates to the existing BEGIN IMMEDIATE implementation. PostgreSQL
 * locks the account row with FOR UPDATE inside an async transaction.
 */
export async function postTransactionPortable(
  params: PostTransactionParams,
): Promise<PostTransactionResult> {
  if (config.db.type === 'sqlite') return postTransaction(params);

  return db.transaction(async (tx: typeof db) => {
    const existingRows = await tx.select().from(creditTransactions).where(and(
      eq(creditTransactions.accountId, params.accountId),
      eq(creditTransactions.idempotencyKey, params.idempotencyKey),
    )).limit(1);
    const existing = existingRows[0];
    if (existing) {
      const accountRows = await tx.select().from(creditAccounts)
        .where(eq(creditAccounts.id, params.accountId)).limit(1);
      return {
        transaction: existing as TransactionRecord,
        account: accountRows[0] as AccountRecord,
        idempotent: true,
      };
    }

    const accountRows = await tx.select().from(creditAccounts)
      .where(eq(creditAccounts.id, params.accountId))
      .for('update')
      .limit(1);
    const account = accountRows[0];
    if (!account) throw new AccountNotFoundError(params.accountId);
    if (account.status === 'frozen') throw new AccountFrozenError(params.accountId);

    const newBalance = account.balance + params.delta;
    if (newBalance < 0) {
      throw new InsufficientCreditsError(params.accountId, Math.abs(params.delta), account.balance);
    }

    const now = new Date();
    await tx.update(creditAccounts).set({ balance: newBalance, updatedAt: now })
      .where(eq(creditAccounts.id, account.id));
    const transaction: TransactionRecord = {
      id: crypto.randomUUID(),
      accountId: account.id,
      balanceBefore: account.balance,
      delta: params.delta,
      balanceAfter: newBalance,
      reason: params.reason,
      operatorId: params.operatorId ?? null,
      businessRefId: params.businessRefId ?? null,
      idempotencyKey: params.idempotencyKey,
      ruleSnapshot: params.ruleSnapshot ?? {},
      note: params.note ?? '',
      createdAt: now,
    };
    await tx.insert(creditTransactions).values(transaction);
    return {
      transaction,
      account: { ...account, balance: newBalance, updatedAt: now } as AccountRecord,
      idempotent: false,
    };
  });
}

export async function creditAccountPortable(
  params: Omit<PostTransactionParams, 'delta'> & { amount: number },
): Promise<PostTransactionResult> {
  if (params.amount <= 0) throw new CreditError('Credit amount must be positive', 'INVALID_AMOUNT');
  return postTransactionPortable({ ...params, delta: params.amount });
}

export async function debitAccountPortable(
  params: Omit<PostTransactionParams, 'delta'> & { amount: number },
): Promise<PostTransactionResult> {
  if (params.amount <= 0) throw new CreditError('Debit amount must be positive', 'INVALID_AMOUNT');
  return postTransactionPortable({ ...params, delta: -params.amount });
}
