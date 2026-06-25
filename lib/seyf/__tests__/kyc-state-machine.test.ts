import { describe, expect, it, vi, beforeEach } from "vitest";
import { 
  validateTransition, 
  getDepositLimit, 
  approveKyc,
  rejectKyc,
  DEPOSIT_LIMIT_APPROVED
} from "../kyc-state-machine";
import * as db from "../db/client";
import { createNotificationService } from "../notifications/notify";

vi.mock("../db/client", () => ({
  query: vi.fn(),
  withActor: vi.fn((actor: string, fn: () => Promise<any>) => fn()),
}));

vi.mock("../notifications/notify", () => ({
  createNotificationService: vi.fn(() => ({
    notifyUser: vi.fn().mockResolvedValue({ ok: true }),
  })),
}));

describe("kyc-state-machine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateTransition", () => {
    it("allows valid transitions", () => {
      expect(() => validateTransition("NOT_SUBMITTED", "KYC_UNDER_REVIEW")).not.toThrow();
      expect(() => validateTransition("KYC_UNDER_REVIEW", "APPROVED")).not.toThrow();
      expect(() => validateTransition("KYC_UNDER_REVIEW", "REJECTED")).not.toThrow();
      expect(() => validateTransition("REJECTED", "KYC_UNDER_REVIEW")).not.toThrow();
    });

    it("throws on invalid transitions", () => {
      expect(() => validateTransition("NOT_SUBMITTED", "APPROVED")).toThrow();
      expect(() => validateTransition("APPROVED", "KYC_UNDER_REVIEW")).toThrow();
    });
  });

  describe("getDepositLimit", () => {
    it("returns correct limits for each status", () => {
      expect(getDepositLimit("APPROVED")).toBe(DEPOSIT_LIMIT_APPROVED);
      expect(getDepositLimit("NOT_SUBMITTED")).toBe(0);
      expect(getDepositLimit("KYC_UNDER_REVIEW")).toBe(0);
      expect(getDepositLimit("REJECTED")).toBe(0);
    });
  });

  describe("approveKyc", () => {
    it("updates user status and deposit limit, records history, and notifies", async () => {
      const userId = "user-123";
      const mockUser = { id: userId, kyc_status: "KYC_UNDER_REVIEW" };
      
      vi.mocked(db.query).mockResolvedValueOnce({ rowCount: 1, rows: [mockUser] } as any);
      vi.mocked(db.query).mockResolvedValueOnce({ rowCount: 1, rows: [{ ...mockUser, kyc_status: "APPROVED", deposit_limit_mxn: 20000 }] } as any);
      vi.mocked(db.query).mockResolvedValueOnce({ rowCount: 1, rows: [] } as any); // History insert

      const result = await approveKyc(userId);

      expect(result.kyc_status).toBe("APPROVED");
      expect(result.deposit_limit_mxn).toBe(20000);
      
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE users"),
        ["APPROVED", 20000, userId]
      );
      
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO kyc_status_history"),
        [userId, "KYC_UNDER_REVIEW", "APPROVED", "admin"]
      );

      const notifyService = createNotificationService();
      expect(notifyService.notifyUser).toHaveBeenCalledWith(userId, "kyc_approved", {
        amountMxn: 20000,
      });
    });

    it("throws if user not found", async () => {
      vi.mocked(db.query).mockResolvedValueOnce({ rowCount: 0, rows: [] } as any);
      await expect(approveKyc("missing")).rejects.toThrow("Usuario no encontrado");
    });
  });

  describe("rejectKyc", () => {
    it("updates user status, records reason, records history, and notifies", async () => {
      const userId = "user-123";
      const rejectionReason = "Documento ilegible";
      const mockUser = { id: userId, kyc_status: "KYC_UNDER_REVIEW" };
      
      vi.mocked(db.query).mockResolvedValueOnce({ rowCount: 1, rows: [mockUser] } as any);
      vi.mocked(db.query).mockResolvedValueOnce({ rowCount: 1, rows: [{ ...mockUser, kyc_status: "REJECTED", kyc_rejection_reason: rejectionReason }] } as any);
      vi.mocked(db.query).mockResolvedValueOnce({ rowCount: 1, rows: [] } as any); // History insert

      const result = await rejectKyc(userId, rejectionReason);

      expect(result.kyc_status).toBe("REJECTED");
      
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE users"),
        ["REJECTED", 0, rejectionReason, userId]
      );
      
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO kyc_status_history"),
        [userId, "KYC_UNDER_REVIEW", "REJECTED", "admin", rejectionReason]
      );

      const notifyService = createNotificationService();
      expect(notifyService.notifyUser).toHaveBeenCalledWith(userId, "kyc_rejected", {
        reason: rejectionReason,
      });
    });
  });
});
