import { NextResponse } from "next/server";
import { verifySpeiOutboundWebhookSignature } from "@/lib/seyf/spei-webhook-hmac";
import { isWebhookEventProcessed, getWithdrawalById } from "@/lib/seyf/withdrawal-service";
import { enqueueSpeiWithdrawEvent } from "@/lib/seyf/spei-withdraw-processor";
import { logger } from "@/lib/observability/logger";
import { withLogging } from "@/lib/observability/with-logging";

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
  const raw = await req.text();

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const secret = process.env.SPEI_OUTBOUND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    logger.error({ route: "webhooks/spei/outbound" }, "SPEI_OUTBOUND_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  const sig = req.headers.get("x-signature");
  if (!verifySpeiOutboundWebhookSignature(payload, sig, secret)) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  logger.debug(
    { route: "webhooks/spei/outbound" },
    typeof payload === "object" && payload !== null
      ? JSON.stringify(payload).slice(0, 2500)
      : String(payload),
  );

  const event = extractSpeiOutboundEvent(payload);

  if (!event.eventId) {
    logger.warn({ route: "webhooks/spei/outbound" }, "Evento sin event_id");
    return NextResponse.json({ ok: true });
  }

  if (!event.withdrawalId) {
    logger.warn({ route: "webhooks/spei/outbound", eventId: event.eventId }, "Evento sin withdrawal_id");
    return NextResponse.json({ ok: true });
  }

  if (!event.status || !["completed", "failed"].includes(event.status.toLowerCase())) {
    logger.warn(
      { route: "webhooks/spei/outbound", eventId: event.eventId, status: event.status },
      "Evento con status no manejado",
    );
    return NextResponse.json({ ok: true });
  }

  const alreadyProcessed = await isWebhookEventProcessed(event.eventId);
  if (alreadyProcessed) {
    logger.info(
      { route: "webhooks/spei/outbound", eventId: event.eventId },
      "Evento duplicado ignorado",
    );
    return NextResponse.json({ ok: true });
  }

  const withdrawal = await getWithdrawalById(event.withdrawalId);
  if (!withdrawal) {
    logger.warn(
      { route: "webhooks/spei/outbound", withdrawalId: event.withdrawalId },
      "Withdrawal no encontrado",
    );
    return NextResponse.json({ ok: true });
  }

  const status = event.status.toLowerCase() as "completed" | "failed";

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
