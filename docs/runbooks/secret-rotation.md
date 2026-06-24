# Secret Rotation Procedure

> **Applies to:** All production secrets used by the Seyf API.
> **Frequency:** Before every production deploy, and immediately if a secret is suspected compromised.
> **Owner:** Platform engineering / DevOps.

## Secrets Inventory

| Secret | Source | Used By | Rotation Method |
|---|---|---|---|
| `ETHERFUSE_API_KEY` | [Etherfuse Dashboard](https://devnet.etherfuse.com/ramp/manage-api) | Etherfuse API client | Generate new key in Etherfuse UI, update Vercel |
| `ETHERFUSE_WEBHOOK_SECRET` | Etherfuse webhook settings | HMAC webhook verification | Generate new base64 secret, update webhook URL in Etherfuse |
| `BITSO_APIKEY` | [Juno/Bitso Dashboard](https://stage.buildwithjuno.com) | SPEI API client (HMAC auth) | Rotate in Juno dashboard, update Vercel |
| `BITSO_SECRET_APIKEY` | Juno/Bitso Dashboard | SPEI API client (HMAC signing) | Rotate in Juno dashboard, update Vercel |
| `TWILIO_ACCOUNT_SID` | [Twilio Console](https://console.twilio.com) | SMS notifications | Rotate in Twilio Console, update Vercel |
| `TWILIO_AUTH_TOKEN` | Twilio Console | SMS notifications | Rotate in Twilio Console, update Vercel |
| `TWILIO_MESSAGING_SERVICE_SID` | Twilio Console | SMS sender ID | Rotate in Twilio Console, update Vercel |
| `NEXT_PUBLIC_POLLAR_API_KEY` | [Pollar Dashboard](https://dashboard.pollar.xyz) | Stellar wallet provider | Rotate in Pollar dashboard, update Vercel |
| `SEYF_INTERNAL_NOTIFY_SECRET` | Ops-generated | Internal notification endpoint | Generate new UUID/token, update Vercel |
| `CRON_SECRET` | Ops-generated | Cron job authentication | Generate new UUID/token, update Vercel |
| `SEYF_ETHERFUSE_OPS_TOKEN` | Ops-generated | Back-office ops endpoints | Generate new UUID/token, update Vercel |

## Pre-Deploy Rotation Checklist

Run this before **every production deploy**:

### 1. Identify secrets to rotate

```bash
# Check which secrets are currently set (Vercel CLI)
vercel env pull .env.production
```

### 2. Generate new credentials for each provider

#### Etherfuse API Key
1. Go to [Etherfuse Dashboard](https://devnet.etherfuse.com/ramp/manage-api) (sandbox) or production URL.
2. Under **API Keys**, click **Generate New Key**.
3. Copy the new key immediately (shown once).

#### Etherfuse Webhook Secret
1. Go to Etherfuse Dashboard > **Webhooks**.
2. Click **Edit** on the existing webhook endpoint.
3. Generate a new base64 secret:
   ```bash
   openssl rand -base64 32
   ```
4. Update the webhook secret in both the Etherfuse UI and environment variables.

#### Bitso/Juno API Credentials
1. Go to [Juno Dashboard](https://stage.buildwithjuno.com) (sandbox) or production URL.
2. Navigate to **API Keys**.
3. Click **Rotate** next to the active key pair.
4. Copy both `API Key` and `Secret Key`.

#### Twilio Credentials
1. Go to [Twilio Console](https://console.twilio.com).
2. Navigate to **Account > API keys & tokens**.
3. Create a new API key or rotate the auth token.
4. Update `TWILIO_AUTH_TOKEN` and optionally `TWILIO_ACCOUNT_SID`.

### 3. Update Vercel environment variables

```bash
# For each secret, update in Vercel
vercel env rm ETHERFUSE_API_KEY production
vercel env add ETHERFUSE_API_KEY production
# ... repeat for each rotated secret

# Or use the Vercel Dashboard:
# Settings > Environment Variables > Edit each variable
```

### 4. Update provider webhooks (if applicable)

After rotating `ETHERFUSE_WEBHOOK_SECRET`:
1. Go to Etherfuse Dashboard > **Webhooks**.
2. Ensure the webhook URL still points to `https://your-domain.com/api/webhooks/etherfuse`.
3. The secret should match what was set in step 2.

### 5. Verify the deployment

```bash
# Deploy
vercel --prod

# Run health check
curl https://your-domain.com/api/health

# Verify Etherfuse connectivity
curl https://your-domain.com/api/seyf/internal/etherfuse-health
```

## Emergency Rotation (Compromised Secret)

If a secret is suspected compromised:

1. **Immediately** rotate the affected secrets following steps in section 2.
2. **Deploy** the new secrets to Vercel immediately.
3. **Revoke** the old credentials in each provider's dashboard.
4. **Audit logs** for any unauthorized access since the compromise window.
5. **Document** the incident in the team's incident log.

## Cron Job Schedules

After deploying, configure cron jobs in your scheduler:

| Job | Endpoint | Schedule | Purpose |
|---|---|---|---|
| Health check | `GET /api/health` | Every 1 min | Uptime monitoring (Betterstack) |
| Reconciliation | `GET /api/cron/reconciliation` | Every 15 min | Onchain balance verification |
| Deposit stuck | `GET /api/cron/alerts/deposit-stuck` | Every 5 min | Detect deposits pending > 30 min |
| Withdrawal stuck | `GET /api/cron/alerts/withdrawal-stuck` | Every 5 min | Detect withdrawals pending > 4h |
| Stellar failures | `GET /api/cron/alerts/stellar-failures` | Every 5 min | Detect Stellar TX failure rate > 5% |

All cron endpoints are protected by `CRON_SECRET` (sent as `Authorization: Bearer <secret>`).

## Log Aggregation

Structured JSON logs are output via **pino** and captured by:

- **Development:** `pino-pretty` for readable console output.
- **Production:** All logs are JSON-formatted and sent to stdout. Configure your log aggregation service (e.g., Logtail, Datadog, Loki) to ingest from your hosting platform's log stream.

For Vercel, logs are available in **Vercel Logs** dashboard. To forward to a third-party service, use Vercel Log Drains.
