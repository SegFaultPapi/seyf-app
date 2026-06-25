import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { createHmac } from "node:crypto";
import canonicalize from "canonicalize";
import {
  verifyEtherfuseWebhook,
  verifyEtherfuseWebhookSignature,
  verifyEtherfuseWebhookWithSecrets,
} from "../webhook-verify";

function makeSecret(bytes = 32): string {
  const buf = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 1) buf[i] = Math.floor(Math.random() * 256);
  return buf.toString("base64");
}

function sign(payload: unknown, secretBase64: string): string {
  const key = Buffer.from(secretBase64, "base64");
  const canonical = canonicalize(payload)!;
  const hmac = createHmac("sha256", key).update(canonical).digest("hex");
  return `sha256=${hmac}`;
}

const TEST_SECRET = makeSecret();

describe("verifyEtherfuseWebhook", () => {
  describe("valid signatures", () => {
    it("accepts a correctly signed simple payload", () => {
      const payload = { event: "kyc_updated", id: "evt_1" };
      const sig = sign(payload, TEST_SECRET);
      const result = verifyEtherfuseWebhook(payload, sig, TEST_SECRET);
      expect(result).toEqual({ valid: true, matchedSecretIndex: 0 });
    });

    it("accepts a correctly signed nested payload", () => {
      const payload = {
        event: "order.confirmed",
        id: "evt_2",
        data: { orderId: "ord_abc", status: "confirmed", amount: 100.5 },
      };
      const sig = sign(payload, TEST_SECRET);
      const result = verifyEtherfuseWebhook(payload, sig, TEST_SECRET);
      expect(result).toEqual({ valid: true, matchedSecretIndex: 0 });
    });

    it("accepts payload with non-ascii characters", () => {
      const payload = { event: "test", message: "Hola CETES 10%" };
      const sig = sign(payload, TEST_SECRET);
      const result = verifyEtherfuseWebhook(payload, sig, TEST_SECRET);
      expect(result).toEqual({ valid: true, matchedSecretIndex: 0 });
    });
  });

  describe("invalid signatures", () => {
    it("rejects a tampered payload", () => {
      const original = { event: "kyc_updated", id: "evt_1" };
      const sig = sign(original, TEST_SECRET);
      const tampered = { event: "kyc_updated", id: "evt_TAMPERED" };
      const result = verifyEtherfuseWebhook(tampered, sig, TEST_SECRET);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe("signature_mismatch");
    });

    it("rejects a completely wrong signature string", () => {
      const payload = { event: "test" };
      const result = verifyEtherfuseWebhook(payload, "sha256=badhex", TEST_SECRET);
      expect(result.valid).toBe(false);
    });

    it("rejects signature from a different secret", () => {
      const payload = { event: "test" };
      const otherSecret = makeSecret();
      const sig = sign(payload, otherSecret);
      const result = verifyEtherfuseWebhook(payload, sig, TEST_SECRET);
      expect(result.valid).toBe(false);
    });
  });

  describe("missing or empty parameters", () => {
    it("rejects null signature header", () => {
      const result = verifyEtherfuseWebhook({ event: "test" }, null, TEST_SECRET);
      expect(result).toEqual({ valid: false, reason: "missing_signature_header" });
    });

    it("rejects undefined signature header", () => {
      const result = verifyEtherfuseWebhook({ event: "test" }, undefined, TEST_SECRET);
      expect(result).toEqual({ valid: false, reason: "missing_signature_header" });
    });

    it("rejects empty string signature header", () => {
      const result = verifyEtherfuseWebhook({ event: "test" }, "", TEST_SECRET);
      expect(result).toEqual({ valid: false, reason: "missing_signature_header" });
    });

    it("rejects empty secret", () => {
      const payload = { event: "test" };
      const sig = sign(payload, TEST_SECRET);
      const result = verifyEtherfuseWebhook(payload, sig, "");
      expect(result).toEqual({ valid: false, reason: "missing_secret" });
    });

    it("rejects secret that decodes to empty buffer", () => {
      const payload = { event: "test" };
      const sig = sign(payload, TEST_SECRET);
      const result = verifyEtherfuseWebhook(payload, sig, "====");
      expect(result.valid).toBe(false);
    });
  });

  describe("malformed payloads", () => {
    it("rejects undefined payload", () => {
      const result = verifyEtherfuseWebhook(undefined, "sha256=abc", TEST_SECRET);
      expect(result).toEqual({ valid: false, reason: "payload_not_canonicalizable" });
    });

    it("accepts null payload", () => {
      const sig = sign(null, TEST_SECRET);
      const result = verifyEtherfuseWebhook(null, sig, TEST_SECRET);
      expect(result).toEqual({ valid: true, matchedSecretIndex: 0 });
    });

    it("accepts empty object payload", () => {
      const sig = sign({}, TEST_SECRET);
      const result = verifyEtherfuseWebhook({}, sig, TEST_SECRET);
      expect(result).toEqual({ valid: true, matchedSecretIndex: 0 });
    });

    it("accepts array payload", () => {
      const payload = [1, "two", { three: 3 }];
      const sig = sign(payload, TEST_SECRET);
      const result = verifyEtherfuseWebhook(payload, sig, TEST_SECRET);
      expect(result).toEqual({ valid: true, matchedSecretIndex: 0 });
    });
  });

  describe("timestamp and clock skew validation", () => {
    it("accepts timestamp within skew window", () => {
      const payload = { event: "test" };
      const sig = sign(payload, TEST_SECRET);
      const result = verifyEtherfuseWebhook(payload, sig, TEST_SECRET, {
        timestamp: new Date().toISOString(),
      });
      expect(result).toEqual({ valid: true, matchedSecretIndex: 0 });
    });

    it("rejects timestamp outside default 5-minute skew window", () => {
      const payload = { event: "test" };
      const sig = sign(payload, TEST_SECRET);
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const result = verifyEtherfuseWebhook(payload, sig, TEST_SECRET, {
        timestamp: tenMinAgo,
      });
      expect(result).toEqual({ valid: false, reason: "timestamp_outside_skew_window" });
    });

    it("rejects timestamp far in the future", () => {
      const payload = { event: "test" };
      const sig = sign(payload, TEST_SECRET);
      const tenMinFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const result = verifyEtherfuseWebhook(payload, sig, TEST_SECRET, {
        timestamp: tenMinFuture,
      });
      expect(result).toEqual({ valid: false, reason: "timestamp_outside_skew_window" });
    });

    it("respects custom maxClockSkewMs", () => {
      const payload = { event: "test" };
      const sig = sign(payload, TEST_SECRET);
      const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const result = verifyEtherfuseWebhook(payload, sig, TEST_SECRET, {
        timestamp: twoMinAgo,
        maxClockSkewMs: 60 * 1000,
      });
      expect(result).toEqual({ valid: false, reason: "timestamp_outside_skew_window" });
    });

    it("rejects unparseable timestamp string", () => {
      const payload = { event: "test" };
      const sig = sign(payload, TEST_SECRET);
      const result = verifyEtherfuseWebhook(payload, sig, TEST_SECRET, {
        timestamp: "not-a-date",
      });
      expect(result).toEqual({ valid: false, reason: "timestamp_unparseable" });
    });

    it("skips timestamp check when timestamp is null", () => {
      const payload = { event: "test" };
      const sig = sign(payload, TEST_SECRET);
      const result = verifyEtherfuseWebhook(payload, sig, TEST_SECRET, {
        timestamp: null,
      });
      expect(result).toEqual({ valid: true, matchedSecretIndex: 0 });
    });
  });
});

