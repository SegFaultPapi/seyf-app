import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, query } from "@/lib/seyf/db/client";
import { ensureUserExists } from "../transactions/repository";
import { initiateWithdrawal, getWithdrawalById } from "@/lib/seyf/withdrawal-service";
import { reconcileWithdrawals } from "@/lib/observability/reconciliation";
import { fetchOrderDetails } from "@/lib/etherfuse/orders-api";

// Mock the Etherfuse Orders API and Notifications/Alerts
vi.mock("@/lib/etherfuse/orders-api", () => ({
  fetchOrderDetails: vi.fn(),
  pickRampOrderTransactionDetails: (order: any) => {
    if (!order) return { orderId: null, status: null, orderType: null };
    return {
      orderId: order.orderId ?? null,
      customerId: order.customerId ?? null,
      status: order.status ?? null,
      orderType: order.orderType ?? "offramp",
      bankAccountId: order.bankAccountId ?? null,
      amountInFiat: order.amountInFiat ?? null,
    };
  },
}));

vi.mock("@/lib/seyf/notifications/notify", () => ({
  notifyUser: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/observability/alerts", () => ({
  sendAlert: vi.fn().mockResolvedValue({}),
  AlertSeverity: {
    INFO: "info",
    WARNING: "warning",
    CRITICAL: "critical",
  },
}));

const databaseUrl = process.env.DATABASE_URL?.trim();
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("off-ramp reconciliation", () => {
  const userId = randomUUID();

  beforeAll(async () => {
    await ensureUserExists(userId);
  });

  beforeEach(async () => {
    if (!databaseUrl) return;
    await query("delete from processed_webhook_events");
    await query("delete from withdrawals");
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    await query("delete from users where id = $1", [userId]);
    await closePool();
  });

  it("reconciles a pending withdrawal to processing when provider is processing", async () => {
    // Set balance
    await query(
      `insert into user_balances (user_id, available_balance_mxn)
       values ($1, 100)
       on conflict (user_id) do update set available_balance_mxn = 100`,
      [userId],
    );

    // Initiate withdrawal
    const initRes = await initiateWithdrawal({
      userId,
      amountMxn: 40,
      clabe: "646180615200001646",
      actor: "test",
    });
    expect(initRes.ok).toBe(true);
    const withdrawalId = initRes.withdrawal!.id;

    // Mock provider status: processing
    vi.mocked(fetchOrderDetails).mockResolvedValueOnce({
      orderId: withdrawalId,
      status: "processing",
      orderType: "offramp",
      amountInFiat: "40.00",
    });

    const reconciledCount = await reconcileWithdrawals();
    expect(reconciledCount).toBe(1);

    const w = await getWithdrawalById(withdrawalId);
    expect(w!.status).toBe("processing");
  });

  it("reconciles a processing withdrawal to completed when provider is completed", async () => {
    // Set balance
    await query(
      `insert into user_balances (user_id, available_balance_mxn)
       values ($1, 100)
       on conflict (user_id) do update set available_balance_mxn = 100`,
      [userId],
    );

    // Initiate withdrawal
    const initRes = await initiateWithdrawal({
      userId,
      amountMxn: 30,
      clabe: "646180615200001646",
      actor: "test",
    });
    const withdrawalId = initRes.withdrawal!.id;

    // Move to processing first
    await query(
      "update withdrawals set status = 'processing' where id = $1",
      [withdrawalId],
    );

    // Mock provider status: completed
    vi.mocked(fetchOrderDetails).mockResolvedValueOnce({
      orderId: withdrawalId,
      status: "completed",
      orderType: "offramp",
      amountInFiat: "30.00",
    });

    const reconciledCount = await reconcileWithdrawals();
    expect(reconciledCount).toBe(1);

    const w = await getWithdrawalById(withdrawalId);
    expect(w!.status).toBe("completed");

    // Balance should remain deducted (100 - 30 = 70)
    const balanceRes = await query<{ available_balance_mxn: string }>(
      "select available_balance_mxn::text as available_balance_mxn from user_balances where user_id = $1",
      [userId],
    );
    expect(Number(balanceRes.rows[0]?.available_balance_mxn)).toBe(70);
  });

  it("reconciles a processing withdrawal to failed and restores balance when provider is failed", async () => {
    // Set balance to 70
    await query(
      `update user_balances set available_balance_mxn = 70 where user_id = $1`,
      [userId],
    );

    // Initiate withdrawal
    const initRes = await initiateWithdrawal({
      userId,
      amountMxn: 20,
      clabe: "646180615200001646",
      actor: "test",
    });
    const withdrawalId = initRes.withdrawal!.id;

    // Mock provider status: failed
    vi.mocked(fetchOrderDetails).mockResolvedValueOnce({
      orderId: withdrawalId,
      status: "failed",
      orderType: "offramp",
      amountInFiat: "20.00",
    });

    const reconciledCount = await reconcileWithdrawals();
    expect(reconciledCount).toBe(1);

    const w = await getWithdrawalById(withdrawalId);
    expect(w!.status).toBe("failed");

    // Balance should be restored (70 - 20 + 20 = 70)
    const balanceRes = await query<{ available_balance_mxn: string }>(
      "select available_balance_mxn::text as available_balance_mxn from user_balances where user_id = $1",
      [userId],
    );
    expect(Number(balanceRes.rows[0]?.available_balance_mxn)).toBe(70);
  });

  it("reconciles a pending withdrawal to failed (restoring balance) if missing in provider (404) for > 1 hour", async () => {
    // Set balance to 70
    await query(
      `update user_balances set available_balance_mxn = 70 where user_id = $1`,
      [userId],
    );

    // Initiate withdrawal
    const initRes = await initiateWithdrawal({
      userId,
      amountMxn: 10,
      clabe: "646180615200001646",
      actor: "test",
    });
    const withdrawalId = initRes.withdrawal!.id;

    // Manually backdate the created_at to 2 hours ago
    await query(
      "update withdrawals set created_at = now() - interval '2 hours' where id = $1",
      [withdrawalId],
    );

    // Mock provider status: 404 Not Found
    vi.mocked(fetchOrderDetails).mockRejectedValueOnce(
      new Error("Etherfuse GET /ramp/order (404): Not Found")
    );

    const reconciledCount = await reconcileWithdrawals();
    expect(reconciledCount).toBe(1);

    const w = await getWithdrawalById(withdrawalId);
    expect(w!.status).toBe("failed");
    expect(w!.metadata.failure_reason).toContain("No se encontró la orden en el proveedor");

    // Balance should be restored (70 - 10 + 10 = 70)
    const balanceRes = await query<{ available_balance_mxn: string }>(
      "select available_balance_mxn::text as available_balance_mxn from user_balances where user_id = $1",
      [userId],
    );
    expect(Number(balanceRes.rows[0]?.available_balance_mxn)).toBe(70);
  });
});
