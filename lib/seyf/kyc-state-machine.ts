import { query, withActor } from "./db/client";
import { createNotificationService } from "./notifications/notify";
import { AppError } from "./api-error";

export type KycStatus =
  | "NOT_SUBMITTED"
  | "KYC_UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED";

export const DEPOSIT_LIMIT_APPROVED = 20000;

/**
 * Single source of truth for deposit limits based on KYC status.
 */
export function getDepositLimit(status: KycStatus): number {
  switch (status) {
    case "APPROVED":
      return DEPOSIT_LIMIT_APPROVED;
    case "NOT_SUBMITTED":
    case "KYC_UNDER_REVIEW":
    case "REJECTED":
    default:
      return 0;
  }
}

/**
 * Validates if a transition between KYC statuses is allowed.
 */
export function validateTransition(
  currentStatus: KycStatus,
  nextStatus: KycStatus
): void {
  const allowedTransitions: Record<KycStatus, KycStatus[]> = {
    NOT_SUBMITTED: ["KYC_UNDER_REVIEW"],
    KYC_UNDER_REVIEW: ["APPROVED", "REJECTED"],
    APPROVED: [], // Final state for this machine, though could potentially be revoked in future
    REJECTED: ["KYC_UNDER_REVIEW"],
  };

  if (!allowedTransitions[currentStatus].includes(nextStatus)) {
    throw new AppError("validation_error", {
      statusCode: 400,
      message: `Transición de estado KYC inválida: ${currentStatus} -> ${nextStatus}`,
    });
  }
}

/**
 * Approves a user's KYC submission.
 */
export async function approveKyc(userId: string, actor: string = "admin") {
  return await withActor(actor, async () => {
    // 1. Get current user status
    const userRes = await query<{ kyc_status: KycStatus }>(
      "SELECT kyc_status FROM users WHERE id = $1",
      [userId]
    );

    if (userRes.rowCount === 0) {
      throw new AppError("not_found", {
        statusCode: 404,
        message: "Usuario no encontrado",
      });
    }

    const currentStatus = userRes.rows[0].kyc_status;

    // 2. Validate transition
    validateTransition(currentStatus, "APPROVED");

    const nextStatus: KycStatus = "APPROVED";
    const depositLimit = getDepositLimit(nextStatus);

    // 3. Update user status and deposit limit
    const updateRes = await query(
      `UPDATE users 
       SET kyc_status = $1, 
           deposit_limit_mxn = $2, 
           kyc_rejection_reason = NULL,
           updated_at = NOW() 
       WHERE id = $3 
       RETURNING *`,
      [nextStatus, depositLimit, userId]
    );

    // 4. Record audit history
    await query(
      `INSERT INTO kyc_status_history (user_id, old_status, new_status, actor) 
       VALUES ($1, $2, $3, $4)`,
      [userId, currentStatus, nextStatus, actor]
    );

    // 5. Trigger notification
    const notificationService = createNotificationService();
    await notificationService.notifyUser(userId, "kyc_approved", {
      amountMxn: depositLimit,
    });

    return updateRes.rows[0];
  });
}

/**
 * Rejects a user's KYC submission.
 */
export async function rejectKyc(
  userId: string,
  rejectionReason: string,
  actor: string = "admin"
) {
  return await withActor(actor, async () => {
    // 1. Get current user status
    const userRes = await query<{ kyc_status: KycStatus }>(
      "SELECT kyc_status FROM users WHERE id = $1",
      [userId]
    );

    if (userRes.rowCount === 0) {
      throw new AppError("not_found", {
        statusCode: 404,
        message: "Usuario no encontrado",
      });
    }

    const currentStatus = userRes.rows[0].kyc_status;

    // 2. Validate transition
    validateTransition(currentStatus, "REJECTED");

    const nextStatus: KycStatus = "REJECTED";
    const depositLimit = getDepositLimit(nextStatus);

    // 3. Update user status, deposit limit, and rejection reason
    const updateRes = await query(
      `UPDATE users 
       SET kyc_status = $1, 
           deposit_limit_mxn = $2, 
           kyc_rejection_reason = $3,
           updated_at = NOW() 
       WHERE id = $4 
       RETURNING *`,
      [nextStatus, depositLimit, rejectionReason, userId]
    );

    // 4. Record audit history
    await query(
      `INSERT INTO kyc_status_history (user_id, old_status, new_status, actor, reason) 
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, currentStatus, nextStatus, actor, rejectionReason]
    );

    // 5. Trigger notification
    const notificationService = createNotificationService();
    await notificationService.notifyUser(userId, "kyc_rejected", {
      reason: rejectionReason,
    });

    return updateRes.rows[0];
  });
}
