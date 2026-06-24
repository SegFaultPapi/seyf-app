import { NextResponse } from "next/server";
import { verifySpeiOutboundWebhookSignature } from "@/lib/seyf/spei-webhook-hmac";
import { getWithdrawalById } from "@/lib/seyf/withdrawal-service";
import { enqueueSpeiWithdrawEvent } from "@/lib/seyf/spei-withdraw-processor";
import { logger } from "@/lib/observability/logger";
import { withLogging } from "@/lib/observability/with-logging";
import { reserveWebhookEvent } from "@/lib/webhooks/replay-protection";
import {
  readWebhookBody,
  webhookReplayStoreUnavailable,
  webhookVerificationFailed,
  webhookSecretMissing,
  webhookRateLimit,
} from "@/lib/webhooks/webhook-guard";

export const runtime = "nodejs";

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const n = Number.parseFloat(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function extractSpeiOutboundEvent(payload: unknown): {
  eventId: string | null;
  status: string | null;
  withdrawalId: string | null;
  amountMxn: number | null;
  reason: string | null;
  destinationLabel: string | null;
} {
  const root = (payload && typeof payload === "object" ? payload as Record<string, unknown> : {});
  const data = (root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root);

  return {
    eventId: pickString(root, ["event_id", "eventId", "id", "webhookId"]),
    status: pickString(data, ["status"]),
    withdrawalId: pickString(data, ["withdrawal_id", "withdrawalId", "reference_id", "referenceId"]),
    amountMxn: pickNumber(data, ["amount_mxn", "amountMxn", "amount", "amount_mxn"]),
    reason: pickString(data, ["reason", "failure_reason", "failureReason", "error"]),
    destinationLabel: pickString(data, ["destination_clabe", "destinationClabe", "clabe", "beneficiary_clabe"]),
  };
}

async function handlePost(req: Request) {
  const logCtx = { route: "webhooks/spei/outbound" };

  const rateLimited = await webhookRateLimit(req, "spei/outbound");
  if (rateLimited) return rateLimited;

  const body = await readWebhookBody(req);
  if (!body.ok) return body.response;
  const { payload } = body;

  const secret = process.env.SPEI_OUTBOUND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return webhookSecretMissing(logCtx);
  }

  const sig = req.headers.get("x-signature");
  if (!verifySpeiOutboundWebhookSignature(payload, sig, secret)) {
    return webhookVerificationFailed("signature_invalid", logCtx);
  }

  logger.debug(
    logCtx,
    typeof payload === "object" && payload !== null
      ? JSON.stringify(payload).slice(0, 2500)
      : String(payload),
  );

  const event = extractSpeiOutboundEvent(payload);

  if (!event.eventId) {
    logger.warn(logCtx, "Evento sin event_id");
    return NextResponse.json({ ok: true });
  }

  if (!event.withdrawalId) {
    logger.warn({ ...logCtx, eventId: event.eventId }, "Evento sin withdrawal_id");
    return NextResponse.json({ ok: true });
  }

  if (!event.status || !["completed", "failed"].includes(event.status.toLowerCase())) {
    logger.warn(
      { ...logCtx, eventId: event.eventId, status: event.status },
      "Evento con status no manejado",
    );
    return NextResponse.json({ ok: true });
  }

  const withdrawal = await getWithdrawalById(event.withdrawalId);
  if (!withdrawal) {
    logger.warn(
      { ...logCtx, withdrawalId: event.withdrawalId },
      "Withdrawal no encontrado",
    );
    return NextResponse.json({ ok: true });
  }

  const status = event.status.toLowerCase() as "completed" | "failed";
  const replayReservation = await reserveWebhookEvent(
    event.eventId,
    `spei-outbound:${status}`,
    event.withdrawalId,
  );
  if (!replayReservation.ok) {
    return webhookReplayStoreUnavailable({ ...logCtx, eventId: event.eventId });
  }
  if (!replayReservation.reserved) {
    logger.info(
      { ...logCtx, eventId: event.eventId },
      "Evento duplicado ignorado",
    );
    return NextResponse.json({ ok: true });
  }

  void enqueueSpeiWithdrawEvent({
    eventId: event.eventId,
    withdrawalId: event.withdrawalId,
    userId: withdrawal.user_id,
    status,
    amountMxn: event.amountMxn ?? Number(withdrawal.amount_mxn),
    reason: event.reason ?? undefined,
    destinationLabel: event.destinationLabel ?? undefined,
  });

  return NextResponse.json({ ok: true });
}

export const POST = withLogging(handlePost, { routeName: "webhooks/spei/outbound", provider: "spei" });
