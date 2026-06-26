import { query, getPool } from "@/lib/seyf/db/client";
import type { TransactionStatus } from "@/lib/seyf/transactions/types";
import { assertValidTransactionTransition } from "@/lib/seyf/transactions/state-machine";
import { logger } from "@/lib/observability/logger";
import { randomUUID } from "node:crypto";

export type WithdrawalRow = {
  id: string;
  user_id: string;
  type: string;
  status: TransactionStatus;
  amount_mxn: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

export type UserBalanceRow = {
  id: string;
  user_id: string;
  available_balance_mxn: string;
  created_at: Date;
  updated_at: Date;
};

export async function getWithdrawalById(id: string): Promise<WithdrawalRow | null> {
  const result = await query<WithdrawalRow>(
    `select id, user_id, type, status, amount_mxn::text as amount_mxn, metadata, created_at, updated_at
     from withdrawals where id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function getUserBalance(userId: string): Promise<UserBalanceRow | null> {
  const result = await query<UserBalanceRow>(
    `select id, user_id, available_balance_mxn::text as available_balance_mxn, created_at, updated_at
     from user_balances where user_id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function getOrCreateUserBalance(userId: string): Promise<UserBalanceRow> {
  const existing = await getUserBalance(userId);
  if (existing) return existing;

  await query(
    `insert into user_balances (user_id, available_balance_mxn)
     values ($1, 0)
     on conflict (user_id) do nothing`,
    [userId],
  );

  const created = await getUserBalance(userId);
  if (!created) {
    throw new Error(`Failed to create balance for user ${userId}`);
  }
  return created;
}

export async function listStuckWithdrawals(hours = 4): Promise<WithdrawalRow[]> {
  const result = await query<WithdrawalRow>(
    `select id, user_id, type, status, amount_mxn::text as amount_mxn, metadata, created_at, updated_at
     from withdrawals
     where status = 'pending'
       and created_at < now() - make_interval(hours => $1)
     order by created_at asc`,
    [hours],
  );
  return result.rows;
}

export async function markWebhookEventProcessed(eventId: string, eventType: string, withdrawalId: string | null): Promise<boolean> {
  try {
    await query(
      `insert into processed_webhook_events (event_id, event_type, withdrawal_id)
       values ($1, $2, $3)
       on conflict (event_id) do nothing`,
      [eventId, eventType, withdrawalId],
    );
    return true;
  } catch (e) {
    logger.error(
      { eventId, eventType, withdrawalId, error: e instanceof Error ? e.message : String(e) },
      "Failed to mark webhook event as processed",
    );
    return false;
  }
}

export async function isWebhookEventProcessed(eventId: string): Promise<boolean> {
  const result = await query<{ id: string }>(
    `select id from processed_webhook_events where event_id = $1`,
    [eventId],
  );
  return result.rows.length > 0;
}

export async function processCompletedWithdrawal(
  withdrawalId: string,
  actor: string,
): Promise<{ ok: boolean; withdrawal: WithdrawalRow | null }> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("select set_config('seyf.actor', $1, true)", [actor]);

    const withdrawal = await client.query<WithdrawalRow>(
      `select id, user_id, type, status, amount_mxn::text as amount_mxn, metadata, created_at, updated_at
       from withdrawals where id = $1 for update`,
      [withdrawalId],
    );

    const w = withdrawal.rows[0];
    if (!w) {
      await client.query("ROLLBACK");
      return { ok: false, withdrawal: null };
    }

    if (w.status === "completed") {
      await client.query("ROLLBACK");
      return { ok: true, withdrawal: w };
    }

    assertValidTransactionTransition("withdrawal", w.status, "completed");

    await client.query(
      `update withdrawals set status = 'completed', updated_at = now() where id = $1`,
      [withdrawalId],
    );

    await client.query("COMMIT");
    return { ok: true, withdrawal: { ...w, status: "completed" as TransactionStatus } };
  } catch (e) {
    await client.query("ROLLBACK");
    logger.error(
      { withdrawalId, actor, error: e instanceof Error ? e.message : String(e) },
      "processCompletedWithdrawal failed",
    );
    return { ok: false, withdrawal: null };
  } finally {
    client.release();
  }
}

export async function processFailedWithdrawal(
  withdrawalId: string,
  reason: string,
  actor: string,
): Promise<{ ok: boolean; withdrawal: WithdrawalRow | null; restoredAmount: number }> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("select set_config('seyf.actor', $1, true)", [actor]);

    const withdrawal = await client.query<WithdrawalRow>(
      `select id, user_id, type, status, amount_mxn::text as amount_mxn, metadata, created_at, updated_at
       from withdrawals where id = $1 for update`,
      [withdrawalId],
    );

    const w = withdrawal.rows[0];
    if (!w) {
      await client.query("ROLLBACK");
      return { ok: false, withdrawal: null, restoredAmount: 0 };
    }

    if (w.status === "failed") {
      await client.query("ROLLBACK");
      return { ok: true, withdrawal: w, restoredAmount: 0 };
    }

    assertValidTransactionTransition("withdrawal", w.status, "failed");

    const amountMxn = Number(w.amount_mxn);

    const updatedMetadata = {
      ...(w.metadata as Record<string, unknown>),
      failure_reason: reason,
      failed_at: new Date().toISOString(),
    };

    await client.query(
      `update withdrawals set status = 'failed', metadata = $2::jsonb, updated_at = now() where id = $1`,
      [withdrawalId, JSON.stringify(updatedMetadata)],
    );

    await client.query(
      `update user_balances set available_balance_mxn = available_balance_mxn + $2, updated_at = now() where user_id = $1`,
      [w.user_id, amountMxn],
    );

    await client.query("COMMIT");
    return { ok: true, withdrawal: { ...w, status: "failed" as TransactionStatus, metadata: updatedMetadata }, restoredAmount: amountMxn };
  } catch (e) {
    await client.query("ROLLBACK");
    logger.error(
      { withdrawalId, actor, error: e instanceof Error ? e.message : String(e) },
      "processFailedWithdrawal failed",
    );
    return { ok: false, withdrawal: null, restoredAmount: 0 };
  } finally {
    client.release();
  }
}

