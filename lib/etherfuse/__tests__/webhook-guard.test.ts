import { describe, it, expect } from "vitest";
import {
  readWebhookBody,
  WEBHOOK_MAX_BODY_BYTES,
} from "../../webhooks/webhook-guard";

function makeRequest(
  body: string,
  headers?: Record<string, string>,
): Request {
  return new Request("https://localhost/api/webhooks/test", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

describe("readWebhookBody", () => {
  it("parses valid JSON within size limit", async () => {
    const payload = { event: "test", id: "123" };
    const req = makeRequest(JSON.stringify(payload));
    const result = await readWebhookBody(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual(payload);
      expect(result.raw).toBe(JSON.stringify(payload));
    }
  });

  it("rejects body exceeding custom size limit", async () => {
    const smallLimit = 16;
    const bigBody = JSON.stringify({ data: "x".repeat(100) });
    const req = makeRequest(bigBody);
    const result = await readWebhookBody(req, smallLimit);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(413);
      const json = await result.response.json();
      expect(json.error).toBe("Payload too large");
    }
  });

  it("rejects body exceeding default limit via Content-Length header", async () => {
    const fakeLength = String(WEBHOOK_MAX_BODY_BYTES + 1);
    const req = makeRequest("{}", { "content-length": fakeLength });
    const result = await readWebhookBody(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(413);
    }
  });

  it("rejects invalid JSON", async () => {
    const req = makeRequest("not-json{{{");
    const result = await readWebhookBody(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const json = await result.response.json();
      expect(json.error).toBe("Invalid JSON");
    }
  });

  it("rejects empty body as invalid JSON", async () => {
    const req = makeRequest("");
    const result = await readWebhookBody(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
    }
  });

  it("accepts body at exactly the size limit", async () => {
    const smallLimit = 64;
    const padding = "x".repeat(smallLimit - '{"a":""}'.length);
    const body = JSON.stringify({ a: padding });
    expect(Buffer.byteLength(body, "utf8")).toBe(smallLimit);
    const req = makeRequest(body);
    const result = await readWebhookBody(req, smallLimit);
    expect(result.ok).toBe(true);
  });

  it("does not leak parser details in the response body", async () => {
    const req = makeRequest("{{invalid}}");
    const result = await readWebhookBody(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const json = await result.response.json();
      expect(json.error).toBe("Invalid JSON");
      expect(JSON.stringify(json)).not.toContain("SyntaxError");
      expect(JSON.stringify(json)).not.toContain("Unexpected");
    }
  });
});

describe("WEBHOOK_MAX_BODY_BYTES", () => {
  it("is 64 KiB", () => {
    expect(WEBHOOK_MAX_BODY_BYTES).toBe(64 * 1024);
  });
});
