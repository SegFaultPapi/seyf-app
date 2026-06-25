import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies the HMAC-SHA256 signature on an inbound SPEI webhook.
 *
 * The provider signs over the **raw request body bytes** and sends the result
 * in the `X-Signature` header as `sha256=<hex>`.
 *
 * Secret is the plain hex string stored in `SPEI_INBOUND_WEBHOOK_SECRET`
 * (not base64-encoded, unlike the Etherfuse webhook secret).
 *
 * @param rawBody         Raw request body buffer (before JSON.parse)
 * @param signatureHeader Value of the `x-signature` request header
 * @param secret          Value of `SPEI_INBOUND_WEBHOOK_SECRET` env var
 */
export function verifySpeiInboundWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;

  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const hmac = createHmac("sha256", secret).update(body).digest("hex");
  const expected = `sha256=${hmac}`;

  if (expected.length !== signatureHeader.length) return false;

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}
