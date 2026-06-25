import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  test: {
    environment: "node",
    globals: false,
    include: [
      "lib/etherfuse/__tests__/**/*.test.ts",
      "lib/seyf/__tests__/**/*.test.ts",
      "lib/seyf/transactions/__tests__/**/*.test.ts",
    ],
    exclude: ["node_modules/**"],
  },
  resolve: {
    alias: {
      "@": root,
    },
  },
});
