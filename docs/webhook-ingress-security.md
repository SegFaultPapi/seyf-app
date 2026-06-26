# Webhook Ingress Security

This runbook covers the Etherfuse webhook endpoint at
`POST /api/webhooks/etherfuse` and the SPEI outbound status endpoint at
`POST /api/webhooks/spei/outbound`.

## Etherfuse Verification Steps

1. Enforce the shared endpoint rate limit before reading the body: 50 requests
   per 60 seconds per source IP.
2. Reject request bodies larger than 64 KiB. The route checks `Content-Length`
   first and also measures the actual UTF-8 body after reading.
3. Parse the body as JSON. Invalid JSON returns `400` with a generic message.
4. Read `X-Signature` and verify `sha256=<hex>` using HMAC-SHA256.
5. Canonicalize the parsed JSON payload with JCS before computing the HMAC.
   This is the canonical body used by `lib/etherfuse/webhook-verify.ts`.
6. Decode `ETHERFUSE_WEBHOOK_SECRET` as base64 for the HMAC key. During
   rotation, `ETHERFUSE_WEBHOOK_SECRET_PREVIOUS` may contain comma-separated
   previous base64 secrets; the active secret is tried first.
7. Apply a 5-minute clock-skew check when the provider sends a timestamp in
   `X-Timestamp`, `X-Webhook-Timestamp`, `X-Etherfuse-Timestamp`, `createdAt`,
   `timestamp`, or `occurredAt`.
8. Require a stable event id from `id`, `eventId`, `webhookId`, or `event_id`.
9. Atomically reserve the event id in `processed_webhook_events` before any
   KYC update, state transition, wallet credit, or deployment enqueue. Duplicate
   ids return `200 { "ok": true }` and are ignored.

Replay rows are retained for 30 days by default. The app opportunistically
prunes older rows on webhook ingress.

## SPEI Verification Steps

SPEI outbound status webhooks use the same shared body limit, rate limit,
generic failure responses, and replay table. The signature is verified with
`SPEI_OUTBOUND_WEBHOOK_SECRET` as a raw HMAC-SHA256 key over the JCS
canonicalized JSON payload and the same `X-Signature` format.

## Failure Mode

Verification failures return `401` with a generic response body. Missing
secrets and replay-store failures return `503`. The server log records
structured route context and the internal failure reason for operations, but
does not leak signature details to the webhook sender.

## Secret Rotation

1. Generate the new Etherfuse webhook secret.
2. Move the current value of `ETHERFUSE_WEBHOOK_SECRET` into
   `ETHERFUSE_WEBHOOK_SECRET_PREVIOUS`.
3. Set `ETHERFUSE_WEBHOOK_SECRET` to the new base64 value.
4. Update the provider webhook configuration.
5. After the provider retry/rotation window closes, remove the old value from
   `ETHERFUSE_WEBHOOK_SECRET_PREVIOUS`.

## Out Of Scope

Network-layer WAF rules, CDN allowlists, provider source IP allowlists, and
external log-drain alert routing are expected to be handled by infrastructure
outside this application.
