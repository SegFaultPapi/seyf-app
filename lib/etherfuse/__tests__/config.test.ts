// Feature: etherfuse-client-hardening
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { getEtherfuseConfig, ETHERFUSE_ENV_MATRIX } from "../config";

// Snapshot of env before all tests
const originalEnv: Record<string, string | undefined> = {};
const TRACKED_KEYS = [
  "ETHERFUSE_API_KEY",
  "ETHERFUSE_API_BASE_URL",
  "ETHERFUSE_WEBHOOK_SECRET",
  "SEYF_ALLOW_ETHERFUSE_RAMP",
  "NODE_ENV",
  "VERCEL_ENV",
];

for (const key of TRACKED_KEYS) {
  originalEnv[key] = process.env[key];
}

function resetTrackedEnv() {
  for (const key of TRACKED_KEYS) {
    const orig = originalEnv[key];
    if (orig === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = orig;
    }
  }
}

function clearEtherfuseEnv() {
  for (const key of TRACKED_KEYS) {
    delete process.env[key];
  }
}

// Helper: set env vars, call fn, then restore tracked keys
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const key of TRACKED_KEYS) {
    saved[key] = process.env[key];
  }
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

describe("ETHERFUSE_ENV_MATRIX", () => {
  it("is exported and contains entries for all known variables (Req 1.1)", () => {
    expect(Array.isArray(ETHERFUSE_ENV_MATRIX)).toBe(true);
    expect(ETHERFUSE_ENV_MATRIX.length).toBeGreaterThan(0);

    const names = ETHERFUSE_ENV_MATRIX.map((e) => e.name);
    expect(names).toContain("ETHERFUSE_API_KEY");
    expect(names).toContain("ETHERFUSE_API_BASE_URL");
    expect(names).toContain("ETHERFUSE_WEBHOOK_SECRET");
    expect(names).toContain("SEYF_ALLOW_ETHERFUSE_RAMP");
  });
});

describe("getEtherfuseConfig() — unit tests", () => {
  beforeEach(() => {
    clearEtherfuseEnv();
  });

  afterEach(() => {
    resetTrackedEnv();
  });

  it("returns correct EtherfuseConfig shape when all required vars are present", () => {
    process.env.ETHERFUSE_API_KEY = "test-api-key";
    process.env.ETHERFUSE_API_BASE_URL = "https://api.example.com/";
    (process.env as any).NODE_ENV = "development";

    const config = getEtherfuseConfig();

    expect(config.apiKey).toBe("test-api-key");
    expect(config.baseUrl).toBe("https://api.example.com"); // trailing slash stripped
    expect(config.webhookSecret).toBeNull();
    expect(config.allowRamp).toBe(false);
  });

  it("does not throw when ETHERFUSE_WEBHOOK_SECRET is missing in production (enforced at route level)", () => {
    process.env.ETHERFUSE_API_KEY = "test-api-key";
    (process.env as any).NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    process.env.SEYF_ALLOW_ETHERFUSE_RAMP = "true";
    delete process.env.ETHERFUSE_WEBHOOK_SECRET;

    const config = getEtherfuseConfig();
    expect(config.webhookSecret).toBeNull();
  });

  it("no exige ETHERFUSE_WEBHOOK_SECRET en Vercel preview aunque NODE_ENV sea production", () => {
    process.env.ETHERFUSE_API_KEY = "test-api-key";
    (process.env as any).NODE_ENV = "production";
    process.env.VERCEL_ENV = "preview";
    delete process.env.ETHERFUSE_WEBHOOK_SECRET;
    process.env.SEYF_ALLOW_ETHERFUSE_RAMP = "false";

    const config = getEtherfuseConfig();
    expect(config.webhookSecret).toBeNull();
    expect(config.allowRamp).toBe(false);
  });

  it("throws when SEYF_ALLOW_ETHERFUSE_RAMP is not 'true' in production (Req 1.5)", () => {
    process.env.ETHERFUSE_API_KEY = "test-api-key";
    (process.env as any).NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    process.env.ETHERFUSE_WEBHOOK_SECRET = "secret";
    process.env.SEYF_ALLOW_ETHERFUSE_RAMP = "false";

    expect(() => getEtherfuseConfig()).toThrow("SEYF_ALLOW_ETHERFUSE_RAMP");
  });

  it("uses default baseUrl when ETHERFUSE_API_BASE_URL is not set", () => {
    process.env.ETHERFUSE_API_KEY = "test-api-key";
    (process.env as any).NODE_ENV = "development";
    delete process.env.ETHERFUSE_API_BASE_URL;

    const config = getEtherfuseConfig();
    expect(config.baseUrl).toBe("https://api.sand.etherfuse.com");
  });
});

