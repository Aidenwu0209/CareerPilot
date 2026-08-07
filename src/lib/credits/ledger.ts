/**
 * Atomic Credit Ledger Service
 *
 * The single entry point for all credit and quota balance changes.
 * Every balance mutation — registration grants, manual adjustments,
 * consumption, refunds, hold settlements — MUST go through this service
 * to guarantee atomicity, idempotency, and non-negative balances.
 *
 * Design goals (US-025):
 * - AC1: Locks the account row, validates balance, appends an immutable
 *   ledger entry, and updates the balance snapshot — all inside one DB
 *   transaction with `BEGIN IMMEDIATE` so that concurrent writers are
 *   serialised at the storage layer.
 * - AC2: Insufficient credits returns a structured error and leaves the
 *   account, balance, and ledger completely untouched.
 * - AC3: The compound unique constraint on (account_id, idempotency_key)
 *   means a duplicate request returns the original result without creating
 *   a second ledger entry.
 * - AC4: The DB-level CHECK (balance >= 0) is the ultimate safety net;
 *   `BEGIN IMMEDIATE` prevents read-then-write races.
 * - AC5: Every mutation receives a `reason` code drawn from a fixed enum
 *   so that ledger entries are machine-queryable.
 */

import { db } from '@/lib/db';
import { creditAccounts, creditTransactions } from '@/lib/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

// ── Error types ──

export class CreditError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = 'CreditError';
  }
}

export class InsufficientCreditsError extends CreditError {
  constructor(accountId: string, attempted: number, balance: number) {
    super(
      `Insufficient credits: account ${accountId} has balance ${balance}, attempted to debit ${attempted}`,
      'INSUFFICIENT_CREDITS',
    );
    this.name = 'InsufficientCreditsError';
  }
}

export class AccountNotFoundError extends CreditError {
  constructor(accountId: string) {
    super(`Credit account not found: ${accountId}`, 'ACCOUNT_NOT_FOUND');
    this.name = 'AccountNotFoundError';
  }
}

export class AccountFrozenError extends CreditError {
  constructor(accountId: string) {
    super(`Credit account is frozen: ${accountId}`, 'ACCOUNT_FROZEN');
    this.name = 'AccountFrozenError';
  }
}

// ── Types ──

export type CreditReason =
  | 'registration_grant'
  | 'manual_credit'
  | 'manual_debit'
  | 'consumption'
  | 'refund'
  | 'adjustment';

export type OwnerType = 'user' | 'organization';

export interface PostTransactionParams {
  accountId: string;
  /** Positive for credits, negative for debits. */
  delta: number;
  reason: CreditReason;
  operatorId?: string | null;
  businessRefId?: string | null;
  /** Must be unique per (accountId, idempotencyKey). Duplicate requests
   *  with the same key return the original result. */
  idempotencyKey: string;
  ruleSnapshot?: Record<string, unknown>;
  note?: string;
}

export interface TransactionRecord {
  id: string;
  accountId: string;
  balanceBefore: number;
  delta: number;
  balanceAfter: number;
  reason: CreditReason;
  operatorId: string | null;
  businessRefId: string | null;
  idempotencyKey: string;
  ruleSnapshot: unknown;
  note: string;
  createdAt: Date;
}

export interface AccountRecord {
  id: string;
  ownerType: string;
  ownerId: string;
  balance: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PostTransactionResult {
  transaction: TransactionRecord;
  account: AccountRecord;
  /** true when the request was deduplicated by idempotency key. */
  idempotent: boolean;
}

// ── Account helpers ──

/**
 * Finds a credit account by owner type + owner ID.
 */
export async function getAccount(
  ownerType: OwnerType,
  ownerId: string,
): Promise<AccountRecord | null> {
  const rows = await db
    .select()
    .from(creditAccounts)
    .where(
      and(
        eq(creditAccounts.ownerType, ownerType),
        eq(creditAccounts.ownerId, ownerId),
      ),
    )
    .limit(1);
  return (rows[0] as AccountRecord) ?? null;
}

/**
 * Finds a credit account by its primary key.
 */
export async function getAccountById(accountId: string): Promise<AccountRecord | null> {
  const rows = await db
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.id, accountId))
    .limit(1);
  return (rows[0] as AccountRecord) ?? null;
}

/**
 * Finds an existing credit account or creates a new one with balance 0.
 * The compound unique constraint on (owner_type, owner_id) guarantees that
 * concurrent calls produce exactly one account.
 */
export async function getOrCreateAccount(
  ownerType: OwnerType,
  ownerId: string,
): Promise<AccountRecord> {
  const existing = await getAccount(ownerType, ownerId);
  if (existing) return existing;

  const id = crypto.randomUUID();
  try {
    await db.insert(creditAccounts).values({ id, ownerType, ownerId });
  } catch {
    // Race condition: another caller created the account — re-read.
    const retry = await getAccount(ownerType, ownerId);
    if (retry) return retry;
    throw new CreditError('Failed to create credit account', 'ACCOUNT_CREATE_FAILED');
  }

  const created = await getAccountById(id);
  if (!created) throw new CreditError('Account vanished after creation', 'ACCOUNT_CREATE_FAILED');
  return created;
}

