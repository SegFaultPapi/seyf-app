import { describe, expect, it } from "vitest";
import { getTransactionTypeLabel } from "../labels";
import {
  assertValidTransactionTransition,
  isTerminalStatus,
  isValidTransactionTransition,
} from "../state-machine";

describe("transaction state machine", () => {
  it("allows deposit pending -> completed and pending -> failed", () => {
    expect(isValidTransactionTransition("deposit", "pending", "completed")).toBe(true);
    expect(isValidTransactionTransition("deposit", "pending", "failed")).toBe(true);
  });

  it("rejects invalid deposit transitions", () => {
    expect(isValidTransactionTransition("deposit", "completed", "pending")).toBe(false);
    expect(isValidTransactionTransition("deposit", "failed", "pending")).toBe(false);
  });

  it("allows advance completed -> liquidated", () => {
    expect(isValidTransactionTransition("advance", "completed", "liquidated")).toBe(true);
    expect(isValidTransactionTransition("advance", "pending", "completed")).toBe(true);
  });

  it("rejects invalid advance transitions", () => {
    expect(isValidTransactionTransition("advance", "pending", "liquidated")).toBe(false);
    expect(isValidTransactionTransition("advance", "liquidated", "completed")).toBe(false);
  });

  it("allows withdrawal pending transitions", () => {
    expect(isValidTransactionTransition("withdrawal", "pending", "processing")).toBe(true);
    expect(isValidTransactionTransition("withdrawal", "pending", "completed")).toBe(true);
    expect(isValidTransactionTransition("withdrawal", "pending", "failed")).toBe(true);
  });

  it("allows withdrawal processing terminal transitions", () => {
    expect(isValidTransactionTransition("withdrawal", "processing", "completed")).toBe(true);
    expect(isValidTransactionTransition("withdrawal", "processing", "failed")).toBe(true);
  });

  it("rejects withdrawal processing -> pending", () => {
    expect(isValidTransactionTransition("withdrawal", "processing", "pending")).toBe(false);
  });

  it("marks terminal statuses correctly", () => {
    expect(isTerminalStatus("deposit", "completed")).toBe(true);
    expect(isTerminalStatus("advance", "liquidated")).toBe(true);
    expect(isTerminalStatus("advance", "completed")).toBe(false);
  });

  it("throws on invalid transitions", () => {
    expect(() =>
      assertValidTransactionTransition("withdrawal", "completed", "pending"),
    ).toThrow(/Invalid status transition/);
  });
});

describe("transaction labels", () => {
  it("returns Spanish labels for display types", () => {
    expect(getTransactionTypeLabel("deposit")).toBe("Depósito");
    expect(getTransactionTypeLabel("advance")).toBe("Adelanto");
    expect(getTransactionTypeLabel("withdrawal")).toBe("Retiro");
    expect(getTransactionTypeLabel("yield")).toBe("Rendimiento");
  });
});
