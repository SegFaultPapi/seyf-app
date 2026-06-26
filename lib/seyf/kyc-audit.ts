import { Redis } from '@upstash/redis'

function getRedis(): Redis {
  return Redis.fromEnv()
}

export async function appendKycAuditEvent(input: {
  event: 'submit' | 'update' | 'resubmit'
  customerId?: string | null
  walletPublicKey?: string | null
  status?: string | null
  reason?: string | null
  eventId?: string | null
}): Promise<void> {
  try {
    const redis = getRedis()
    const key = `seyf:kyc:audit:${input.customerId ?? 'unknown'}:${input.walletPublicKey ?? 'unknown'}`
    const payload = {
      ...input,
      reason: input.reason ? input.reason.trim().slice(0, 64) : null,
      createdAt: new Date().toISOString(),
    }

    await redis.lpush(key, JSON.stringify(payload))
    await redis.expire(key, 60 * 60 * 24 * 365)
  } catch {
    // best effort audit log
  }
}
