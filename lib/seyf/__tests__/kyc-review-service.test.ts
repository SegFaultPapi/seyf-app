import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  approveKycCase,
  rejectKycCase,
  listKycCases,
  listKycAuditLog,
} from "../kyc-review-service";
import { query } from "@/lib/seyf/db/client";
import {
  getStoredKycSnapshot,
  listStoredKycRows,
  upsertStoredKycSnapshot,
} from "@/lib/seyf/kyc-state-store";

vi.mock("@/lib/seyf/db/client", () => ({
  query: vi.fn(),
}));

vi.mock("@/lib/seyf/kyc-state-store", () => ({
  getStoredKycSnapshot: vi.fn(),
  listStoredKycRows: vi.fn(),
  upsertStoredKycSnapshot: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("kyc-review-service", () => {
  describe("listKycCases", () => {
    it("lists and filters cases correctly, sorted newest first", async () => {
      const mockRows = [
        {
          customerId: "c1",
          walletPublicKey: "w1",
          status: "proposed" as const,
          approvedAt: null,
          currentRejectionReason: null,
          updatedAt: "2026-06-24T10:00:00.000Z",
        },
        {
          customerId: "c2",
          walletPublicKey: "w2",
          status: "approved" as const,
          approvedAt: "2026-06-24T11:00:00.000Z",
          currentRejectionReason: null,
          updatedAt: "2026-06-24T11:00:00.000Z",
        },
      ];

      vi.mocked(listStoredKycRows).mockResolvedValue(mockRows);

      const allResult = await listKycCases();
      expect(allResult).toHaveLength(2);
      expect(allResult[0].customerId).toBe("c2"); // sorted newest first

      const filteredResult = await listKycCases({ status: "proposed" });
      expect(filteredResult).toHaveLength(1);
      expect(filteredResult[0].customerId).toBe("c1");
    });
  });

  describe("approveKycCase", () => {
    it("successfully approves a pending KYC case", async () => {
      vi.mocked(getStoredKycSnapshot).mockResolvedValue({
        customerId: "c1",
        walletPublicKey: "w1",
        status: "proposed",
        approvedAt: null,
        currentRejectionReason: null,
        verifiedProfile: null,
        documentsCount: 0,
        selfiesCount: 0,
      });

      vi.mocked(upsertStoredKycSnapshot).mockResolvedValue({ updated: true });
      vi.mocked(query).mockResolvedValue({ rows: [] } as any);

      const result = await approveKycCase({
        customerId: "c1",
        walletPublicKey: "w1",
        actor: "admin1",
        note: "looks good",
      });

      expect(result).toEqual({ ok: true, fromStatus: "proposed" });
      expect(upsertStoredKycSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: "c1",
          walletPublicKey: "w1",
          status: "approved",
        })
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("insert into kyc_review_audit_log"),
        expect.arrayContaining(["admin1", "approve", "c1", "w1", "proposed", "approved", "looks good"])
      );
    });

    it("returns error if already approved", async () => {
      vi.mocked(getStoredKycSnapshot).mockResolvedValue({
        customerId: "c1",
        walletPublicKey: "w1",
        status: "approved",
        approvedAt: "2026-06-24T10:00:00.000Z",
        currentRejectionReason: null,
        verifiedProfile: null,
        documentsCount: 0,
        selfiesCount: 0,
      });

      const result = await approveKycCase({
        customerId: "c1",
        walletPublicKey: "w1",
        actor: "admin1",
      });

      expect(result.ok).toBe(false);
      expect(upsertStoredKycSnapshot).not.toHaveBeenCalled();
    });
  });

  describe("rejectKycCase", () => {
    it("successfully rejects a KYC case", async () => {
      vi.mocked(getStoredKycSnapshot).mockResolvedValue({
        customerId: "c1",
        walletPublicKey: "w1",
        status: "proposed",
        approvedAt: null,
        currentRejectionReason: null,
        verifiedProfile: null,
        documentsCount: 0,
        selfiesCount: 0,
      });

      vi.mocked(upsertStoredKycSnapshot).mockResolvedValue({ updated: true });
      vi.mocked(query).mockResolvedValue({ rows: [] } as any);

      const result = await rejectKycCase({
        customerId: "c1",
        walletPublicKey: "w1",
        actor: "admin1",
        rejectionReason: "bad selfie",
        note: "please re-take selfie",
      });

      expect(result).toEqual({ ok: true, fromStatus: "proposed" });
      expect(upsertStoredKycSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: "c1",
          walletPublicKey: "w1",
          status: "rejected",
          currentRejectionReason: "bad selfie",
        })
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("insert into kyc_review_audit_log"),
        expect.arrayContaining(["admin1", "reject", "c1", "w1", "proposed", "rejected", "please re-take selfie"])
      );
    });
  });

  describe("listKycAuditLog", () => {
    it("queries database and formats results", async () => {
      const mockDbRows = [
        {
          id: "uuid-1",
          actor: "admin1",
          action: "approve",
          target_customer_id: "c1",
          target_wallet_public_key: "w1",
          from_status: "proposed",
          to_status: "approved",
          note: "approved manually",
          created_at: new Date("2026-06-24T12:00:00.000Z"),
        },
      ];

      vi.mocked(query).mockResolvedValue({ rows: mockDbRows } as any);

      const result = await listKycAuditLog({ customerId: "c1", limit: 10 });
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "uuid-1",
        actor: "admin1",
        action: "approve",
        target_customer_id: "c1",
        target_wallet_public_key: "w1",
        from_status: "proposed",
        to_status: "approved",
        note: "approved manually",
        created_at: "2026-06-24T12:00:00.000Z",
      });
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("where target_customer_id = $1"),
        ["c1", 10]
      );
    });
  });
});
