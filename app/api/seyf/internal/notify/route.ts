import { NextResponse } from 'next/server'
import { z } from 'zod'
import { notifyUser } from '@/lib/seyf/notifications/notify'
import { notificationEvents } from '@/lib/seyf/notifications/types'
import { withLogging } from '@/lib/observability/with-logging'

export const runtime = 'nodejs'

const bodySchema = z.object({
  userId: z.string().min(1),
  event: z.enum(notificationEvents),
  data: z.record(z.string(), z.unknown()).optional().default({}),
})

function guardInternalSecret(req: Request): NextResponse | null {
  const configured = process.env.SEYF_INTERNAL_NOTIFY_SECRET?.trim()
  if (!configured) {
    return process.env.NODE_ENV === 'production'
      ? NextResponse.json(
          { error: 'SEYF_INTERNAL_NOTIFY_SECRET no configurado' },
          { status: 503 },
        )
      : null
  }

  const provided = req.headers.get('x-seyf-internal-secret')?.trim()
  if (provided !== configured) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}

async function handlePost(req: Request, _context: { params: Promise<Record<string, string | string[]>> }) {
  const denied = guardInternalSecret(req)
  if (denied) return denied

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

  const result = await notifyUser(
    parsed.data.userId,
    parsed.data.event,
    parsed.data.data,
  )

  return NextResponse.json({ ok: true, result })
}

export const POST = withLogging(handlePost, { routeName: "internal/notify" })
