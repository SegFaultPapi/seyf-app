import { NextResponse } from "next/server";
import { logger } from "@/lib/observability/logger";
import { rateLimitResponse } from "@/lib/seyf/redis-guards";

/** Maximum accepted webhook body size: 64 KiB. */
export const WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

/** Default rate-limit: 50 requests per 60-second window per source IP. */
const WEBHOOK_RATE_LIMIT = 50;
const WEBHOOK_RATE_WINDOW_SEC = 60;

export type WebhookBodyResult =
  | { ok: true; raw: string; payload: unknown }
  | { ok: false; response: NextResponse };

export async function readWebhookBody(
  req: Request,
  maxBytes: number = WEBHOOK_MAX_BODY_BYTES,
): Promise<WebhookBodyResult> {
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const declared = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Payload too large" },
          { status: 413 },
        ),
      };
    }
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unreadable body" },
        { status: 400 },
      ),
    };
  }

  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Payload too large" },
        { status: 413 },
      ),
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid JSON" },
        { status: 400 },
      ),
    };
  }

  return { ok: true, raw, payload };
}

export function webhookVerificationFailed(
  reason: string,
  logContext: Record<string, unknown>,
): NextResponse {
  logger.warn(
    { ...logContext, verificationFailureReason: reason },
    "Webhook verification failed",
  );
  return NextResponse.json(
    { error: "Webhook verification failed" },
    { status: 401 },
  );
}

export function webhookMalformed(
  reason: string,
  logContext: Record<string, unknown>,
): NextResponse {
  logger.warn(
    { ...logContext, malformedReason: reason },
    "Malformed webhook payload",
  );
  return NextResponse.json(
    { error: "Malformed webhook payload" },
    { status: 400 },
  );
}

export function webhookReplayStoreUnavailable(
  logContext: Record<string, unknown>,
): NextResponse {
  logger.error(logContext, "Webhook replay store unavailable");
  return NextResponse.json(
    { error: "Service unavailable" },
    { status: 503 },
  );
}

export function webhookSecretMissing(
  logContext: Record<string, unknown>,
): NextResponse {
  logger.error(logContext, "Webhook secret not configured");
  return NextResponse.json(
    { error: "Service unavailable" },
    { status: 503 },
  );
}

export async function webhookRateLimit(
  req: Request,
  endpoint: string,
): Promise<NextResponse | null> {
  return rateLimitResponse(req, `webhook:${endpoint}`, {
    limit: WEBHOOK_RATE_LIMIT,
    windowSec: WEBHOOK_RATE_WINDOW_SEC,
  });
}
