import { describe, expect, it, vi, beforeEach } from "vitest";
import { signJWT, verifyJWT } from "../jwt";
import { hashPassword, verifyPassword } from "../password";
import { checkRateLimit, recordLoginAttempt } from "../rate-limit";
import * as db from "../../db/client";

// Mock DB client for rate limit tests
vi.mock("../../db/client", () => ({
  query: vi.fn(),
  withActor: vi.fn((actor: string, fn: () => Promise<any>) => fn()),
}));

describe("Auth Core - JWT", () => {
  const secret = "test_secret_must_be_long_enough_for_security";
  const payload = { userId: "user-123", status: "pending_kyc", depositLimitMxn: 1000 };

  it("signs and verifies a valid JWT", async () => {
    const token = await signJWT(payload, secret);
    expect(token).toBeDefined();
    expect(typeof token).toBe("string");

    const decoded = await verifyJWT(token, secret);
    expect(decoded).toBeDefined();
    expect(decoded!.userId).toBe("user-123");
    expect(decoded!.status).toBe("pending_kyc");
    expect(decoded!.depositLimitMxn).toBe(1000);
  });

  it("fails verification with an incorrect secret", async () => {
    const token = await signJWT(payload, secret);
    const decoded = await verifyJWT(token, "different_secret_key_value_here");
    expect(decoded).toBeNull();
  });

  it("returns null for expired tokens", async () => {
    const expiredPayload = {
      ...payload,
      exp: Math.floor(Date.now() / 1000) - 10, // 10 seconds ago
    };
    const token = await signJWT(expiredPayload, secret);
    const decoded = await verifyJWT(token, secret);
    expect(decoded).toBeNull();
  });

  it("returns null for malformed tokens", async () => {
    const decoded = await verifyJWT("not.a.jwt", secret);
    expect(decoded).toBeNull();
  });
});

describe("Auth Core - Password Hashing", () => {
  const password = "Password123!";

  it("hashes password and verifies it successfully", async () => {
    const hash = await hashPassword(password);
    expect(hash).toBeDefined();
    expect(hash).toContain(":");

    const isValid = await verifyPassword(password, hash);
    expect(isValid).toBe(true);
  });

  it("fails verification with an incorrect password", async () => {
    const hash = await hashPassword(password);
    const isValid = await verifyPassword("WrongPassword!", hash);
    expect(isValid).toBe(false);
  });

  it("fails verification with an invalid hash format", async () => {
    const isValid = await verifyPassword(password, "invalid_hash_format");
    expect(isValid).toBe(false);
  });
});

describe("Auth Core - Rate Limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows login when attempt count is below 10", async () => {
    // Mock DELETE query and SELECT count query
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rowCount: 1, rows: [] } as any) // DELETE
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ count: "5" }] } as any); // SELECT count

    const allowed = await checkRateLimit("127.0.0.1");
    expect(allowed).toBe(true);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM login_attempts"),
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("SELECT COUNT(*)"),
      ["127.0.0.1"]
    );
  });

  it("blocks login when attempt count is 10 or more", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rowCount: 1, rows: [] } as any) // DELETE
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ count: "10" }] } as any); // SELECT count

    const allowed = await checkRateLimit("127.0.0.1");
    expect(allowed).toBe(false);
  });

  it("records a login attempt", async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rowCount: 1, rows: [] } as any);

    await recordLoginAttempt("192.168.1.1");
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO login_attempts"),
      ["192.168.1.1"]
    );
  });
});
