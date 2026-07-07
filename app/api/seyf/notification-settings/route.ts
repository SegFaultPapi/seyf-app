import { NextResponse } from 'next/server'
import { z } from 'zod'
import { POC_USER_COOKIE, getOrCreatePocUserId } from '@/lib/seyf/poc-user-cookie'
import {
  getUserNotificationSettings,
  upsertUserNotificationSettings,
} from '@/lib/seyf/notifications/user-settings'

export const runtime = 'nodejs'

function cookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  }
}

const bodySchema = z.object({
  phoneNumber: z.string().trim().max(32).nullable().optional(),
  smsEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  fcmToken: z.string().trim().nullable().optional(),
})

export async function GET() {
  const { userId, isNew } = await getOrCreatePocUserId()
  const settings = await getUserNotificationSettings(userId)
  const res = NextResponse.json({
    userId,
    settings: {
      phoneNumber: settings.phoneNumber,
      smsEnabled: !settings.smsOptOut,
      pushEnabled: !settings.pushOptOut,
      fcmToken: settings.fcmToken,
      updatedAt: settings.updatedAt,
    },
  })
  if (isNew) {
    res.cookies.set(POC_USER_COOKIE, userId, cookieOptions())
  }
  return res
}

export async function POST(req: Request) {
  const { userId, isNew } = await getOrCreatePocUserId()

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  let next
  try {
    next = await upsertUserNotificationSettings({
      userId,
      phoneNumber: parsed.data.phoneNumber,
      smsOptOut:
        parsed.data.smsEnabled === undefined ? undefined : !parsed.data.smsEnabled,
      pushOptOut:
        parsed.data.pushEnabled === undefined ? undefined : !parsed.data.pushEnabled,
      fcmToken: parsed.data.fcmToken,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'No se pudo guardar la configuracion.',
      },
      { status: 400 },
    )
  }

  const res = NextResponse.json({
    ok: true,
    userId,
    settings: {
      phoneNumber: next.phoneNumber,
      smsEnabled: !next.smsOptOut,
      pushEnabled: !next.pushOptOut,
      fcmToken: next.fcmToken,
      updatedAt: next.updatedAt,
    },
  })

  if (isNew) {
    res.cookies.set(POC_USER_COOKIE, userId, cookieOptions())
  }

  return res
}
