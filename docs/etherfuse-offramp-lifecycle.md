# Etherfuse Off-Ramp Order Lifecycle & Reconciliation Specification

This document specifies the state transitions, user interface mappings, and reconciliation rules for the off-ramp (withdrawal) lifecycle in the Seyf platform.

---

## 1. Off-Ramp State Machine & Mappings

The off-ramp lifecycle manages the process of converting digital assets (e.g. CETES or MXNE on Stellar) back to MXN fiat, delivered to the user's registered bank account via SPEI. 

The table below maps the internal database status, the corresponding provider statuses (Etherfuse), and the Spanish user interface copy.

| Internal Status (`withdrawal.status`) | Etherfuse Order Status (`status`) | UI State Copy (es-MX) | UI Detail Copy (es-MX) | Description |
| :--- | :--- | :--- | :--- | :--- |
| **`pending`** | *N/A* (Before creation or pending submission) | **Pendiente** | Retiro solicitado. Hemos recibido tu solicitud. | Balance is locked and deducted from available funds. |
| **`processing`** | `processing`, `funded` | **Procesando** | Retiro a tu cuenta en pesos. Tiempo estimado: 2 horas en horario hábil. | Order successfully registered on Etherfuse; awaiting outbound SPEI transfer. |
| **`completed`** | `completed`, `success`, `confirmed` | **Completado** | El dinero fue enviado a tu cuenta bancaria. | Terminal success. Funds have cleared SPEI network to user's bank. |
| **`failed`** | `failed`, `canceled`, `cancelled`, `rejected` | **Fallido** | El retiro no pudo completarse. Saldo restaurado. | Terminal failure. Balance is automatically returned to the user's available balance. |

---

## 2. Webhook & Polling Strategy

To ensure consistency and prevent race conditions or double state transitions:
1. **Webhook-First Transition**: Webhook alerts received at `/api/webhooks/etherfuse` act as the primary catalyst.
   - For `processing` / `funded` status, the withdrawal is transitioned to `processing` and provider metadata is appended.
   - For `completed` / `success` / `confirmed` status, it triggers `processCompletedWithdrawal` via a queued event runner.
   - For `failed` / `canceled` / `rejected` status, it triggers `processFailedWithdrawal` via a queued event runner.
2. **Replay Protection**: The `reserveWebhookEvent(eventId)` helper ensures that duplicate webhook requests are discarded.
3. **No Retrograde Transitions**: The state machine asserts strict progression paths (e.g. once `completed` or `failed`, the state cannot be updated back to `processing` or `pending`).

---

## 3. Reconciliation & Alerting Rules

A background reconciliation job (`reconcileWithdrawals` inside `lib/observability/reconciliation.ts`) periodically scans active withdrawals and fetches fresh status directly from the Etherfuse API to resolve discrepancies.

### A. Failure Detection
- **Explicit Failure**: If the provider reports `failed`, `canceled`, or `rejected`, the engine automatically transitions the withdrawal to `failed` and restores the balance to the user.
- **Provider Orphan (404)**: If a withdrawal in `pending` or `processing` state cannot be found in Etherfuse (returning a `404 Not Found`) and is **older than 1 hour**, it is marked as `failed`, the balance is restored, and a `withdrawal_missing_in_provider` critical alert is sent.

### B. Stuck Order Alerts
- **Stuck in Provider**: If a withdrawal remains in the `processing` or `funded` state in Etherfuse for **longer than 4 hours**, it is flagged as stuck, and a `withdrawal_stuck_in_provider` critical alert is dispatched to alerting hooks.

### C. Observability Alerts List
- `withdrawal_failed`: Triggered when an active withdrawal is updated to failed status during reconciliation.
- `withdrawal_missing_in_provider`: Triggered when an active withdrawal is 404'd by the provider after 1 hour.
- `withdrawal_stuck_in_provider`: Triggered when a withdrawal stays in progress for more than 4 hours.
