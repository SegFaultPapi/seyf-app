import { NextResponse } from "next/server";
import type { EtherfuseKycStatus } from "@/lib/etherfuse/kyc";
import { getEtherfuseConfig, strictEtherfuseProductionConfig } from "@/lib/etherfuse/config";
import { verifyEtherfuseWebhookWithSecrets } from "@/lib/etherfuse/webhook-verify";
import { pickRampOrderTransactionDetails } from "@/lib/etherfuse/orders-api";
import { enqueueAutoDeployForDeposit } from "@/lib/seyf/spei-deposit-auto-deploy";
import { upsertStoredKycSnapshot } from "@/lib/seyf/kyc-state-store";
import { appendKycAuditEvent } from "@/lib/seyf/kyc-audit";
import { logger } from "@/lib/observability/logger";
import { withLogging } from "@/lib/observability/with-logging";
import { reserveWebhookEvent } from "@/lib/webhooks/replay-protection";
import {
  readWebhookBody,
  webhookMalformed,
  webhookReplayStoreUnavailable,
  webhookVerificationFailed,
  webhookSecretMissing,
  webhookRateLimit,
} from "@/lib/webhooks/webhook-guard";
import { getWithdrawalById, processProcessingWithdrawal } from "@/lib/seyf/withdrawal-service";
import { enqueueSpeiWithdrawEvent } from "@/lib/seyf/spei-withdraw-processor";
import { query } from "@/lib/seyf/db/client";

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

function maskValue(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 6) return `${value[0]}***`;
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function summarizePayloadForLogs(payload: unknown) {
  const root = asObject(payload) ?? {};
  const data = asObject(root.data) ?? asObject(root.payload) ?? root;

  return {
    eventType: pickString(root, ["event", "eventType", "type", "name"]),
    customerId: maskValue(pickString(data, ["customerId", "customer_id"])),
    walletPublicKey: maskValue(pickString(data, ["walletPublicKey", "wallet_public_key", "pubkey", "publicKey"])),
    status: pickString(data, ["status"]),
  };
}

// Keep signature verification for backward compatibility but use WithSecrets
import { verifyEtherfuseWebhookSignature } from "@/lib/etherfuse/webhook-verify";

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

function extractEventId(payload: unknown): string | null {
  const root = asObject(payload);
  if (!root) return null;
  return pickString(root, ["id", "eventId", "webhookId", "event_id"]);
}

function extractEventType(payload: unknown): string {
  return pickString(asObject(payload) ?? {}, ["event", "eventType", "type", "name"]) ?? "unknown";
}

function extractWebhookTimestamp(req: Request, payload: unknown): string | null {
  return (
    req.headers.get("x-timestamp") ??
    req.headers.get("x-webhook-timestamp") ??
    req.headers.get("x-etherfuse-timestamp") ??
    pickString(asObject(payload) ?? {}, ["createdAt", "timestamp", "occurredAt"])
  );
}

function etherfuseWebhookSecrets(primarySecret: string): string[] {
  const previousSecrets = (process.env.ETHERFUSE_WEBHOOK_SECRET_PREVIOUS ?? "")
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean);
  return [primarySecret, ...previousSecrets];
}

/**
 * POST /api/webhooks/etherfuse
 * Configura la URL en devnet (Ramp -> Webhooks) apuntando a tu dominio + esta ruta.
 * Secreto en ETHERFUSE_WEBHOOK_SECRET (base64, el que devuelve create webhook una sola vez).
 *
 * @see https://docs.etherfuse.com/guides/verifying-webhooks
 */
