import { query } from "@/lib/seyf/db/client";
import {
  getStoredKycSnapshot,
  listStoredKycRows,
  upsertStoredKycSnapshot,
} from "@/lib/seyf/kyc-state-store";
import type { EtherfuseKycStatus } from "@/lib/etherfuse/kyc";
import { logger } from "@/lib/observability/logger";

export type KycReviewAction = "approve" | "reject";

export type KycReviewAuditEntry = {
  id: string;
  actor: string;
  action: KycReviewAction;
  target_customer_id: string;
  target_wallet_public_key: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  created_at: string;
};

export type KycCaseListItem = {
  customerId: string;
  walletPublicKey: string;
  status: EtherfuseKycStatus;
  approvedAt: string | null;
  currentRejectionReason: string | null;
  updatedAt: string;
};

export async function listKycCases(options?: {
  status?: EtherfuseKycStatus;
  limit?: number;
}): Promise<KycCaseListItem[]> {
  const limit = options?.limit ?? 100;
  const rows = await listStoredKycRows(limit);
  let filtered = rows;
  if (options?.status) {
    filtered = rows.filter((r) => r.status === options.status);
  }
  filtered.sort((a, b) => {
    const ta = new Date(a.updatedAt).getTime();
    const tb = new Date(b.updatedAt).getTime();
    return tb - ta;
  });
  return filtered;
}

async function insertAuditLog(params: {
  actor: string;
  action: KycReviewAction;
  targetCustomerId: string;
  targetWalletPublicKey: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
}): Promise<void> {
  await query(
    `insert into kyc_review_audit_log
       (actor, action, target_customer_id, target_wallet_public_key, from_status, to_status, note)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.actor,
      params.action,
      params.targetCustomerId,
      params.targetWalletPublicKey,
      params.fromStatus,
      params.toStatus,
      params.note,
    ],
  );
}

export async function approveKycCase(params: {
  customerId: string;
  walletPublicKey: string;
  actor: string;
  note?: string | null;
}): Promise<{ ok: true; fromStatus: string | null } | { ok: false; reason: string }> {
  const snapshot = await getStoredKycSnapshot(params.customerId, params.walletPublicKey);
  const fromStatus = snapshot?.status ?? null;

  if (fromStatus === "approved" || fromStatus === "approved_chain_deploying") {
    return { ok: false, reason: "KYC already approved." };
  }

  const { updated } = await upsertStoredKycSnapshot({
    customerId: params.customerId,
    walletPublicKey: params.walletPublicKey,
    status: "approved",
    approvedAt: new Date().toISOString(),
    currentRejectionReason: null,
  });

  if (!updated && snapshot) {
    return { ok: false, reason: "No state change applied." };
  }

  try {
    await insertAuditLog({
      actor: params.actor,
      action: "approve",
      targetCustomerId: params.customerId,
      targetWalletPublicKey: params.walletPublicKey,
      fromStatus,
      toStatus: "approved",
      note: params.note ?? null,
    });
  } catch (e) {
    logger.error(
      { customerId: params.customerId, error: e instanceof Error ? e.message : String(e) },
      "Failed to write KYC audit log for approve",
    );
  }

  logger.info(
    { customerId: params.customerId, actor: params.actor, fromStatus, toStatus: "approved" },
    "KYC case approved by admin",
  );

  return { ok: true, fromStatus };
}

export async function rejectKycCase(params: {
  customerId: string;
  walletPublicKey: string;
  actor: string;
  rejectionReason: string;
  note?: string | null;
}): Promise<{ ok: true; fromStatus: string | null } | { ok: false; reason: string }> {
  const snapshot = await getStoredKycSnapshot(params.customerId, params.walletPublicKey);
  const fromStatus = snapshot?.status ?? null;

  if (fromStatus === "rejected") {
    return { ok: false, reason: "KYC already rejected." };
  }

  const { updated } = await upsertStoredKycSnapshot({
    customerId: params.customerId,
    walletPublicKey: params.walletPublicKey,
    status: "rejected",
    approvedAt: null,
    currentRejectionReason: params.rejectionReason,
  });

  if (!updated && snapshot) {
    return { ok: false, reason: "No state change applied." };
  }

  try {
    await insertAuditLog({
      actor: params.actor,
      action: "reject",
      targetCustomerId: params.customerId,
      targetWalletPublicKey: params.walletPublicKey,
      fromStatus,
      toStatus: "rejected",
      note: params.note ?? null,
    });
  } catch (e) {
    logger.error(
      { customerId: params.customerId, error: e instanceof Error ? e.message : String(e) },
      "Failed to write KYC audit log for reject",
    );
  }

  logger.info(
    { customerId: params.customerId, actor: params.actor, fromStatus, toStatus: "rejected" },
    "KYC case rejected by admin",
  );

  return { ok: true, fromStatus };
}

export async function listKycAuditLog(options?: {
  customerId?: string;
  limit?: number;
}): Promise<KycReviewAuditEntry[]> {
  const limit = Math.min(options?.limit ?? 50, 200);
  const params: unknown[] = [];
  const clauses: string[] = [];

  if (options?.customerId) {
    params.push(options.customerId);
    clauses.push(`target_customer_id = $${params.length}`);
  }

  params.push(limit);
  const whereSql = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";

  const result = await query<{
    id: string;
    actor: string;
    action: string;
    target_customer_id: string;
    target_wallet_public_key: string;
    from_status: string | null;
    to_status: string;
    note: string | null;
    created_at: Date;
  }>(
    `select id, actor, action, target_customer_id, target_wallet_public_key,
            from_status, to_status, note, created_at
     from kyc_review_audit_log
     ${whereSql}
     order by created_at desc
     limit $${params.length}`,
    params,
  );

  return result.rows.map((row) => ({
    id: row.id,
    actor: row.actor,
    action: row.action as KycReviewAction,
    target_customer_id: row.target_customer_id,
    target_wallet_public_key: row.target_wallet_public_key,
    from_status: row.from_status,
    to_status: row.to_status,
    note: row.note,
    created_at: row.created_at.toISOString(),
  }));
}
