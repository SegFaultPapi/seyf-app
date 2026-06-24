import { logger } from "./logger";
import { getActiveCycle } from "@/lib/seyf/cycle-store";

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

export async function runReconciliation(): Promise<ReconciliationResult> {
  const start = Date.now();
  const mismatches: ReconciliationResult["mismatches"] = [];

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
  };

  if (mismatches.length > 0) {
    logger.error(
      {
        route: "cron/reconciliation",
        totalMismatches: mismatches.length,
        totalUsers: cycles.size,
        duration_ms: Date.now() - start,
      },
      `Reconciliation: ${mismatches.length} mismatches found out of ${cycles.size} cycles`,
    );
  } else {
    logger.info(
      {
        route: "cron/reconciliation",
        totalUsers: cycles.size,
        duration_ms: Date.now() - start,
      },
      `Reconciliation: all ${cycles.size} cycles match onchain balances`,
    );
  }

  return result;
}
