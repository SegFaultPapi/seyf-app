import { createHmac, timingSafeEqual } from "node:crypto";
import canonicalize from "canonicalize";

export function verifySpeiOutboundWebhookSignature(
  payload: unknown,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;

  const canonicalized = canonicalize(payload);
  if (canonicalized === undefined) return false;

  const hmac = createHmac("sha256", secret).update(canonicalized).digest("hex");
  const expected = `sha256=${hmac}`;

  if (expected.length !== signatureHeader.length) return false;

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}