describe("getEtherfuseConfig() — property tests", () => {
  beforeEach(() => {
    clearEtherfuseEnv();
  });

  afterEach(() => {
    resetTrackedEnv();
  });

  it(// Feature: etherfuse-client-hardening, Property 1: Config validation round-trip
  // Validates: Requirements 1.6
  "P1: valid inputs produce EtherfuseConfig with matching fields", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        fc.webUrl().filter((u) => u.startsWith("https://")),
        (apiKey, baseUrl) => {
          return withEnv(
            {
              ETHERFUSE_API_KEY: apiKey,
              ETHERFUSE_API_BASE_URL: baseUrl,
              NODE_ENV: "development",
            },
            () => {
              const config = getEtherfuseConfig();
              expect(config.apiKey).toBe(apiKey.trim());
              expect(config.baseUrl).toBe(baseUrl.replace(/\/$/, ""));
              return true;
            },
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it(// Feature: etherfuse-client-hardening, Property 2: Missing API key always throws
  // Validates: Requirements 1.2
  "P2: missing or whitespace-only API key always throws with correct message", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(""),
          fc.string().map((s) => s.replace(/\S/g, " ")),
        ),
        (badApiKey) => {
          return withEnv(
            { ETHERFUSE_API_KEY: badApiKey, NODE_ENV: "development" },
            () => {
              let threw = false;
              let errorMsg = "";
              try {
                getEtherfuseConfig();
              } catch (e) {
                threw = true;
                errorMsg = e instanceof Error ? e.message : String(e);
              }
              expect(threw).toBe(true);
              expect(errorMsg).toContain("ETHERFUSE_API_KEY");
              expect(errorMsg).toContain(".env.example");
              return true;
            },
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it(// Feature: etherfuse-client-hardening, Property 3: Non-HTTPS base URL always throws
  // Validates: Requirements 1.3
  "P3: non-HTTPS base URL always throws with invalid URL message", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1 })
          .filter((s) => !s.startsWith("https://") && s.trim().length > 0),
        (badUrl) => {
          return withEnv(
            {
              ETHERFUSE_API_KEY: "valid-key",
              ETHERFUSE_API_BASE_URL: badUrl,
              NODE_ENV: "development",
            },
            () => {
              let threw = false;
              let errorMsg = "";
              try {
                getEtherfuseConfig();
              } catch (e) {
                threw = true;
                errorMsg = e instanceof Error ? e.message : String(e);
              }
              expect(threw).toBe(true);
              expect(errorMsg).toContain("ETHERFUSE_API_BASE_URL");
              return true;
            },
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it(// Feature: etherfuse-client-hardening, Property 4: All validation errors collected before throwing
  // Validates: Requirements 1.7
  "P4: multiple invalid vars produce a single error listing all failing variable names", () => {
    withEnv(
      {
        ETHERFUSE_API_KEY: "", // invalid: empty
        ETHERFUSE_API_BASE_URL: "http://not-https.com", // invalid: not https
        NODE_ENV: "production",
        SEYF_ALLOW_ETHERFUSE_RAMP: "false", // invalid in production
      },
      () => {
        let threw = false;
        let errorMsg = "";
        try {
          getEtherfuseConfig();
        } catch (e) {
          threw = true;
          errorMsg = e instanceof Error ? e.message : String(e);
        }
        expect(threw).toBe(true);
        // All failing variable names must appear in the single error message
        expect(errorMsg).toContain("ETHERFUSE_API_KEY");
        expect(errorMsg).toContain("ETHERFUSE_API_BASE_URL");
        expect(errorMsg).not.toContain("ETHERFUSE_WEBHOOK_SECRET");
        expect(errorMsg).toContain("SEYF_ALLOW_ETHERFUSE_RAMP");
      },
    );
  });
});
