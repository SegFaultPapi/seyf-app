import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, query } from "@/lib/seyf/db/client";
import { ensureUserExists } from "../repository";
import { initiateWithdrawal, getWithdrawalById } from "@/lib/seyf/withdrawal-service";

const databaseUrl = process.env.DATABASE_URL?.trim();
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("withdrawal service (integration)", () => {
  const userId = randomUUID();

  beforeAll(async () => {
    await ensureUserExists(userId);
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    await query("delete from users where id = $1", [userId]);
    await closePool();
  });

  it("fails to initiate a withdrawal if no balance row exists", async () => {
    const clabe = "123456789012345678";
    const result = await initiateWithdrawal({
      userId,
      amountMxn: 100,
      clabe,
      alias: "Mi cuenta",
      actor: "test",
    });

    expect(result.ok).toBe(false);
    expect(result.withdrawal).toBeNull();
  });

  it("fails to initiate a withdrawal if balance is insufficient", async () => {
    // Insert a balance row of 50 MXN
    await query(
      `insert into user_balances (user_id, available_balance_mxn)
       values ($1, 50)
       on conflict (user_id) do update set available_balance_mxn = 50`,
      [userId],
    );

    const clabe = "123456789012345678";
    const result = await initiateWithdrawal({
      userId,
      amountMxn: 100,
      clabe,
      alias: "Mi cuenta",
      actor: "test",
    });

    expect(result.ok).toBe(false);
    expect(result.withdrawal).toBeNull();

    // Verify balance was not deducted
    const balanceRes = await query<{ available_balance_mxn: string }>(
      "select available_balance_mxn::text as available_balance_mxn from user_balances where user_id = $1",
      [userId],
    );
    expect(Number(balanceRes.rows[0]?.available_balance_mxn)).toBe(50);
  });

  it("succeeds to initiate a withdrawal when balance is sufficient", async () => {
    // Set balance to 150 MXN
    await query(
      `update user_balances set available_balance_mxn = 150, updated_at = now() where user_id = $1`,
      [userId],
    );

    const clabe = "123456789012345678";
    const result = await initiateWithdrawal({
      userId,
      amountMxn: 100,
      clabe,
      alias: "Mi cuenta",
      actor: "test",
    });

    expect(result.ok).toBe(true);
    expect(result.withdrawal).not.toBeNull();
    const w = result.withdrawal!;
    expect(w.user_id).toBe(userId);
    expect(w.status).toBe("pending");
    expect(Number(w.amount_mxn)).toBe(100);
    expect(w.metadata.clabe).toBe(clabe);
    expect(w.metadata.alias).toBe("Mi cuenta");

    // Verify balance was deducted
    const balanceRes = await query<{ available_balance_mxn: string }>(
      "select available_balance_mxn::text as available_balance_mxn from user_balances where user_id = $1",
      [userId],
    );
    expect(Number(balanceRes.rows[0]?.available_balance_mxn)).toBe(50);

    // Verify record exists in database
    const dbWithdrawal = await getWithdrawalById(w.id);
    expect(dbWithdrawal).not.toBeNull();
    expect(dbWithdrawal!.status).toBe("pending");
    expect(Number(dbWithdrawal!.amount_mxn)).toBe(100);
  });

  it("throws an error if clabe is invalid", async () => {
    await expect(
      initiateWithdrawal({
        userId,
        amountMxn: 10,
        clabe: "12345", // too short
        actor: "test",
      }),
    ).rejects.toThrow("Invalid CLABE");
  });
});
