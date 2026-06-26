import { describe, expect, it, afterEach } from "vitest";
import { isEtherfuseKycApprovedStatus } from "@/lib/seyf/etherfuse-kyc-guard";

describe("isEtherfuseKycApprovedStatus", () => {
  const originalEnv = process.env.NEXT_PUBLIC_POLLAR_STELLAR_NETWORK;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_POLLAR_STELLAR_NETWORK;
    } else {
      process.env.NEXT_PUBLIC_POLLAR_STELLAR_NETWORK = originalEnv;
    }
  });

  it("accepts approved statuses for ramp operations on mainnet", () => {
    process.env.NEXT_PUBLIC_POLLAR_STELLAR_NETWORK = "mainnet";
    expect(isEtherfuseKycApprovedStatus("approved")).toBe(true);
    expect(isEtherfuseKycApprovedStatus("approved_chain_deploying")).toBe(true);
  });

  it("rejects non-approved statuses for ramp operations on mainnet", () => {
    process.env.NEXT_PUBLIC_POLLAR_STELLAR_NETWORK = "mainnet";
    expect(isEtherfuseKycApprovedStatus("not_started")).toBe(false);
    expect(isEtherfuseKycApprovedStatus("proposed")).toBe(false);
    expect(isEtherfuseKycApprovedStatus("rejected")).toBe(false);
  });

  it("accepts proposed status for ramp operations on testnet", () => {
    process.env.NEXT_PUBLIC_POLLAR_STELLAR_NETWORK = "testnet";
    expect(isEtherfuseKycApprovedStatus("approved")).toBe(true);
    expect(isEtherfuseKycApprovedStatus("approved_chain_deploying")).toBe(true);
    expect(isEtherfuseKycApprovedStatus("proposed")).toBe(true);
    expect(isEtherfuseKycApprovedStatus("not_started")).toBe(false);
    expect(isEtherfuseKycApprovedStatus("rejected")).toBe(false);
  });
});
