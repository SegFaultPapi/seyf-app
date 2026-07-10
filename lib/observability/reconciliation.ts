import { logger } from "./logger";
import { getActiveCycle } from "@/lib/seyf/cycle-store";
import { query } from "@/lib/seyf/db/client";
import { fetchOrderDetails, pickRampOrderTransactionDetails } from "@/lib/etherfuse/orders-api";
import {
  processCompletedWithdrawal,
  processFailedWithdrawal,
  processProcessingWithdrawal,
  type WithdrawalRow,
} from "@/lib/seyf/withdrawal-service";
import { notifyUser } from "@/lib/seyf/notifications/notify";
import { sendAlert, AlertSeverity } from "@/lib/observability/alerts";

export type ReconciliationResult = {
  ok: boolean;
  mismatches: Array<{
    userId: string;
    walletAddress: string;
    expectedPrincipalMxn: number;
    actualBalanceMxn: number;
    diffMxn: number;
  }>;
  checkedAt: string;
  totalUsers: number;
  totalMismatches: number;
  withdrawalsReconciled?: number;
};

export type PollarBalance = {
  publicKey: string;
  balanceMxn: number;
};

async function fetchPollarBalance(publicKey: string): Promise<PollarBalance | null> {
  try {
    const network = process.env.NEXT_PUBLIC_POLLAR_STELLAR_NETWORK === "mainnet" ? "mainnet" : "testnet";
    const horizonUrl = network === "mainnet"
      ? "https://horizon.stellar.org"
      : "https://horizon-testnet.stellar.org";

    const res = await fetch(
      `${horizonUrl}/accounts/${encodeURIComponent(publicKey)}`,
      { headers: { Accept: "application/json" } },
    );

    if (res.status === 404) {
      return { publicKey, balanceMxn: 0 };
    }
    if (!res.ok) {
      const text = await res.text();
      logger.warn({ provider: "stellar", publicKey }, `Horizon ${res.status} for ${publicKey}: ${text.slice(0, 120)}`);
      return null;
    }

    const json = (await res.json()) as {
      balances?: Array<{ asset_type: string; asset_code?: string; balance: string }>;
    };
    const cetesBalance = (json.balances ?? []).find(
      (b) => b.asset_type !== "native" && (b.asset_code ?? "").toUpperCase() === "CETES",
    );
    const balance = cetesBalance ? Number.parseFloat(cetesBalance.balance) : 0;

    return { publicKey, balanceMxn: Number.isFinite(balance) ? balance : 0 };
  } catch (e) {
    logger.error(
      { provider: "stellar", publicKey, error: e instanceof Error ? e.message : String(e) },
      `Failed to fetch Pollar balance for ${publicKey}`,
    );
    return null;
  }
}

