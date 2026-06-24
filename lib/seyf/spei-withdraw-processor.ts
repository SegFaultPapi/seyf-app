import { processCompletedWithdrawal, processFailedWithdrawal, markWebhookEventProcessed } from "./withdrawal-service";
import { notifyUser } from "./notifications/notify";
import { sendAlert, AlertSeverity } from "@/lib/observability/alerts";
import { logger } from "@/lib/observability/logger";

export type SpeiWithdrawEvent = {
  eventId: string;
  withdrawalId: string;
  userId: string;
  status: "completed" | "failed";
  amountMxn: number;
  reason?: string;
  destinationLabel?: string;
};

type WithdrawProcessorStore = {
  queuedEventIds: Set<string>;
  jobs: SpeiWithdrawEvent[];
  running: boolean;
};

function store(): WithdrawProcessorStore {
  const g = globalThis as unknown as {
    __seyfWithdrawProcessorStore?: WithdrawProcessorStore;
  };

  g.__seyfWithdrawProcessorStore ??= {
    queuedEventIds: new Set(),
    jobs: [],
    running: false,
  };

  return g.__seyfWithdrawProcessorStore;
}

async function runWorkerLoop() {
  const s = store();
  if (s.running) return;
  s.running = true;

  try {
    while (s.jobs.length > 0) {
      const event = s.jobs.shift()!;
      await processEvent(event);
    }
  } finally {
    s.running = false;
  }
}

async function processEvent(event: SpeiWithdrawEvent) {
  const actor = "webhook:spei-outbound";

  logger.info(
    { eventId: event.eventId, withdrawalId: event.withdrawalId, status: event.status },
    "Processing SPEI outbound webhook event",
  );

  try {
    if (event.status === "completed") {
      const result = await processCompletedWithdrawal(event.withdrawalId, actor);

      if (!result.ok) {
        logger.error(
          { withdrawalId: event.withdrawalId, eventId: event.eventId },
          "Failed to process completed withdrawal",
        );
        return;
      }

      if (result.withdrawal?.status === "completed") {
        void notifyUser(event.userId, "withdrawal_completed", {
          withdrawalId: event.withdrawalId,
          amountMxn: event.amountMxn,
          destinationLabel: event.destinationLabel,
        }).catch((error) => {
          logger.error(
            { withdrawalId: event.withdrawalId, userId: event.userId, error: String(error) },
            "withdrawal_completed notification failed",
          );
        });
      }
    } else if (event.status === "failed") {
      const result = await processFailedWithdrawal(
        event.withdrawalId,
        event.reason ?? "Error del proveedor SPEI",
        actor,
      );

      if (!result.ok) {
        logger.error(
          { withdrawalId: event.withdrawalId, eventId: event.eventId },
          "Failed to process failed withdrawal",
        );
        return;
      }

      if (result.withdrawal?.status === "failed") {
        void notifyUser(event.userId, "withdrawal_failed", {
          withdrawalId: event.withdrawalId,
          amountMxn: event.amountMxn,
          reason: event.reason,
        }).catch((error) => {
          logger.error(
            { withdrawalId: event.withdrawalId, userId: event.userId, error: String(error) },
            "withdrawal_failed notification failed",
          );
        });

        void sendAlert({
          alert: "withdrawal_failed",
          severity: AlertSeverity.CRITICAL,
          message: `Retiro ${event.withdrawalId} falló: ${event.reason ?? "Error SPEI"}. Balance restaurado: $${result.restoredAmount} MXN`,
          details: {
            withdrawalId: event.withdrawalId,
            userId: event.userId,
            amountMxn: event.amountMxn,
            reason: event.reason,
            restoredAmount: result.restoredAmount,
          },
          timestamp: new Date().toISOString(),
        });
      }
    }

    await markWebhookEventProcessed(event.eventId, `spei-outbound:${event.status}`, event.withdrawalId);
  } catch (error) {
    logger.error(
      { eventId: event.eventId, withdrawalId: event.withdrawalId, error: String(error) },
      "SPEI webhook event processing crashed",
    );
  }
}

export async function enqueueSpeiWithdrawEvent(event: SpeiWithdrawEvent) {
  const s = store();

  if (s.queuedEventIds.has(event.eventId)) return;

  s.queuedEventIds.add(event.eventId);
  s.jobs.push(event);

  void runWorkerLoop().catch((error) => {
    logger.error(
      { eventId: event.eventId },
      "SPEI withdraw worker loop crashed",
    );
  });
}
