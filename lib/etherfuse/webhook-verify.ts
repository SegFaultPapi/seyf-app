import { createHmac, timingSafeEqual } from "node:crypto";
import canonicalize from "canonicalize";

export type WebhookVerifyResult =
  | { valid: true; matchedSecretIndex: number }
  | { valid: false; reason: string };

const DEFAULT_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type EtherfuseWebhookVerifyOptions = {
  /** ISO-8601 timestamp from the webhook payload or header. */
  timestamp?: string | null;
  /** Maximum allowed clock skew in milliseconds. Defaults to 5 minutes. */
  maxClockSkewMs?: number;
};

/**
 * Verifies an Etherfuse webhook signature.
 *
 * The signed message is the parsed JSON body canonicalized with JCS, matching
 * Etherfuse's webhook guide and the previous implementation in this repo.
 */
export function verifyEtherfuseWebhook(
  payload: unknown,
  signatureHeader: string | null | undefined,
  secretBase64: string,
  options?: EtherfuseWebhookVerifyOptions,
): WebhookVerifyResult {
  if (!signatureHeader) {
    return { valid: false, reason: "missing_signature_header" };
  }
  if (!secretBase64) {
    return { valid: false, reason: "missing_secret" };
  }

  const canonicalized = canonicalize(payload);
  if (canonicalized === undefined) {
    return { valid: false, reason: "payload_not_canonicalizable" };
  }

  const key = Buffer.from(secretBase64, "base64");
  if (key.length === 0) {
    return { valid: false, reason: "secret_empty_after_decode" };
  }

  const hmac = createHmac("sha256", key).update(canonicalized).digest("hex");
  const expected = `sha256=${hmac}`;

  if (expected.length !== signatureHeader.length) {
    return { valid: false, reason: "signature_length_mismatch" };
  }

  let signatureValid = false;
  try {
    signatureValid = timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signatureHeader),
    );
  } catch {
    return { valid: false, reason: "timing_safe_equal_failed" };
  }

  if (!signatureValid) {
    return { valid: false, reason: "signature_mismatch" };
  }

  const ts = options?.timestamp;
  if (ts) {
    const eventTime = new Date(ts).getTime();
    if (Number.isNaN(eventTime)) {
      return { valid: false, reason: "timestamp_unparseable" };
    }

    const maxSkew = options?.maxClockSkewMs ?? DEFAULT_MAX_CLOCK_SKEW_MS;
    if (Math.abs(Date.now() - eventTime) > maxSkew) {
      return { valid: false, reason: "timestamp_outside_skew_window" };
    }
  }

  return { valid: true, matchedSecretIndex: 0 };
}

/**
 * Verifies against the active secret and any previous secrets accepted during
 * a short provider-side rotation window.
 */
export function verifyEtherfuseWebhookWithSecrets(
  payload: unknown,
  signatureHeader: string | null | undefined,
  secretBase64Values: string[],
  options?: EtherfuseWebhookVerifyOptions,
): WebhookVerifyResult {
  const secrets = secretBase64Values.map((secret) => secret.trim()).filter(Boolean);
  if (secrets.length === 0) {
    return { valid: false, reason: "missing_secret" };
  }

  let lastReason = "signature_mismatch";
  for (let index = 0; index < secrets.length; index += 1) {
    const result = verifyEtherfuseWebhook(payload, signatureHeader, secrets[index], options);
    if (result.valid) {
      return { valid: true, matchedSecretIndex: index };
    }

    lastReason = result.reason;
    if (
      result.reason !== "signature_mismatch" &&
      result.reason !== "signature_length_mismatch"
    ) {
      return result;
    }
  }

  return { valid: false, reason: lastReason };
}

/**
 * Backward-compatible boolean API. Prefer verifyEtherfuseWebhook for structured
 * failure reasons in route handlers.
 */
export function verifyEtherfuseWebhookSignature(
  payload: unknown,
  signatureHeader: string | null | undefined,
  secretBase64: string,
): boolean {
  return verifyEtherfuseWebhook(payload, signatureHeader, secretBase64).valid;
}
