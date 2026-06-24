import type { TransactionEntityType, TransactionStatus } from "./types";

type TransitionMap = Record<string, readonly TransactionStatus[]>;

const DEPOSIT_TRANSITIONS: TransitionMap = {
  pending: ["completed", "failed"],
};

const WITHDRAWAL_TRANSITIONS: TransitionMap = {
  pending: ["processing", "completed", "failed"],
  processing: ["completed", "failed"],
};

const ADVANCE_TRANSITIONS: TransitionMap = {
  pending: ["completed", "failed"],
  completed: ["liquidated"],
};

const TRANSITIONS: Record<TransactionEntityType, TransitionMap> = {
  deposit: DEPOSIT_TRANSITIONS,
  advance: ADVANCE_TRANSITIONS,
  withdrawal: WITHDRAWAL_TRANSITIONS,
};

const TERMINAL_STATUSES: Record<TransactionEntityType, readonly TransactionStatus[]> = {
  deposit: ["completed", "failed"],
  advance: ["failed", "liquidated"],
  withdrawal: ["completed", "failed"],
};

export function isValidTransactionTransition(
  entityType: TransactionEntityType,
  fromStatus: TransactionStatus | null,
  toStatus: TransactionStatus,
): boolean {
  if (fromStatus === null) {
    return ["pending", "completed", "failed", "liquidated"].includes(toStatus);
  }

  if (fromStatus === toStatus) {
    return true;
  }

  const allowed = TRANSITIONS[entityType][fromStatus] ?? [];
  return allowed.includes(toStatus);
}

export function isTerminalStatus(
  entityType: TransactionEntityType,
  status: TransactionStatus,
): boolean {
  return TERMINAL_STATUSES[entityType].includes(status);
}

export function assertValidTransactionTransition(
  entityType: TransactionEntityType,
  fromStatus: TransactionStatus | null,
  toStatus: TransactionStatus,
): void {
  if (!isValidTransactionTransition(entityType, fromStatus, toStatus)) {
    const fromLabel = fromStatus ?? "null";
    throw new Error(
      `Invalid status transition for ${entityType}: ${fromLabel} -> ${toStatus}`,
    );
  }
}
