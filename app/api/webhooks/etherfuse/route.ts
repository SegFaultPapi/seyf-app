import { NextResponse } from "next/server";
import type { EtherfuseKycStatus } from "@/lib/etherfuse/kyc";
import { getEtherfuseConfig, strictEtherfuseProductionConfig } from "@/lib/etherfuse/config";
import { verifyEtherfuseWebhookSignature } from "@/lib/etherfuse/webhook-verify";
import { pickRampOrderTransactionDetails } from "@/lib/etherfuse/orders-api";
import { enqueueAutoDeployForDeposit } from "@/lib/seyf/spei-deposit-auto-deploy";
import { upsertStoredKycSnapshot } from "@/lib/seyf/kyc-state-store";
import { logger } from "@/lib/observability/logger";
import { withLogging } from "@/lib/observability/with-logging";

export const runtime = "nodejs";

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function isKycStatus(value: string): value is EtherfuseKycStatus {
  return (
    value === "not_started" ||
    value === "proposed" ||
    value === "approved" ||
    value === "approved_chain_deploying" ||
    value === "rejected"
  );
}

function extractKycUpdateEvent(payload: unknown): {
  eventType: string | null;
  eventId: string | null;
  eventTimestamp: string | null;
  customerId: string | null;
  walletPublicKey: string | null;
  status: EtherfuseKycStatus | null;
  approvedAt: string | null;
  currentRejectionReason: string | null;
} {
  const root = asObject(payload) ?? {};
  const data = asObject(root.data) ?? asObject(root.payload) ?? root;
  const eventType = pickString(root, ["event", "eventType", "type", "name"]);
  const eventId = pickString(root, ["id", "eventId", "webhookId"]);
  const eventTimestamp = pickString(root, ["createdAt", "timestamp", "occurredAt"]);
  const customerId = pickString(data, ["customerId", "customer_id"]);
  const walletPublicKey = pickString(data, ["walletPublicKey", "wallet_public_key", "pubkey", "publicKey"]);
  const statusRaw = pickString(data, ["status"]);
  const approvedAt = pickString(data, ["approvedAt", "approved_at"]);
  const currentRejectionReason = pickString(data, ["currentRejectionReason", "current_rejection_reason"]);
  return {
    eventType,
    eventId,
    eventTimestamp,
    customerId,
    walletPublicKey,
    status: statusRaw && isKycStatus(statusRaw) ? statusRaw : null,
    approvedAt,
    currentRejectionReason,
  };
}

/**
 * POST /api/webhooks/etherfuse
 * Configura la URL en devnet (Ramp → Webhooks) apuntando a tu dominio + esta ruta.
 * Secreto en ETHERFUSE_WEBHOOK_SECRET (base64, el que devuelve create webhook una sola vez).
 *
 * @see https://docs.etherfuse.com/guides/verifying-webhooks
 */
async function handlePost(req: Request, _context: { params: Promise<Record<string, string | string[]>> }) {
  const raw = await req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return NextResponse.json({ error: "JSON inv\u00e1lido" }, { status: 400 });
  }

  const { webhookSecret: secret } = getEtherfuseConfig();
  const sig = req.headers.get("x-signature");

  if (secret) {
    if (!verifyEtherfuseWebhookSignature(payload, sig, secret)) {
      return NextResponse.json({ error: "Firma inv\u00e1lida" }, { status: 401 });
    }
  } else if (strictEtherfuseProductionConfig()) {
    return NextResponse.json(
      { error: "ETHERFUSE_WEBHOOK_SECRET no configurado" },
      { status: 503 },
    );
  }

  logger.debug(
    { route: "webhooks/etherfuse" },
    typeof payload === "object" && payload !== null
      ? JSON.stringify(payload).slice(0, 2500)
      : String(payload),
  );

  const kyc = extractKycUpdateEvent(payload);
  const isKycUpdated =
    kyc.eventType === "kyc_updated" ||
    (kyc.eventType && kyc.eventType.toLowerCase().includes("kyc"));
  if (isKycUpdated && kyc.customerId && kyc.walletPublicKey && kyc.status) {
    const result = await upsertStoredKycSnapshot({
      customerId: kyc.customerId,
      walletPublicKey: kyc.walletPublicKey,
      status: kyc.status,
      approvedAt: kyc.approvedAt,
      currentRejectionReason: kyc.currentRejectionReason,
      eventId: kyc.eventId,
      eventTimestamp: kyc.eventTimestamp,
    });
    logger.info(
      { route: "webhooks/etherfuse/kyc", customerId: kyc.customerId, status: kyc.status, updated: result.updated },
      `KYC update processed: ${kyc.status}`,
    );
  }

  try {
    const details = pickRampOrderTransactionDetails(payload);
    const isOnramp = (details.orderType ?? "").toLowerCase() === "onramp";
    const isConfirmed = (details.status ?? "").toLowerCase() === "confirmed";

    if (isOnramp && isConfirmed && details.orderId) {
      void enqueueAutoDeployForDeposit({
        depositId: details.orderId,
        amountMxn:
          details.amountInFiat && Number.isFinite(Number(details.amountInFiat))
            ? Number(details.amountInFiat)
            : null,
      }).catch((error) => {
        logger.error(
          { route: "webhooks/etherfuse/deploy", error: error instanceof Error ? error.message : String(error) },
          "enqueueAutoDeployForDeposit failed",
        );
      });
    }
  } catch (error) {
    logger.error(
      { route: "webhooks/etherfuse/handler", error: error instanceof Error ? error.message : String(error) },
      "Webhook handler error",
    );
  }

  return NextResponse.json({ ok: true });
}

export const POST = withLogging(handlePost, { routeName: "webhooks/etherfuse", provider: "etherfuse" });
