import { NextResponse } from "next/server";
import { z } from "zod";
import { extractOrderIdFromCreateOrderResponse } from "@/lib/etherfuse/order-create-response";
import { resolveMvpPartnerCryptoWalletId } from "@/lib/etherfuse/partner-accounts";
import { createMxOfframpOrder } from "@/lib/etherfuse/ramp-api";
import { AppError, toErrorResponse } from "@/lib/seyf/api-error";
import { assertEtherfuseKycApproved } from "@/lib/seyf/etherfuse-kyc-guard";
import { getEtherfuseRampContext } from "@/lib/seyf/etherfuse-ramp-context";
import { guardEtherfuseRampRoutes } from "@/lib/seyf/etherfuse-ramp-guard";
import { assertWalletActiveForUser } from "@/lib/seyf/wallet-provisioning";
import { initiateWithdrawal, processProcessingWithdrawal, processFailedWithdrawal } from "@/lib/seyf/withdrawal-service";
import { getOrCreatePocUserId } from "@/lib/seyf/poc-user-cookie";
import { query } from "@/lib/seyf/db/client";

const bodySchema = z.object({
  quoteId: z.string().uuid(),
  amountMxn: z.number().positive().optional(),
  clabe: z.string().optional(),
  /** Stellar: flujo anchor (pago + memo) en lugar de burn prearmado. */
  useAnchor: z.boolean().optional(),
});

/**
 * POST /api/seyf/etherfuse/order/offramp
 * Cuerpo: { quoteId, amountMxn?, clabe?, useAnchor?: boolean } — quote de offramp (~2 min de validez).
 */
export async function POST(req: Request) {
  const denied = guardEtherfuseRampRoutes();
  if (denied) return denied;

  const ctx = await getEtherfuseRampContext();
  if (!ctx) {
    return NextResponse.json(
      {
        error:
          "Sin contexto rampa: cookie /identidad o (solo dev) ETHERFUSE_MVP_* en .env.local.",
      },
      { status: 401 },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    await assertEtherfuseKycApproved({
      customerId: ctx.customerId,
      publicKey: ctx.publicKey,
    });
    await assertWalletActiveForUser(ctx.customerId);
    let cryptoWalletId: string | undefined;
    try {
      cryptoWalletId = await resolveMvpPartnerCryptoWalletId(ctx.publicKey);
    } catch {
      cryptoWalletId = undefined;
    }

    const { userId } = await getOrCreatePocUserId();
    const amountMxn = parsed.data.amountMxn ?? 10;
    const clabe = parsed.data.clabe ?? "646180615200001646";

    // 1. Create the internal withdrawal record and deduct balance
    const initResult = await initiateWithdrawal({
      userId,
      amountMxn,
      clabe,
      alias: "Retiro Etherfuse",
      actor: "user",
    });

    if (!initResult.ok || !initResult.withdrawal) {
      return NextResponse.json(
        { error: "Saldo insuficiente para realizar el retiro." },
        { status: 400 },
      );
    }

    const withdrawalId = initResult.withdrawal.id;

    // 2. Create the Etherfuse off-ramp order using the withdrawal ID as the orderId
    let order: unknown;
    try {
      order = await createMxOfframpOrder({
        bankAccountId: ctx.bankAccountId,
        quoteId: parsed.data.quoteId,
        orderId: withdrawalId,
        ...(cryptoWalletId
          ? { cryptoWalletId }
          : { publicKey: ctx.publicKey }),
        ...(parsed.data.useAnchor === true ? { useAnchor: true } : {}),
      });
    } catch (orderError) {
      // Rollback: if order creation fails, fail the withdrawal and restore the user's balance
      const failReason = orderError instanceof Error ? orderError.message : String(orderError);
      await processFailedWithdrawal(withdrawalId, `Error al crear orden en proveedor: ${failReason}`, "system:order-creation-failed");
      throw orderError;
    }

    // 3. Transition the withdrawal to 'processing'
    await processProcessingWithdrawal(withdrawalId, "system:order-creation-success");

    // Update metadata with provider references
    const orderId = extractOrderIdFromCreateOrderResponse(order) || withdrawalId;
    const metadataUpdate = {
      etherfuse_order_id: orderId,
      etherfuse_quote_id: parsed.data.quoteId,
      etherfuse_bank_account_id: ctx.bankAccountId,
      updated_at: new Date().toISOString(),
    };

    await query(
      `update withdrawals
       set metadata = metadata || $2::jsonb
       where id = $1`,
      [withdrawalId, JSON.stringify(metadataUpdate)],
    );

    return NextResponse.json({
      order,
      orderId,
      withdrawalId,
      contextSource: ctx.source,
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("(409)")) {
      return toErrorResponse(
        new AppError("provider_unavailable", { statusCode: 409, retryable: false, message: e.message }),
        "order/offramp",
      );
    }
    return toErrorResponse(e, "order/offramp");
  }
}