export async function retryStuckWithdrawal(withdrawalId: string, actor: string): Promise<{ ok: boolean; withdrawal: WithdrawalRow | null }> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("select set_config('seyf.actor', $1, true)", [actor]);

    const withdrawal = await client.query<WithdrawalRow>(
      `select id, user_id, type, status, amount_mxn::text as amount_mxn, metadata, created_at, updated_at
       from withdrawals where id = $1 for update`,
      [withdrawalId],
    );

    const w = withdrawal.rows[0];
    if (!w) {
      await client.query("ROLLBACK");
      return { ok: false, withdrawal: null };
    }

    if (w.status !== "pending") {
      await client.query("ROLLBACK");
      return { ok: false, withdrawal: w };
    }

    assertValidTransactionTransition("withdrawal", "pending", "processing");

    await client.query(
      `update withdrawals set status = 'processing', metadata = metadata || $2::jsonb, updated_at = now() where id = $1`,
      [withdrawalId, JSON.stringify({ retried_at: new Date().toISOString(), retried_by: actor })],
    );

    await client.query("COMMIT");
    return { ok: true, withdrawal: { ...w, status: "processing" as TransactionStatus } };
  } catch (e) {
    await client.query("ROLLBACK");
    logger.error(
      { withdrawalId, actor, error: e instanceof Error ? e.message : String(e) },
      "retryStuckWithdrawal failed",
    );
    return { ok: false, withdrawal: null };
  } finally {
    client.release();
  }
}

export async function initiateWithdrawal(params: {
  userId: string;
  amountMxn: number;
  clabe: string;
  alias?: string;
  actor: string;
}): Promise<{ ok: boolean; withdrawal: WithdrawalRow | null }> {
  // Validate CLABE
  const clabeDigits = params.clabe.replace(/\D/g, "");
  if (clabeDigits.length !== 18) {
    throw new Error("Invalid CLABE: must be 18 digits");
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("select set_config('seyf.actor', $1, true)", [params.actor]);

    // Check user balance
    const balanceResult = await client.query<{ available_balance_mxn: string }>(
      `select available_balance_mxn::text as available_balance_mxn
       from user_balances
       where user_id = $1
       for update`,
      [params.userId],
    );

    const balanceRow = balanceResult.rows[0];
    if (!balanceRow) {
      // User balance row does not exist, so they have 0 balance
      await client.query("ROLLBACK");
      return { ok: false, withdrawal: null };
    }

    const availableBalance = Number(balanceRow.available_balance_mxn);
    if (availableBalance < params.amountMxn) {
      await client.query("ROLLBACK");
      return { ok: false, withdrawal: null };
    }

    // Deduct balance
    await client.query(
      `update user_balances
       set available_balance_mxn = available_balance_mxn - $2, updated_at = now()
       where user_id = $1`,
      [params.userId, params.amountMxn],
    );

    // Create withdrawal record
    const withdrawalId = randomUUID();
    const metadata = {
      clabe: clabeDigits,
      alias: params.alias || null,
      initiated_at: new Date().toISOString(),
    };

    const insertResult = await client.query<WithdrawalRow>(
      `insert into withdrawals (id, user_id, status, amount_mxn, metadata, created_at, updated_at)
       values ($1, $2, 'pending', $3, $4, now(), now())
       returning id, user_id, type, status, amount_mxn::text as amount_mxn, metadata, created_at, updated_at`,
      [withdrawalId, params.userId, params.amountMxn, JSON.stringify(metadata)],
    );

    await client.query("COMMIT");
    return { ok: true, withdrawal: insertResult.rows[0] ?? null };
  } catch (e) {
    await client.query("ROLLBACK");
    logger.error(
      { userId: params.userId, amountMxn: params.amountMxn, error: e instanceof Error ? e.message : String(e) },
      "initiateWithdrawal failed",
    );
    return { ok: false, withdrawal: null };
  } finally {
    client.release();
  }
}
