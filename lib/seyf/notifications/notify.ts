import crypto from 'node:crypto'
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

export type PushSendInput = {
  token: string
  title: string
  body: string
  data?: Record<string, string>
}

export type PushSendResult = {
  providerMessageId: string | null
}

type NotificationServiceDeps = {
  getUserSettings?: (userId: string) => Promise<UserSettings>
  appendLog?: (entry: AppendLogInput) => Promise<NotificationLogEntry>
  sendSms?: (input: SmsSendInput) => Promise<SmsSendResult>
  sendPush?: (input: PushSendInput) => Promise<PushSendResult>
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

export function buildPushTitle(event: NotificationEvent): string {
  switch (event) {
    case 'deposit_deployed':
      return '¡Depósito exitoso!'
    case 'advance_confirmed':
      return 'Adelanto confirmado'
    case 'withdrawal_completed':
      return 'Retiro completado'
    case 'withdrawal_failed':
      return 'Problema con tu retiro'
    case 'kyc_approved':
      return 'Identidad verificada'
    case 'kyc_rejected':
      return 'Verificación rechazada'
    default:
      return 'Seyf App'
  }
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

async function getGoogleAccessToken(serviceAccount: {
  project_id: string
  client_email: string
  private_key: string
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const claim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }

  const header = { alg: 'RS256', typ: 'JWT' }
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url')
  const encodedPayload = Buffer.from(JSON.stringify(claim)).toString('base64url')
  
  const signInput = `${encodedHeader}.${encodedPayload}`
  const signature = crypto.sign('sha256', Buffer.from(signInput), serviceAccount.private_key)
  const encodedSignature = signature.toString('base64url')
  const assertion = `${signInput}.${encodedSignature}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  })

  if (!res.ok) {
    throw new Error(`Google OAuth token exchange failed: ${res.status} ${await res.text()}`)
  }

  const data = await res.json()
  return data.access_token
}

export async function sendFcmPush(input: PushSendInput): Promise<PushSendResult> {
  let sa: any = null
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    } catch {
      // ignore
    }
  } else if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    sa = {
      project_id: process.env.FIREBASE_PROJECT_ID,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    }
  }

  if (!sa || !sa.project_id || !sa.client_email || !sa.private_key) {
    console.log(`[FCM Server Mock] Sending Push notification:
      To: ${input.token}
      Title: ${input.title}
      Body: ${input.body}
      Data: ${JSON.stringify(input.data || {})}`)
    return { providerMessageId: 'mock-fcm-msg-' + Math.random().toString(36).substring(2, 10) }
  }

  const accessToken = await getGoogleAccessToken(sa)
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`

  const payload = {
    message: {
      token: input.token,
      notification: {
        title: input.title,
        body: input.body
      },
      data: input.data || {}
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  if (!res.ok) {
    throw new Error(`FCM push send failed: ${res.status} ${await res.text()}`)
  }

  const resData = await res.json()
  const parts = resData.name?.split('/')
  const messageId = parts ? parts[parts.length - 1] : null
  return { providerMessageId: messageId }
}

export function createNotificationService(deps: NotificationServiceDeps = {}) {
  const getUserSettings = deps.getUserSettings ?? getUserNotificationSettings
  const appendLog = deps.appendLog ?? appendNotificationLog
  const sendSms = deps.sendSms ?? sendTwilioSms
  const sendPush = deps.sendPush ?? sendFcmPush
  const now = deps.now ?? (() => new Date())

  async function notifyUser<E extends NotificationEvent>(
    userId: string,
    event: E,
    data: NotificationPayloadFor<E>,
  ): Promise<NotifyUserResult> {
    const payload = data as NotificationPayload
    const body = buildSmsCopy(event, data)
    const title = buildPushTitle(event)
    const settings = await getUserSettings(userId)

    const fcmData: Record<string, string> = {}
    if (data) {
      for (const [key, val] of Object.entries(data)) {
        if (val !== undefined && val !== null) {
          fcmData[key] = typeof val === 'object' ? JSON.stringify(val) : String(val)
        }
      }
    }

    if (!settings.phoneNumber && !settings.fcmToken) {
      await appendLog({
        userId,
        channel: 'sms',
        event,
        status: 'skipped',
        attempt: 0,
        provider: 'twilio',
        phoneNumber: null,
        payloadJson: payload,
        sentAt: null,
        error: 'missing_phone',
        providerMessageId: null,
      })
      return {
        ok: false,
        status: 'skipped',
        event,
        attempts: 0,
        phoneNumber: null,
        body,
        reason: 'missing_phone',
        lastError: null,
        providerMessageId: null,
      }
    }

    let smsSent = false
    let pushSent = false
    let attempts = 0
    let lastError: string | null = null
    let providerMessageId: string | null = null

    // 1. Deliver via SMS
    if (settings.phoneNumber) {
      if (settings.smsOptOut) {
        await appendLog({
          userId,
          channel: 'sms',
          event,
          status: 'skipped',
          attempt: 0,
          provider: 'twilio',
          phoneNumber: settings.phoneNumber,
          payloadJson: payload,
          sentAt: null,
          error: 'opted_out',
          providerMessageId: null,
        })
      } else {
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          attempts += 1
          try {
            const sent = await sendSms({
              to: settings.phoneNumber,
              body,
            })
            smsSent = true
            providerMessageId = sent.providerMessageId
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
            break
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
      }
    }

    // 2. Deliver via Push
    if (settings.fcmToken) {
      if (settings.pushOptOut) {
        await appendLog({
          userId,
          channel: 'push',
          event,
          status: 'skipped',
          attempt: 0,
          provider: 'fcm',
          phoneNumber: null,
          payloadJson: payload,
          sentAt: null,
          error: 'opted_out',
          providerMessageId: null,
        })
      } else {
        attempts += 1
        try {
          const sent = await sendPush({
            token: settings.fcmToken,
            title,
            body,
            data: fcmData
          })
          pushSent = true
          providerMessageId = sent.providerMessageId || providerMessageId
          await appendLog({
            userId,
            channel: 'push',
            event,
            status: 'sent',
            attempt: 1,
            provider: 'fcm',
            phoneNumber: null,
            payloadJson: payload,
            sentAt: now().toISOString(),
            error: null,
            providerMessageId: sent.providerMessageId,
          })
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'Push delivery failed'
          await appendLog({
            userId,
            channel: 'push',
            event,
            status: 'failed',
            attempt: 1,
            provider: 'fcm',
            phoneNumber: null,
            payloadJson: payload,
            sentAt: null,
            error: lastError,
            providerMessageId: null,
          })
        }
      }
    }

    let ok = false
    let status: 'sent' | 'failed' | 'skipped' = 'skipped'

    if (smsSent || pushSent) {
      ok = true
      status = 'sent'
    } else if (
      (settings.phoneNumber && !settings.smsOptOut) ||
      (settings.fcmToken && !settings.pushOptOut)
    ) {
      status = 'failed'
    } else {
      status = 'skipped'
    }

    return {
      ok,
      status,
      event,
      attempts,
      phoneNumber: settings.phoneNumber,
      body,
      reason: !ok ? (lastError ? 'delivery_failed' : 'opted_out') : undefined,
      lastError,
      providerMessageId,
    }
  }

  return {
    notifyUser,
  }
}

export const { notifyUser } = createNotificationService()
