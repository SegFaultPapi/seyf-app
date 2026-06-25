import { appendNotificationLog } from './notification-log.ts'
import { sendTwilioSms, type SmsSendInput, type SmsSendResult } from './twilio-sms.ts'
import { getUserNotificationSettings } from './user-settings.ts'
import type {
  NotificationEvent,
  NotificationLogEntry,
  NotificationPayload,
  NotificationPayloadFor,
  NotificationSkipReason,
} from './types.ts'

type UserSettings = Awaited<ReturnType<typeof getUserNotificationSettings>>

type AppendLogInput = Omit<NotificationLogEntry, 'id' | 'createdAt'>

type NotificationServiceDeps = {
  getUserSettings?: (userId: string) => Promise<UserSettings>
  appendLog?: (entry: AppendLogInput) => Promise<NotificationLogEntry>
  sendSms?: (input: SmsSendInput) => Promise<SmsSendResult>
  now?: () => Date
}

export type NotifyUserResult = {
  ok: boolean
  status: 'sent' | 'failed' | 'skipped'
  event: NotificationEvent
  attempts: number
  phoneNumber: string | null
  body: string
  reason?: NotificationSkipReason | 'delivery_failed'
  lastError?: string | null
  providerMessageId?: string | null
}

function formatCurrencyMxn(amount: number | undefined): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 2,
  }).format(amount)
}

export function buildSmsCopy<E extends NotificationEvent>(
  event: E,
  data: NotificationPayloadFor<E>,
): string {
  const d = data as any
  switch (event) {
    case 'deposit_deployed': {
      const amount = formatCurrencyMxn(d.amountMxn)
      const instrument = d.instrumentLabel?.trim() || 'tu estrategia'
      return amount
        ? `Tu capital ya esta trabajando. Desplegamos ${amount} en ${instrument} y ya lo puedes seguir en Seyf.`
        : `Tu capital ya esta trabajando. Ya desplegamos tu deposito en ${instrument} y puedes seguirlo en Seyf.`
    }
    case 'advance_confirmed': {
      const amount = formatCurrencyMxn(d.amountMxn)
      return amount
        ? `Tu adelanto por ${amount} ya quedo confirmado. Ya lo tienes listo para usar en Seyf.`
        : 'Tu adelanto ya quedo confirmado. Ya lo tienes listo para usar en Seyf.'
    }
    case 'withdrawal_completed': {
      const amount = formatCurrencyMxn(d.amountMxn)
      const destination = d.destinationLabel?.trim()
      return amount
        ? `Tu retiro por ${amount} ya quedo completado${destination ? ` hacia ${destination}` : ''}. Gracias por mover tu dinero con Seyf.`
        : `Tu retiro ya quedo completado${destination ? ` hacia ${destination}` : ''}. Gracias por mover tu dinero con Seyf.`
    }
    case 'withdrawal_failed': {
      const amount = formatCurrencyMxn(d.amountMxn)
      const reason = d.reason?.trim()
      return `${amount ? `No pudimos completar tu retiro por ${amount}.` : 'No pudimos completar tu retiro.'} Tu dinero sigue protegido.${reason ? ` Revisa: ${reason}.` : ''} Vuelve a intentarlo desde Seyf.`
    }
    case 'kyc_approved': {
      const limit = formatCurrencyMxn(d.amountMxn) || '$20,000 MXN'
      return `Tu cuenta está verificada. Ya puedes depositar hasta ${limit}.`
    }
    case 'kyc_rejected':
      return `Tu verificacion necesita otro intento.${d.reason?.trim() ? ` Revisa: ${d.reason.trim()}.` : ''} Corrige tus datos y vuelve a intentarlo en Seyf.`
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}

export function createNotificationService(deps: NotificationServiceDeps = {}) {
  const getUserSettings = deps.getUserSettings ?? getUserNotificationSettings
  const appendLog = deps.appendLog ?? appendNotificationLog
  const sendSms = deps.sendSms ?? sendTwilioSms
  const now = deps.now ?? (() => new Date())

  async function logSkipped(
    userId: string,
    event: NotificationEvent,
    payload: NotificationPayload,
    body: string,
    phoneNumber: string | null,
    reason: NotificationSkipReason,
  ) {
    await appendLog({
      userId,
      channel: 'sms',
      event,
      status: 'skipped',
      attempt: 0,
      provider: 'twilio',
      phoneNumber,
      payloadJson: payload,
      sentAt: null,
      error: reason,
      providerMessageId: null,
    })

    return {
      ok: false,
      status: 'skipped' as const,
      event,
      attempts: 0,
      phoneNumber,
      body,
      reason,
      lastError: null,
      providerMessageId: null,
    }
  }

  async function notifyUser<E extends NotificationEvent>(
    userId: string,
    event: E,
    data: NotificationPayloadFor<E>,
  ): Promise<NotifyUserResult> {
    const payload = data as NotificationPayload
    const body = buildSmsCopy(event, data)
    const settings = await getUserSettings(userId)

    if (settings.smsOptOut) {
      return logSkipped(userId, event, payload, body, settings.phoneNumber, 'opted_out')
    }

    if (!settings.phoneNumber) {
      return logSkipped(userId, event, payload, body, null, 'missing_phone')
    }

    let lastError: string | null = null

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const sent = await sendSms({
          to: settings.phoneNumber,
          body,
        })
        await appendLog({
          userId,
          channel: 'sms',
          event,
          status: 'sent',
          attempt,
          provider: 'twilio',
          phoneNumber: settings.phoneNumber,
          payloadJson: payload,
          sentAt: now().toISOString(),
          error: null,
          providerMessageId: sent.providerMessageId,
        })
        return {
          ok: true,
          status: 'sent',
          event,
          attempts: attempt,
          phoneNumber: settings.phoneNumber,
          body,
          lastError: null,
          providerMessageId: sent.providerMessageId,
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'SMS delivery failed'
        await appendLog({
          userId,
          channel: 'sms',
          event,
          status: 'failed',
          attempt,
          provider: 'twilio',
          phoneNumber: settings.phoneNumber,
          payloadJson: payload,
          sentAt: null,
          error: lastError,
          providerMessageId: null,
        })
      }
    }

    return {
      ok: false,
      status: 'failed',
      event,
      attempts: 2,
      phoneNumber: settings.phoneNumber,
      body,
      reason: 'delivery_failed',
      lastError,
      providerMessageId: null,
    }
  }

  return {
    notifyUser,
  }
}

export const { notifyUser } = createNotificationService()
