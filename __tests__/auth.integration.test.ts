import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as registerHandler } from "@/app/api/auth/register/route";
import { POST as verifyHandler } from "@/app/api/auth/verify-otp/route";
import { POST as resendHandler } from "@/app/api/auth/resend-otp/route";
import { query } from "@/lib/seyf/db/client";
import { getRegistrationData } from "@/lib/services/session.service";

vi.mock("@/lib/seyf/db/client", () => ({
  query: vi.fn(),
}));

vi.mock("@/lib/services/session.service", () => ({
  storeRegistrationData: vi.fn(),
  getRegistrationData: vi.fn(),
  clearRegistrationData: vi.fn(),
}));

vi.mock("twilio", () => ({
  default: () => ({
    messages: {
      create: vi.fn().mockResolvedValue({}),
    },
  }),
}));

describe("Auth API Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createRequest = (body: any) => new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  it("Invalid phone format -> 400", async () => {
    const req = createRequest({ name: "Test", phone: "12345", email: "t@t.com", password: "password123" });
    const res = await registerHandler(req);
    expect(res.status).toBe(400);
  });

  it("Missing required fields -> 400", async () => {
    const req = createRequest({ phone: "+521234567890" });
    const res = await registerHandler(req);
    expect(res.status).toBe(400);
  });

  it("Duplicate phone -> 409", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: "1", phone: "+521234567890", email: "other@t.com" }] } as any);
    const req = createRequest({ name: "Test", phone: "+521234567890", email: "t@t.com", password: "password123" });
    const res = await registerHandler(req);
    expect(res.status).toBe(409);
  });

  it("Wrong OTP code -> 400", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any); // validateOtp returns false
    const req = createRequest({ phone: "+521234567890", code: "000000" });
    const res = await verifyHandler(req);
    expect(res.status).toBe(400);
  });

  it("Resend OTP more than 3 times/hour -> 429", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ count: "3" }] } as any); // countRecentOtps
    const req = createRequest({ phone: "+521234567890" });
    const res = await resendHandler(req);
    expect(res.status).toBe(429);
  });

  it("Duplicate email -> 409", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: "1", phone: "+520987654321", email: "t@t.com" }] } as any);
    const req = createRequest({ name: "Test", phone: "+521234567890", email: "t@t.com", password: "password123" });
    const res = await registerHandler(req);
    expect(res.status).toBe(409);
  });

  it("Expired OTP -> 400", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any); // validateOtp returns false for expired
    const req = createRequest({ phone: "+521234567890", code: "123456" });
    const res = await verifyHandler(req);
    expect(res.status).toBe(400);
  });

  it("Happy path: register -> verify OTP -> get tokens", async () => {
    // 1. Register
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any); // no duplicate user
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any); // insert otp
    
    const regReq = createRequest({ name: "Happy Path", phone: "+525555555555", email: "happy@test.com", password: "password123" });
    const regRes = await registerHandler(regReq);
    expect(regRes.status).toBe(201);
    
    // Mock getRegistrationData
    const sessionModule = await import("@/lib/services/session.service");
    vi.mocked(sessionModule.getRegistrationData).mockResolvedValueOnce({
      name: "Happy Path",
      phone: "+525555555555",
      email: "happy@test.com",
      password_hash: "hash"
    });
    
    // 2. Verify
    process.env.JWT_SECRET = "test-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: "otp-1", expires_at: new Date(Date.now() + 10000).toISOString(), verified: false }] } as any); // valid otp
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any); // update otp verified
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: "user-123", name: "Happy Path", phone: "+525555555555", email: "happy@test.com", status: "pending_kyc" }] } as any); // create user
    
    const verReq = createRequest({ phone: "+525555555555", code: "123456" });
    const verRes = await verifyHandler(verReq);
    expect(verRes.status).toBe(200);
    const body = await verRes.json();
    expect(body).toHaveProperty("accessToken");
    expect(body).toHaveProperty("refreshToken");
    expect(body.user.id).toBe("user-123");
  });
});
