# Security Headers

This project applies a strict `Content-Security-Policy-Report-Only` header plus additional security response headers.

## Configured response headers

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: DENY`
- `Permissions-Policy: camera=(self), microphone=(), geolocation=()`
- `Content-Security-Policy-Report-Only`

## Current CSP directive values

- `default-src 'self'`
- `script-src 'self'`
- `style-src 'self' 'unsafe-inline'`
- `img-src 'self' data: https://images.unsplash.com`
- `connect-src 'self' https://api.etherfuse.com https://api.sand.etherfuse.com https://api.pollar.xyz https://api.frankfurter.app https://horizon.stellar.org https://horizon-testnet.stellar.org https://vercel.com https://*.vercel-insights.com`
- `font-src 'self' data:`
- `frame-ancestors 'none'`
- `base-uri 'self'`
- `form-action 'self'`
- `object-src 'none'`
- `worker-src 'self'`
- `report-uri /api/seyf/_csp-report`

## CSP reporting endpoint

The report-only endpoint is implemented at `/api/seyf/_csp-report` and currently logs received reports.

## Notes

- `style-src` includes `'unsafe-inline'` because the app uses injected inline styles via React `dangerouslySetInnerHTML` in chart rendering.
- The CSP is report-only for now; once proven safe in staging, convert to `Content-Security-Policy`.

## Permissions-Policy

| Feature     | Value  | Reason                                                                                                |
| ----------- | ------ | ----------------------------------------------------------------------------------------------------- |
| camera      | (self) | Required for KYC identity verification on `/identidad` — allows the camera only from the same origin. |
| microphone  | ()     | Blocked — KYC does not require microphone access.                                                     |
| geolocation | ()     | Blocked — the app does not use geolocation features.                                                  |

## Origins Exempt from CSP (Server-Side Only)

The following integrations make calls exclusively from Next.js API routes or server components and are therefore invisible to the browser's CSP enforcement. They do not appear in `connect-src`.

| Service       | Why server-side only                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Upstash Redis | Accessed via `@upstash/redis` in server API routes and server components only — browser never connects directly to Redis. |
| Twilio        | SMS/auth calls made from server API routes (server-to-server) and never from the browser.                                 |

## `connect-src` origin mapping

The following table documents every origin included in `connect-src` and why it is required.

| Origin                              | Directive   | Required by                                                           |
| ----------------------------------- | ----------- | --------------------------------------------------------------------- |
| `'self'`                            | connect-src | Browser requests to our own APIs and assets                           |
| https://api.etherfuse.com           | connect-src | Etherfuse production API (onramps/offramps)                           |
| https://api.sand.etherfuse.com      | connect-src | Etherfuse sandbox API used in development/testing                     |
| https://api.pollar.xyz              | connect-src | Pollar custody API used for Stellar wallet provisioning/operations    |
| https://api.frankfurter.app         | connect-src | FX rates provider used by `/api/seyf/fx` routes                       |
| https://horizon.stellar.org         | connect-src | Stellar mainnet Horizon (tx lookups, public data)                     |
| https://horizon-testnet.stellar.org | connect-src | Stellar testnet Horizon (dev/staging)                                 |
| https://vercel.com                  | connect-src | Vercel Analytics origin used by `@vercel/analytics` (server-assisted) |
| https://\*.vercel-insights.com      | connect-src | Vercel insights endpoints (wildcard) used for analytics/telemetry     |

## CSP reporting endpoint

The report-only endpoint is implemented at `/api/seyf/_csp-report` and currently logs received reports. The handler returns HTTP 204 No Content as required by the CSP reporting specification.

## Notes

- `style-src` includes `'unsafe-inline'` because the app uses injected inline styles via React `dangerouslySetInnerHTML` in chart rendering.
- The CSP is report-only for now; once proven safe in staging, convert to `Content-Security-Policy`.
