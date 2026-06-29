import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  hashPassword,
  verifyPassword,
  checkDuplicateUser,
  DuplicateUserError,
  createUser,
  generateOtp,
  saveOtp,
  validateOtp,
  countRecentOtps,
} from "./auth.service";
import { query } from "../seyf/db/client";

vi.mock("../seyf/db/client", () => ({
  query: vi.fn(),
}));

describe("auth.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hashes and verifies password", async () => {
    const hash = await hashPassword("mysecret");
    expect(hash).toBeDefined();
    expect(hash).not.toBe("mysecret");
    
    const isValid = await verifyPassword("mysecret", hash);
    expect(isValid).toBe(true);
    
    const isInvalid = await verifyPassword("wrong", hash);
    expect(isInvalid).toBe(false);
  });

  it("checkDuplicateUser throws DuplicateUserError on duplicate phone", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ id: "1", phone: "+521111111111", email: "test@test.com" }] } as any);
    await expect(checkDuplicateUser("+521111111111", "other@test.com")).rejects.toThrow(DuplicateUserError);
    await expect(checkDuplicateUser("+521111111111", "other@test.com")).rejects.toThrow("Phone number is already registered.");
  });

  it("checkDuplicateUser throws DuplicateUserError on duplicate email", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ id: "1", phone: "+521111111111", email: "test@test.com" }] } as any);
    await expect(checkDuplicateUser("+522222222222", "test@test.com")).rejects.toThrow(DuplicateUserError);
    await expect(checkDuplicateUser("+522222222222", "test@test.com")).rejects.toThrow("Email is already registered.");
  });

  it("checkDuplicateUser does not throw if no duplicate", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
    await expect(checkDuplicateUser("+521111111111", "test@test.com")).resolves.not.toThrow();
  });

  it("createUser inserts into users and returns user", async () => {
    const mockUser = { id: "1", name: "Test", phone: "+521111111111", email: "test@test.com", status: "pending_kyc" };
    vi.mocked(query).mockResolvedValueOnce({ rows: [mockUser] } as any);
    
    const user = await createUser({ name: "Test", phone: "+521111111111", email: "test@test.com", password_hash: "hash" });
    expect(query).toHaveBeenCalledWith(expect.any(String), ["Test", "+521111111111", "test@test.com", "hash"]);
    expect(user).toEqual(mockUser);
  });

  it("generateOtp returns a 6-digit string", () => {
    const otp = generateOtp();
    expect(otp).toMatch(/^\d{6}$/);
  });

  it("saveOtp inserts otp code", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
    await saveOtp("+521111111111", "123456");
    expect(query).toHaveBeenCalledWith(expect.any(String), ["+521111111111", "123456", expect.any(Date)]);
  });

  it("validateOtp returns true for valid otp", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ id: "1", expires_at: new Date(Date.now() + 10000), verified: false }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);
      
    const isValid = await validateOtp("+521111111111", "123456");
    expect(isValid).toBe(true);
    expect(query).toHaveBeenCalledTimes(2); // One for select, one for update
  });

  it("validateOtp returns false for expired otp", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: "1", expires_at: new Date(Date.now() - 10000), verified: false }] } as any);
    const isValid = await validateOtp("+521111111111", "123456");
    expect(isValid).toBe(false);
  });

  it("validateOtp returns false if no otp found", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
    const isValid = await validateOtp("+521111111111", "123456");
    expect(isValid).toBe(false);
  });

  it("countRecentOtps returns count", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ count: "3" }] } as any);
    const count = await countRecentOtps("+521111111111", 1);
    expect(count).toBe(3);
  });
});