export async function reconcileWithdrawals(): Promise<number> {
  const activeWithdrawals = await query<WithdrawalRow>(
    `select id, user_id, type, status, amount_mxn::text as amount_mxn, metadata, created_at, updated_at
     from withdrawals
     where status in ('pending', 'processing')`
  );

  let count = 0;
  for (const w of activeWithdrawals.rows) {
    const withdrawalId = w.id;
    const createdAt = new Date(w.created_at);
    const ageMs = Date.now() - createdAt.getTime();

    try {
      // Query Etherfuse for order details using withdrawal ID as orderId
      const order = await fetchOrderDetails(withdrawalId);
      const details = pickRampOrderTransactionDetails(order);
      const status = (details.status ?? "").toLowerCase();

      if (status === "completed" || status === "success" || status === "confirmed") {
        const result = await processCompletedWithdrawal(withdrawalId, "cron:reconciliation");
        if (result.ok && result.withdrawal?.status === "completed") {
          void notifyUser(w.user_id, "withdrawal_completed", {
            withdrawalId,
            amountMxn: Number(w.amount_mxn),
            destinationLabel: details.bankAccountId ?? undefined,
          }).catch((err) => {
            logger.error({ withdrawalId, error: String(err) }, "Failed to notify withdrawal_completed");
          });
          count++;
        }
      } else if (status === "failed" || status === "canceled" || status === "cancelled" || status === "rejected") {
        const result = await processFailedWithdrawal(
          withdrawalId,
          `Order failed in Etherfuse (status: ${details.status})`,
          "cron:reconciliation"
        );
        if (result.ok && result.withdrawal?.status === "failed") {
          void notifyUser(w.user_id, "withdrawal_failed", {
            withdrawalId,
            amountMxn: Number(w.amount_mxn),
            reason: `Order failed in Etherfuse (status: ${details.status})`,
          }).catch((err) => {
            logger.error({ withdrawalId, error: String(err) }, "Failed to notify withdrawal_failed");
          });

          void sendAlert({
            alert: "withdrawal_failed",
            severity: AlertSeverity.CRITICAL,
            message: `Retiro ${withdrawalId} falló en conciliación: Estado ${details.status}. Balance restaurado.`,
            details: { withdrawalId, userId: w.user_id, amountMxn: Number(w.amount_mxn), reason: details.status },
            timestamp: new Date().toISOString(),
          });
          count++;
        }
      } else if (status === "processing" || status === "funded") {
        if (w.status === "pending") {
          await processProcessingWithdrawal(withdrawalId, "cron:reconciliation");
          count++;
        }

        const ageHours = ageMs / 3600000;
        if (ageHours > 4) {
          void sendAlert({
            alert: "withdrawal_stuck_in_provider",
            severity: AlertSeverity.CRITICAL,
            message: `Retiro ${withdrawalId} estancado en proveedor > 4h (status: ${details.status})`,
            details: { withdrawalId, userId: w.user_id, amountMxn: Number(w.amount_mxn), ageHours, providerStatus: details.status },
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch (e) {
      // If order is not found (404) in Etherfuse, handle the missing order case
      const errMsg = e instanceof Error ? e.message : String(e);
      const is404 = errMsg.includes("404") || errMsg.includes("Not Found");

      if (is404) {
        const ageMinutes = ageMs / 60000;
        if (ageMinutes > 60) {
          const result = await processFailedWithdrawal(
            withdrawalId,
            "No se encontró la orden en el proveedor después de 1 hora.",
            "cron:reconciliation"
          );
          if (result.ok) {
            void sendAlert({
              alert: "withdrawal_missing_in_provider",
              severity: AlertSeverity.CRITICAL,
              message: `Retiro ${withdrawalId} no existe en Etherfuse después de 1 hora. Balance restaurado.`,
              details: { withdrawalId, userId: w.user_id, amountMxn: Number(w.amount_mxn), ageMinutes },
              timestamp: new Date().toISOString(),
            });
            count++;
          }
        }
      } else {
        logger.error(
          { withdrawalId, error: errMsg },
          "Failed to reconcile withdrawal with Etherfuse"
        );
      }
    }
  }

  return count;
}

export async function runReconciliation(): Promise<ReconciliationResult> {
  const start = Date.now();
  const mismatches: ReconciliationResult["mismatches"] = [];

  // Run withdrawals reconciliation first
  let withdrawalsReconciled = 0;
  try {
    withdrawalsReconciled = await reconcileWithdrawals();
  } catch (e) {
    logger.error(
      { error: e instanceof Error ? e.message : String(e) },
      "Withdrawals reconciliation failed"
    );
  }

  const cycleStore = globalThis as unknown as {
    __seyfCycleStore?: { activeByUserId: Map<string, { userId: string; principalMxn: number; confirmedOnchainTx: string | null }> };
  };

  const cycles = cycleStore.__seyfCycleStore?.activeByUserId;
  if (!cycles || cycles.size === 0) {
    logger.info({ route: "cron/reconciliation" }, "No active cycles to reconcile");
    return {
      ok: true,
      mismatches: [],
      checkedAt: new Date().toISOString(),
      totalUsers: 0,
      totalMismatches: 0,
      withdrawalsReconciled,
    };
  }

  for (const [userId, cycle] of cycles) {
    if (!cycle.confirmedOnchainTx) continue;

    const balance = await fetchPollarBalance(userId);

    if (balance === null) {
      logger.warn(
        { userId, route: "cron/reconciliation" },
        `Could not fetch balance for user ${userId}, skipping`,
      );
      continue;
    }

    const expected = cycle.principalMxn;
    const actual = balance.balanceMxn;
    const diff = Math.abs(expected - actual);

    if (diff > 0.01) {
      mismatches.push({
        userId,
        walletAddress: balance.publicKey,
        expectedPrincipalMxn: expected,
        actualBalanceMxn: actual,
        diffMxn: diff,
      });
    }
  }

  const result: ReconciliationResult = {
    ok: mismatches.length === 0,
    mismatches,
    checkedAt: new Date().toISOString(),
    totalUsers: cycles.size,
    totalMismatches: mismatches.length,
    withdrawalsReconciled,
  };

  if (mismatches.length > 0) {
    logger.error(
      {
        route: "cron/reconciliation",
        totalMismatches: mismatches.length,
        totalUsers: cycles.size,
        duration_ms: Date.now() - start,
        withdrawalsReconciled,
      },
      `Reconciliation: ${mismatches.length} mismatches found out of ${cycles.size} cycles`,
    );
  } else {
    logger.info(
      {
        route: "cron/reconciliation",
        totalUsers: cycles.size,
        duration_ms: Date.now() - start,
        withdrawalsReconciled,
      },
      `Reconciliation: all ${cycles.size} cycles match onchain balances`,
    );
  }

  return result;
}
