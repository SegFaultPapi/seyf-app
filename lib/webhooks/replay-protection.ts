import { query } from "@/lib/seyf/db/client";
import { logger } from "@/lib/observability/logger";

export const WEBHOOK_REPLAY_RETENTION_DAYS = 30;

export type WebhookReplayReservation =
  | { ok: true; reserved: true }
  | { ok: true; reserved: false }
  | { ok: false; error: string };

export async function pruneExpiredWebhookEvents(
  retentionDays = WEBHOOK_REPLAY_RETENTION_DAYS,
): Promise<void> {
  await query(
    `delete from processed_webhook_events
     where created_at < now() - ($1::int * interval '1 day')`,
    [retentionDays],
  );
}

/**
 * Atomically reserves a webhook event id before side effects run.
 *
 * The unique index on processed_webhook_events.event_id makes concurrent
 * duplicate deliveries collapse to one winner. Rows are retained for 30 days
 * by default, with opportunistic pruning on new webhook ingress.
 */
export async function reserveWebhookEvent(
  eventId: string,
  eventType: string,
  withdrawalId: string | null = null,
): Promise<WebhookReplayReservation> {
  try {
    await pruneExpiredWebhookEvents();

    const result = await query<{ id: string }>(
      `insert into processed_webhook_events (event_id, event_type, withdrawal_id)
       values ($1, $2, $3)
       on conflict (event_id) do nothing
       returning id`,
      [eventId, eventType, withdrawalId],
    );

    return { ok: true, reserved: result.rowCount === 1 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { eventId, eventType, withdrawalId, error: message },
      "Failed to reserve webhook event id",
    );
    return { ok: false, error: message };
  }
}
