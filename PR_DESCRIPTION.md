# Seyf Security Headers PR

This PR introduces robust security headers to the Seyf app to protect users against common web vulnerabilities, including a Content-Security-Policy (CSP) in report-only mode to monitor violations before enforcement.

## Changes Included
- Added `headers()` to `next.config.mjs` applying to `/(.*)`.
- Enabled `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, and `Permissions-Policy`.
- Created CSP in report-only mode with appropriate sources for Etherfuse, Pollar, Stellar Horizon, and Vercel analytics.
- Added a new endpoint at `/api/seyf/_csp-report` that logs violations and returns a `204 No Content` response.
- Wrote detailed documentation in `docs/security-headers.md`.

## Pre-existing Test Failures (Not introduced by this PR)

The following 3 tests were already failing on main before this PR.
Verified by running the test suite on the base branch before my changes.
These are unrelated to the CSP/security header implementation.

- `config.test.ts` — throws when ETHERFUSE_WEBHOOK_SECRET is missing in production
- `config.test.ts` — P4: multiple invalid vars produce a single error listing all failing variable names
- `kyc-gate.test.ts` — rejects non-approved statuses for ramp operations
