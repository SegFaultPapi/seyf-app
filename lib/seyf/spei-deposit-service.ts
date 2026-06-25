/**
 * spei-deposit-service.ts
 *
 * Database service layer for M03-T01: SPEI Inbound CLABE & Deposits.
 *
 * Responsible for:
 *   - Persisting the user ↔ virtual-CLABE mapping (user_clabes table)
 *   - Creating inbound SPEI deposit records (deposits table)
 *   - Idempotency tracking (processed_spei_inbound_events table)
 */

import { query, getPool } from "@/lib/seyf/db/client";
import { logger } from "@/lib/observability/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserClabe = {
  id: string;
  user_id: string;
  clabe: string;
  bank_name: string;
  beneficiary_name: string;
  deposit_limit_mxn: number;
  raw_provider_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type DepositRow = {
  id: string;
  user_id: string;
  type: string;
  status: string;
  amount_mxn: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CreatePendingDepositParams = {
  userId: string;
  clabe: string;
  amountMxn: number;
  speiReference: string | null;
  receivedAt: string | null;
  /** Status override for refund paths. Defaults to 'pending'. */
  status?: "pending" | "refund_pending";
  /** Optional note stored in metadata (e.g. 'below_minimum', 'exceeds_limit'). */
  note?: string;
};

// ─── CLABE Lookups ────────────────────────────────────────────────────────────

/**
 * Returns the virtual CLABE record for a user, or null if not provisioned yet.
 */
export async function getUserClabe(userId: string): Promise<UserClabe | null> {
  const result = await query<{
    id: string;
    user_id: string;
    clabe: string;
    bank_name: string;
    beneficiary_name: string;
    deposit_limit_mxn: string;
    raw_provider_data: Record<string, unknown> | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `select id, user_id, clabe, bank_name, beneficiary_name,
            deposit_limit_mxn::text as deposit_limit_mxn,
            raw_provider_data, created_at, updated_at
     from user_clabes
     where user_id = $1`,
    [userId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    ...row,
    deposit_limit_mxn: Number(row.deposit_limit_mxn),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * Looks up the user_id that owns a given CLABE number.
 * Used by the inbound webhook to route a transfer to the correct user.
 */
export async function getUserIdForClabe(clabe: string): Promise<string | null> {
  const result = await query<{ user_id: string }>(
    `select user_id from user_clabes where clabe = $1`,
    [clabe],
  );
  return result.rows[0]?.user_id ?? null;
}

/**
 * Returns the deposit limit (in MXN) for the user who owns a given CLABE.
 * Returns null if the CLABE is not found.
 */
export async function getDepositLimitForClabe(clabe: string): Promise<number | null> {
  const result = await query<{ deposit_limit_mxn: string }>(
    `select deposit_limit_mxn::text as deposit_limit_mxn
     from user_clabes where clabe = $1`,
    [clabe],
  );
  const row = result.rows[0];
  if (!row) return null;
  return Number(row.deposit_limit_mxn);
}

// ─── CLABE Provisioning ────────────────────────────────────────────────────────

/**
 * Inserts or updates the virtual CLABE record for a user (upsert on user_id).
 * Safe to call multiple times — returns the same CLABE if already provisioned.
 */
export async function upsertUserClabe(params: {
  userId: string;
  clabe: string;
  bankName: string;
  beneficiaryName: string;
  depositLimitMxn?: number;
  rawProviderData?: Record<string, unknown> | null;
}): Promise<UserClabe> {
  const {
    userId,
    clabe,
    bankName,
    beneficiaryName,
    depositLimitMxn = 50000,
    rawProviderData = null,
  } = params;

  const result = await query<{
    id: string;
    user_id: string;
    clabe: string;
    bank_name: string;
    beneficiary_name: string;
    deposit_limit_mxn: string;
    raw_provider_data: Record<string, unknown> | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `insert into user_clabes
       (user_id, clabe, bank_name, beneficiary_name, deposit_limit_mxn, raw_provider_data)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id) do update
       set bank_name        = excluded.bank_name,
           beneficiary_name = excluded.beneficiary_name,
           deposit_limit_mxn = excluded.deposit_limit_mxn,
           raw_provider_data = excluded.raw_provider_data,
           updated_at       = now()
     returning id, user_id, clabe, bank_name, beneficiary_name,
               deposit_limit_mxn::text as deposit_limit_mxn,
               raw_provider_data, created_at, updated_at`,
    [
      userId,
      clabe,
      bankName,
      beneficiaryName,
      depositLimitMxn,
      rawProviderData ? JSON.stringify(rawProviderData) : null,
    ],
  );

  const row = result.rows[0];
  return {
    ...row,
    deposit_limit_mxn: Number(row.deposit_limit_mxn),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

// ─── Deposit Creation ─────────────────────────────────────────────────────────

/**
 * Inserts a deposit record with the given status into the `deposits` table.
 * Returns the created row.
 *
 * The `deposits` table schema mirrors what `listTransactions` already expects:
 *   id, user_id, type, status, amount_mxn, metadata, created_at, updated_at
 */
export async function createPendingDeposit(
  params: CreatePendingDepositParams,
): Promise<DepositRow> {
  const {
    userId,
    clabe,
    amountMxn,
    speiReference,
    receivedAt,
    status = "pending",
    note,
  } = params;

  const metadata: Record<string, unknown> = {
    clabe,
    source: "spei_inbound",
    ...(speiReference ? { spei_reference: speiReference } : {}),
    ...(receivedAt ? { provider_received_at: receivedAt } : {}),
    ...(note ? { note } : {}),
  };

  // Ensure the user row exists (same pattern as withdrawal-service)
  await query(
    `insert into users (id) values ($1) on conflict (id) do nothing`,
    [userId],
  );

  const result = await query<{
    id: string;
    user_id: string;
    type: string;
    status: string;
    amount_mxn: string;
    metadata: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
  }>(
    `insert into deposits (user_id, type, status, amount_mxn, metadata)
     values ($1, 'deposit', $2, $3, $4::jsonb)
     returning id, user_id, type, status,
               amount_mxn::text as amount_mxn,
               metadata, created_at, updated_at`,
    [userId, status, amountMxn, JSON.stringify(metadata)],
  );

  const row = result.rows[0];
  return {
    ...row,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

// ─── Idempotency ──────────────────────────────────────────────────────────────

/**
 * Returns true if this inbound SPEI event has already been processed.
 * Prevents duplicate deposit rows on webhook re-delivery.
 */
export async function isSpeiInboundEventProcessed(eventId: string): Promise<boolean> {
  const result = await query<{ event_id: string }>(
    `select event_id from processed_spei_inbound_events where event_id = $1`,
    [eventId],
  );
  return result.rows.length > 0;
}

/**
 * Marks an inbound SPEI event as processed (idempotent insert — on conflict do nothing).
 */
export async function markSpeiInboundEventProcessed(
  eventId: string,
  depositId: string | null,
): Promise<void> {
  try {
    await query(
      `insert into processed_spei_inbound_events (event_id, deposit_id)
       values ($1, $2)
       on conflict (event_id) do nothing`,
      [eventId, depositId],
    );
  } catch (e) {
    logger.error(
      { eventId, depositId, error: e instanceof Error ? e.message : String(e) },
      "[spei-deposit-service] Failed to mark inbound SPEI event as processed",
    );
  }
}
