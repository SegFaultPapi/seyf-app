import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'

export type NotificationUserSettings = {
  userId: string
  phoneNumber: string | null
  smsOptOut: boolean
  pushOptOut: boolean
  fcmToken: string | null
  updatedAt: string
}

type NotificationSettingsFile = {
  users: Record<string, NotificationUserSettings>
}

function settingsPath() {
  return path.join(process.cwd(), 'data', 'seyf-notification-settings.json')
}

async function loadSettings(): Promise<NotificationSettingsFile> {
  try {
    const raw = await readFile(settingsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as NotificationSettingsFile
    if (!parsed || typeof parsed !== 'object' || typeof parsed.users !== 'object') {
      return { users: {} }
    }
    return parsed
  } catch {
    return { users: {} }
  }
}

async function saveSettings(file: NotificationSettingsFile) {
  await mkdir(path.dirname(settingsPath()), { recursive: true })
  await writeFile(settingsPath(), JSON.stringify(file, null, 2), 'utf-8')
}

export function normalizePhoneNumber(input: string | null | undefined): string | null {
  const value = input?.trim()
  if (!value) return null

  const cleaned = value.replace(/[^\d+]/g, '')
  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1).replace(/\D/g, '')
    if (digits.length < 8 || digits.length > 15) return null
    return `+${digits}`
  }

  const digits = cleaned.replace(/\D/g, '')
  if (digits.length === 10) return `+52${digits}`
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`
  return null
}

export async function getUserNotificationSettings(
  userId: string,
): Promise<NotificationUserSettings> {
  const file = await loadSettings()
  const s = file.users[userId]
  return {
    userId,
    phoneNumber: s?.phoneNumber ?? null,
    smsOptOut: s?.smsOptOut ?? false,
    pushOptOut: s?.pushOptOut ?? false,
    fcmToken: s?.fcmToken ?? null,
    updatedAt: s?.updatedAt ?? new Date(0).toISOString(),
  }
}

export async function upsertUserNotificationSettings(input: {
  userId: string
  phoneNumber?: string | null
  smsOptOut?: boolean
  pushOptOut?: boolean
  fcmToken?: string | null
}): Promise<NotificationUserSettings> {
  const file = await loadSettings()
  const existing = await getUserNotificationSettings(input.userId)

  const nextPhoneNumber = (() => {
    if (input.phoneNumber === undefined) return existing.phoneNumber
    if (input.phoneNumber == null || input.phoneNumber.trim() === '') return null

    const normalized = normalizePhoneNumber(input.phoneNumber)
    if (!normalized) {
      throw new Error('Telefono invalido. Usa 10 digitos MX o formato internacional, por ejemplo +525512345678.')
    }
    return normalized
  })()

  const next: NotificationUserSettings = {
    userId: input.userId,
    phoneNumber: nextPhoneNumber,
    smsOptOut: input.smsOptOut ?? existing.smsOptOut,
    pushOptOut: input.pushOptOut ?? existing.pushOptOut,
    fcmToken: input.fcmToken !== undefined ? input.fcmToken : existing.fcmToken,
    updatedAt: new Date().toISOString(),
  }

  file.users[input.userId] = next
  await saveSettings(file)
  return next
}
