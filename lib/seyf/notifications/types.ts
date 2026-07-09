export const notificationEvents = [
  'deposit_deployed',
  'advance_confirmed',
  'withdrawal_completed',
  'withdrawal_failed',
  'kyc_approved',
  'kyc_rejected',
] as const

export type NotificationEvent = (typeof notificationEvents)[number]

export type NotificationPayloadMap = {
  deposit_deployed: {
    depositId?: string
    amountMxn?: number
    instrumentLabel?: string
  }
  advance_confirmed: {
    advanceId?: string
    amountMxn?: number
  }
  withdrawal_completed: {
    withdrawalId?: string
    amountMxn?: number
    destinationLabel?: string
  }
  withdrawal_failed: {
    withdrawalId?: string
    amountMxn?: number
    reason?: string
  }
  kyc_approved: {
    approvedAt?: string
  }
  kyc_rejected: {
    reason?: string
  }
}

export type NotificationPayloadFor<E extends NotificationEvent> = NotificationPayloadMap[E]

export type NotificationPayload = NotificationPayloadMap[NotificationEvent]

export type NotificationChannel = 'sms' | 'push'

export type NotificationLogStatus = 'sent' | 'failed' | 'skipped'

export type NotificationSkipReason = 'opted_out' | 'missing_phone' | 'missing_push_token'

export type NotificationLogEntry = {
  id: string
  userId: string
  channel: NotificationChannel
  event: NotificationEvent
  status: NotificationLogStatus
  attempt: number
  provider: 'twilio' | 'fcm'
  phoneNumber: string | null
  payloadJson: NotificationPayload
  sentAt: string | null
  error: string | null
  providerMessageId: string | null
  createdAt: string
}

export function isNotificationEvent(value: string): value is NotificationEvent {
  return notificationEvents.includes(value as NotificationEvent)
}
