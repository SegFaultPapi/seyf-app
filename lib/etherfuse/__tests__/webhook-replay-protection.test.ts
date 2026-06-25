import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock("@/lib/seyf/db/client", () => ({
  query: queryMock,
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe("reserveWebhookEvent", () => {
  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
  });

  it("reserves a new webhook id atomically", async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 3, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "row_1" }] });

    const { reserveWebhookEvent } = await import("../../webhooks/replay-protection");
    const result = await reserveWebhookEvent("evt_1", "kyc_updated");

    expect(result).toEqual({ ok: true, reserved: true });
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[1][0]).toContain("on conflict (event_id) do nothing");
  });

  it("returns reserved false for duplicate webhook ids", async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const { reserveWebhookEvent } = await import("../../webhooks/replay-protection");
    const result = await reserveWebhookEvent("evt_1", "kyc_updated");

    expect(result).toEqual({ ok: true, reserved: false });
  });

  it("fails closed when the replay store is unavailable", async () => {
    queryMock.mockRejectedValueOnce(new Error("database down"));

    const { reserveWebhookEvent } = await import("../../webhooks/replay-protection");
    const result = await reserveWebhookEvent("evt_1", "kyc_updated");

    expect(result).toEqual({ ok: false, error: "database down" });
  });
});