describe("verifyEtherfuseWebhookWithSecrets", () => {
  it("accepts a signature from the active secret", () => {
    const payload = { event: "test" };
    const activeSecret = makeSecret();
    const previousSecret = makeSecret();
    const result = verifyEtherfuseWebhookWithSecrets(
      payload,
      sign(payload, activeSecret),
      [activeSecret, previousSecret],
    );
    expect(result).toEqual({ valid: true, matchedSecretIndex: 0 });
  });

  it("accepts a signature from a previous secret during rotation", () => {
    const payload = { event: "test" };
    const activeSecret = makeSecret();
    const previousSecret = makeSecret();
    const result = verifyEtherfuseWebhookWithSecrets(
      payload,
      sign(payload, previousSecret),
      [activeSecret, previousSecret],
    );
    expect(result).toEqual({ valid: true, matchedSecretIndex: 1 });
  });
});

describe("verifyEtherfuseWebhookSignature", () => {
  it("returns true for valid signature", () => {
    const payload = { key: "value" };
    const sig = sign(payload, TEST_SECRET);
    expect(verifyEtherfuseWebhookSignature(payload, sig, TEST_SECRET)).toBe(true);
  });

  it("returns false for invalid signature", () => {
    const payload = { key: "value" };
    expect(verifyEtherfuseWebhookSignature(payload, "sha256=bad", TEST_SECRET)).toBe(false);
  });

  it("returns false for null signature", () => {
    expect(verifyEtherfuseWebhookSignature({ key: "value" }, null, TEST_SECRET)).toBe(false);
  });

  it("returns false for empty secret", () => {
    const payload = { key: "value" };
    const sig = sign(payload, TEST_SECRET);
    expect(verifyEtherfuseWebhookSignature(payload, sig, "")).toBe(false);
  });
});

describe("property-based: verifyEtherfuseWebhook", () => {
  it("any JSON-serializable object signed with the correct secret verifies", () => {
    const secret = makeSecret();
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const sig = sign(value, secret);
        const result = verifyEtherfuseWebhook(value, sig, secret);
        return result.valid === true;
      }),
      { numRuns: 100 },
    );
  });

  it("any mutation to the signature causes rejection", () => {
    const secret = makeSecret();
    fc.assert(
      fc.property(fc.jsonValue(), fc.nat({ max: 63 }), (value, idx) => {
        const sig = sign(value, secret);
        const hexStart = "sha256=".length;
        const mutIdx = hexStart + (idx % (sig.length - hexStart));
        const chars = sig.split("");
        const c = chars[mutIdx];
        chars[mutIdx] = parseInt(c, 16) < 8
          ? (parseInt(c, 16) + 8).toString(16)
          : (parseInt(c, 16) - 8).toString(16);
        const mutated = chars.join("");
        if (mutated === sig) return true;
        const result = verifyEtherfuseWebhook(value, mutated, secret);
        return result.valid === false;
      }),
      { numRuns: 100 },
    );
  });
});