/**
 * Returns the current balance for an account.
 */
export async function getBalance(accountId: string): Promise<number> {
  const rows = await db
    .select({ balance: creditAccounts.balance })
    .from(creditAccounts)
    .where(eq(creditAccounts.id, accountId))
    .limit(1);
  return rows[0]?.balance ?? 0;
}

/**
 * Returns paginated transactions for an account, newest first.
 */
export async function getTransactions(
  accountId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<TransactionRecord[]> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const rows = await db
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.accountId, accountId))
    .orderBy(desc(creditTransactions.createdAt))
    .limit(limit)
    .offset(offset);

  return rows as TransactionRecord[];
}

// ── Core atomic operation ──

/**
 * Posts a single immutable ledger entry atomically.
 *
 * The entire operation — idempotency check, account lock, balance
 * validation, balance update, and ledger insert — happens inside a
 * single `BEGIN IMMEDIATE` transaction so that:
 *
 * 1. No two concurrent writers can read the same stale balance.
 * 2. A duplicate (accountId, idempotencyKey) returns the original result.
 * 3. If the balance would go negative, nothing changes.
 *
 * @throws {InsufficientCreditsError} when delta would produce a negative balance.
 * @throws {AccountNotFoundError} when the account does not exist.
 * @throws {AccountFrozenError} when the account status is 'frozen'.
 */
export function postTransaction(params: PostTransactionParams): PostTransactionResult {
  // `db` is `any` at the type level (cross-adapter). At runtime with
  // better-sqlite3, `.transaction()` accepts a synchronous callback and
  // a `{ behavior: 'immediate' }` config that issues `BEGIN IMMEDIATE`,
  // acquiring the exclusive write lock before any reads.
  return db.transaction(
    (tx: typeof db) => {
      // 1. Idempotency fast-path — if a transaction with the same key
      //    already exists, return it without creating a new one.
      const existing = tx
        .select()
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.accountId, params.accountId),
            eq(creditTransactions.idempotencyKey, params.idempotencyKey),
          ),
        )
        .get();

      if (existing) {
        const acct = tx
          .select()
          .from(creditAccounts)
          .where(eq(creditAccounts.id, params.accountId))
          .get();

        return {
          transaction: existing as TransactionRecord,
          account: acct as AccountRecord,
          idempotent: true,
        };
      }

      // 2. Lock and read the account row.
      const account = tx
        .select()
        .from(creditAccounts)
        .where(eq(creditAccounts.id, params.accountId))
        .get();

      if (!account) throw new AccountNotFoundError(params.accountId);
      if (account.status === 'frozen') throw new AccountFrozenError(params.accountId);

      // 3. Validate the resulting balance.
      const newBalance = account.balance + params.delta;
      if (newBalance < 0) {
        throw new InsufficientCreditsError(
          params.accountId,
          Math.abs(params.delta),
          account.balance,
        );
      }

      // 4. Update the balance snapshot.
      tx.update(creditAccounts)
        .set({ balance: newBalance, updatedAt: new Date() })
        .where(eq(creditAccounts.id, account.id))
        .run();

      // 5. Append the immutable ledger entry.
      const txId = crypto.randomUUID();
      tx.insert(creditTransactions)
        .values({
          id: txId,
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
        })
        .run();

      return {
        transaction: {
          id: txId,
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
          createdAt: new Date(),
        } as TransactionRecord,
        account: {
          ...account,
          balance: newBalance,
          updatedAt: new Date(),
        } as AccountRecord,
        idempotent: false,
      };
    },
    { behavior: 'immediate' },
  );
}

// ── Convenience wrappers ──

/**
 * Adds a positive amount to the account.
 */
export function creditAccount(params: Omit<PostTransactionParams, 'delta'> & { amount: number }): PostTransactionResult {
  if (params.amount <= 0) {
    throw new CreditError('Credit amount must be positive', 'INVALID_AMOUNT');
  }
  return postTransaction({ ...params, delta: params.amount });
}

/**
 * Subtracts a positive amount from the account.
 */
export function debitAccount(params: Omit<PostTransactionParams, 'delta'> & { amount: number }): PostTransactionResult {
  if (params.amount <= 0) {
    throw new CreditError('Debit amount must be positive', 'INVALID_AMOUNT');
  }
  return postTransaction({ ...params, delta: -params.amount });
}

/**
 * Recomputes the current balance from the full ledger and compares it
 * to the stored snapshot. Returns true when they match.
 *
 * This is the canonical "audit" check — if it ever returns false, the
 * ledger is corrupt.
 */
export async function verifyBalance(accountId: string): Promise<{
  storedBalance: number;
  computedBalance: number;
  match: boolean;
}> {
  const account = await getAccountById(accountId);
  const storedBalance = account?.balance ?? 0;

  // Sum of all deltas for this account.
  const rows = await db
    .select({ total: sql<number>`COALESCE(sum(${creditTransactions.delta}), 0)` })
    .from(creditTransactions)
    .where(eq(creditTransactions.accountId, accountId));

  const computedBalance = Number(rows[0]?.total ?? 0);

  return {
    storedBalance,
    computedBalance,
    match: storedBalance === computedBalance,
  };
}
