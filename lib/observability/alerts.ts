import { logger } from "./logger";

export enum AlertSeverity {
  INFO = "info",
  WARNING = "warning",
  CRITICAL = "critical",
}

export type AlertPayload = {
  alert: string;
  severity: AlertSeverity;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
};

export async function sendAlert(payload: AlertPayload): Promise<void> {
  logger.error(
    {
      alert: payload.alert,
      severity: payload.severity,
      details: payload.details,
    },
    `[ALERT] ${payload.severity.toUpperCase()}: ${payload.message}`,
  );

  if (process.env.SEYF_ALERT_WEBHOOK_URL) {
    try {
      await fetch(process.env.SEYF_ALERT_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (e) {
      logger.warn(
        { alert: payload.alert },
        `Failed to send alert to webhook: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

export async function checkPendingDeposits(): Promise<void> {
  logger.info({ route: "cron/alerts/deposit-stuck" }, "Checking pending deposits...");

  const pendingStore = globalThis as unknown as {
    __seyfPendingDeposits?: Map<string, { createdAt: string; amountMxn: number; userId: string }>;
  };

  const deposits = pendingStore.__seyfPendingDeposits;
  if (!deposits || deposits.size === 0) return;

  const now = Date.now();
  const thresholdMs = 30 * 60 * 1000;

  for (const [id, deposit] of deposits) {
    const age = now - new Date(deposit.createdAt).getTime();
    if (age > thresholdMs) {
      await sendAlert({
        alert: "deposit_stuck",
        severity: AlertSeverity.CRITICAL,
        message: `Depósito ${id} estancado en pendiente > 30 min`,
        details: {
          depositId: id,
          userId: deposit.userId,
          amountMxn: deposit.amountMxn,
          ageMinutes: Math.floor(age / 60000),
        },
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export async function checkPendingWithdrawals(): Promise<void> {
  logger.info({ route: "cron/alerts/withdrawal-stuck" }, "Checking pending withdrawals...");

  const withdrawalStore = globalThis as unknown as {
    __seyfPendingWithdrawals?: Map<string, { createdAt: string; amountMxn: number; userId: string }>;
  };

  const withdrawals = withdrawalStore.__seyfPendingWithdrawals;
  if (!withdrawals || withdrawals.size === 0) return;

  const now = Date.now();
  const thresholdMs = 4 * 60 * 60 * 1000;

  for (const [id, withdrawal] of withdrawals) {
    const age = now - new Date(withdrawal.createdAt).getTime();
    if (age > thresholdMs) {
      await sendAlert({
        alert: "withdrawal_stuck",
        severity: AlertSeverity.CRITICAL,
        message: `Retiro ${id} estancado en pendiente > 4h`,
        details: {
          withdrawalId: id,
          userId: withdrawal.userId,
          amountMxn: withdrawal.amountMxn,
          ageHours: Math.floor(age / 3600000),
        },
        timestamp: new Date().toISOString(),
      });
    }
  }
}

const txFailureWindow = new Map<string, { count: number; failures: number; windowStart: number }>();

export function recordStellarTxOutcome(userId: string, success: boolean): void {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const key = userId;

  let entry = txFailureWindow.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { count: 0, failures: 0, windowStart: now };
    txFailureWindow.set(key, entry);
  }

  entry.count++;
  if (!success) entry.failures++;
}

export async function checkStellarTxFailureRate(): Promise<void> {
  logger.info({ route: "cron/alerts/stellar-failures" }, "Checking Stellar TX failure rate...");

  const now = Date.now();
  const windowMs = 10 * 60 * 1000;

  for (const [userId, entry] of txFailureWindow) {
    if (now - entry.windowStart > windowMs) {
      txFailureWindow.delete(userId);
      continue;
    }

    if (entry.count < 3) continue;

    const failureRate = entry.failures / entry.count;
    if (failureRate > 0.05) {
      await sendAlert({
        alert: "stellar_tx_failure_rate",
        severity: AlertSeverity.WARNING,
        message: `Tasa de fallo Stellar > 5% en últimos 10 min`,
        details: {
          userId,
          failures: entry.failures,
          total: entry.count,
          failureRate: `${(failureRate * 100).toFixed(1)}%`,
          windowMinutes: 10,
        },
        timestamp: new Date().toISOString(),
      });

      txFailureWindow.delete(userId);
    }
  }
}

export function recordDeployFailed(userId: string, details?: Record<string, unknown>): void {
  logger.error(
    {
      route: "observability",
      error_code: "deploy_failed",
      userId,
      details,
    },
    `Deploy failed for user ${userId}`,
  );

  sendAlert({
    alert: "deploy_failed",
    severity: AlertSeverity.CRITICAL,
    message: `Deploy falló para usuario ${userId}`,
    details: { userId, ...details },
    timestamp: new Date().toISOString(),
  });
}
