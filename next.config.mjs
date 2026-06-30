import path from "node:path";
import { fileURLToPath } from "node:url";
import createNextIntlPlugin from "next-intl/plugin";

const __filename = fileURLToPath(import.meta.url);
// Raíz del proyecto (seyf-app). Evita que Turbopack/Webpack infieran
// `...\\Documents\\GitHub` cuando hay otro lockfile en el padre o mezcla pnpm+npm.
const __dirname = path.resolve(path.dirname(__filename));

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  outputFileTracingRoot: __dirname,
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy-Report-Only",
            value:
              "default-src 'self'; script-src 'self' https://va.vercel-scripts.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://images.unsplash.com; connect-src 'self' https://api.etherfuse.com https://api.sand.etherfuse.com https://api.pollar.xyz https://sdk.api.pollar.xyz https://api.frankfurter.app https://horizon.stellar.org https://horizon-testnet.stellar.org https://vercel.com https://*.vercel-insights.com; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; worker-src 'self'; report-uri /api/seyf/_csp-report",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