async function handlePost(req: Request, _context: { params: Promise<Record<string, string | string[]>> }) {
  const logCtx = { route: "webhooks/etherfuse", provider: "etherfuse" };

  const raw = await req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { webhookSecret: secret } = getEtherfuseConfig();
  const sig = req.headers.get("x-signature");

  if (secret) {
    const verification = verifyEtherfuseWebhookWithSecrets(payload, sig, etherfuseWebhookSecrets(secret));
    if (!verification.valid) {
      return NextResponse.json({ error: `Firma inválida: ${verification.reason}` }, { status: 401 });
    }
  } else if (strictEtherfuseProductionConfig()) {
    return webhookSecretMissing(logCtx);
  }

  const eventId = extractEventId(payload);
  if (!eventId) {
    return webhookMalformed("missing_event_id", logCtx);
  }

  const eventType = extractEventType(payload);
  const replayReservation = await reserveWebhookEvent(eventId, eventType);
  if (!replayReservation.ok) {
    return webhookReplayStoreUnavailable({ ...logCtx, eventId });
  }
  if (!replayReservation.reserved) {
    logger.info(
      { ...logCtx, eventId },
      "Duplicate webhook event ignored",
    );
    return NextResponse.json({ ok: true });
  }

  logger.debug(
    { route: "webhooks/etherfuse", payload: summarizePayloadForLogs(payload) },
    "Etherfuse webhook received",
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
    try {
      await appendKycAuditEvent({
        event: "update",
        customerId: kyc.customerId,
        walletPublicKey: kyc.walletPublicKey,
        status: kyc.status,
        eventId: kyc.eventId,
      });
    } catch (auditError) {
      logger.warn(
        { route: "webhooks/etherfuse/kyc", error: auditError instanceof Error ? auditError.message : String(auditError) },
        "KYC audit event write failed",
      );
    }
    logger.info(
      { route: "webhooks/etherfuse/kyc", customerId: kyc.customerId, status: kyc.status, updated: result.updated },
      `KYC update processed: ${kyc.status}`,
    );
  }

  try {
    const details = pickRampOrderTransactionDetails(payload);
    const orderType = (details.orderType ?? "").toLowerCase();
    const orderStatus = (details.status ?? "").toLowerCase();

    if (orderType === "onramp") {
      const isConfirmed = orderStatus === "confirmed" || orderStatus === "completed" || orderStatus === "success";
      if (isConfirmed && details.orderId) {
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
    } else if (orderType === "offramp" && details.orderId) {
      const withdrawalId = details.orderId;
      const withdrawal = await getWithdrawalById(withdrawalId);

      if (withdrawal) {
        if (orderStatus === "processing" || orderStatus === "funded") {
          await processProcessingWithdrawal(withdrawalId, "webhook:etherfuse");

          const metadataUpdate = {
            etherfuse_order_id: details.orderId,
            etherfuse_status: details.status,
            etherfuse_tx_signature: details.confirmedTxSignature,
            updated_at: new Date().toISOString(),
          };
          await query(
            `update withdrawals
             set metadata = metadata || $2::jsonb
             where id = $1`,
            [withdrawalId, JSON.stringify(metadataUpdate)],
          );
        } else if (orderStatus === "completed" || orderStatus === "success" || orderStatus === "confirmed") {
          void enqueueSpeiWithdrawEvent({
            eventId: eventId,
            withdrawalId: withdrawalId,
            userId: withdrawal.user_id,
            status: "completed",
            amountMxn: details.amountInFiat ? Number(details.amountInFiat) : Number(withdrawal.amount_mxn),
            destinationLabel: details.bankAccountId ?? undefined,
          }).catch((error) => {
            logger.error({ route: "webhooks/etherfuse", error: String(error) }, "Failed to enqueue completed offramp event");
          });
        } else if (orderStatus === "failed" || orderStatus === "canceled" || orderStatus === "cancelled" || orderStatus === "rejected") {
          void enqueueSpeiWithdrawEvent({
            eventId: eventId,
            withdrawalId: withdrawalId,
            userId: withdrawal.user_id,
            status: "failed",
            amountMxn: details.amountInFiat ? Number(details.amountInFiat) : Number(withdrawal.amount_mxn),
            reason: `Order failed in Etherfuse (status: ${details.status})`,
          }).catch((error) => {
            logger.error({ route: "webhooks/etherfuse", error: String(error) }, "Failed to enqueue failed offramp event");
          });
        }
      } else {
        logger.warn(
          { route: "webhooks/etherfuse", withdrawalId },
          "Offramp webhook received but no corresponding withdrawal found",
        );
      }
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
