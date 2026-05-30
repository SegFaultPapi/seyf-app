import { getUpstashRedis } from '@/lib/seyf/upstash-redis'

type WelcomeBonusRow = {
  customerId: string
  orderId: string
  amountMxn: number
  claimedAt: string
}

function getRedis() {
  return getUpstashRedis()
}

function bonusKey(customerId: string): string {
  return `seyf:bonus:welcome:${customerId}`
}

export async function getWelcomeBonusClaimByCustomerId(
  customerId: string,
): Promise<WelcomeBonusRow | null> {
  try {
    const redis = getRedis()
    if (!redis) return null
    return await redis.get<WelcomeBonusRow>(bonusKey(customerId))
  } catch {
    return null
  }
}

export async function clearWelcomeBonusClaimByCustomerId(customerId: string): Promise<void> {
  try {
    const redis = getRedis()
    if (!redis) return
    await redis.del(bonusKey(customerId))
  } catch {
    // ignorar
  }
}

export async function upsertWelcomeBonusClaim(params: {
  customerId: string
  orderId: string
  amountMxn: number
}): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const row: WelcomeBonusRow = {
    customerId: params.customerId,
    orderId: params.orderId,
    amountMxn: params.amountMxn,
    claimedAt: new Date().toISOString(),
  }
  // TTL 365 días — el bono es permanente pero el store no necesita ser eterno en testnet
  await redis.set(bonusKey(params.customerId), row, { ex: 60 * 60 * 24 * 365 })
}
