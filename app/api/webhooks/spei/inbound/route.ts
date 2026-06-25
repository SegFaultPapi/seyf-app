import { NextResponse } from "next/server";
import { verifySpeiInboundWebhookSignature } from "@/lib/seyf/spei-inbound-hmac";
import {
  isSpeiInboundEventProcessed,
  markSpeiInboundEventProcessed,
  getUserIdForClabe,
  getDepositLimitForClabe,
  createPendingDeposit,
} from "@/lib/seyf/spei-deposit-service";
import { enqueueAutoDeployForDeposit } from "@/lib/seyf/spei-deposit-auto-deploy";
import { logger } from "@/lib/observability/logger";
import { withLogging } from "@/lib/observability/with-logging";

export const runtime = "nodejs";

const MIN_DEPOSIT_MXN = 500;

function pickStr(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function pickNum(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number.parseFloat(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function extractEvent(payload: unknown) {
  const root = payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
  const data = root.data && typeof root.data === "object"
    ? (root.data as Record<string, unknown>)
    : root;

  return {
    eventId: pickStr(root, ["event_id", "eventId", "id"]),
    clabe: pickStr(data, ["clabe", "destination_clabe", "destinationClabe", "beneficiary_clabe"]),
    amountMxn: pickNum(data, ["amount", "amount_mxn", "amountMxn"]),
    speiReference: pickStr(data, ["spei_reference", "speiReference", "reference", "tracking_key"]),
    receivedAt: pickStr(data, ["received_at", "receivedAt", "created_at", "timestamp"]),
  };
}

async function handlePost(req: Request) {
  const raw = await req.text();

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const secret = process.env.SPEI_INBOUND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    logger.error({ route: "webhooks/spei/inbound" }, "SPEI_INBOUND_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const sig = req.headers.get("x-signature");
  if (!verifySpeiInboundWebhookSignature(raw, sig, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = extractEvent(payload);

  if (!event.eventId) {
    logger.warn({ route: "webhooks/spei/inbound" }, "Missing event_id");
    return NextResponse.json({ ok: true });
  }

  if (await isSpeiInboundEventProcessed(event.eventId)) {
    return NextResponse.json({ ok: true });
  }

  if (!event.clabe || event.amountMxn == null) {
    logger.warn({ route: "webhooks/spei/inbound", eventId: event.eventId }, "Missing clabe or amount");
    await markSpeiInboundEventProcessed(event.eventId, null);
    return NextResponse.json({ ok: true });
  }

  const userId = await getUserIdForClabe(event.clabe);
  if (!userId) {
    logger.warn({ route: "webhooks/spei/inbound", clabe: event.clabe }, "CLABE not found");
    await markSpeiInboundEventProcessed(event.eventId, null);
    return NextResponse.json({ ok: true });
  }

  let status: "pending" | "refund_pending" = "pending";
  let note: string | undefined;

  if (event.amountMxn < MIN_DEPOSIT_MXN) {
    status = "refund_pending";
    note = "below_minimum";
  } else {
    const limit = await getDepositLimitForClabe(event.clabe);
    if (limit !== null && event.amountMxn > limit) {
      status = "refund_pending";
      note = "exceeds_limit";
    }
  }

  const deposit = await createPendingDeposit({
    userId,
    clabe: event.clabe,
    amountMxn: event.amountMxn,
    speiReference: event.speiReference,
    receivedAt: event.receivedAt,
    status,
    note,
  });

  void markSpeiInboundEventProcessed(event.eventId, deposit.id);

  if (status === "pending") {
    void enqueueAutoDeployForDeposit({
      depositId: deposit.id,
      amountMxn: event.amountMxn,
      userId,
    });
  }

  logger.info(
    { route: "webhooks/spei/inbound", eventId: event.eventId, depositId: deposit.id, status },
    "Inbound SPEI deposit created",
  );

  return NextResponse.json({ ok: true });
}

export const POST = withLogging(handlePost as Parameters<typeof withLogging>[0], {
  routeName: "webhooks/spei/inbound",
  provider: "spei",
});
