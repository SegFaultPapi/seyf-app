import { getUpstashRedis } from '@/lib/seyf/upstash-redis'

type AgreementsRow = {
  customerId: string
  walletPublicKey: string
  accepted: boolean
  acceptedAt: string | null
  updatedAt: string
}

function getRedis() {
  return getUpstashRedis()
}

function agreementsKey(customerId: string, walletPublicKey: string): string {
  return `seyf:agreements:${customerId}:${walletPublicKey}`
}

export async function getStoredAgreementsStatus(
  customerId: string,
  walletPublicKey: string,
): Promise<{ accepted: boolean; acceptedAt: string | null } | null> {
  try {
    const redis = getRedis()
    if (!redis) return null
    const row = await redis.get<AgreementsRow>(agreementsKey(customerId, walletPublicKey))
    if (!row) return null
    return { accepted: row.accepted, acceptedAt: row.acceptedAt }
  } catch {
    return null
  }
}

export async function upsertStoredAgreementsAccepted(params: {
  customerId: string
  walletPublicKey: string
  acceptedAt?: string | null
}): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const key = agreementsKey(params.customerId, params.walletPublicKey)
  const existing = await redis.get<AgreementsRow>(key)
  const now = new Date().toISOString()
  const acceptedAt = params.acceptedAt ?? now
  const row: AgreementsRow = {
    ...(existing ?? {}),
    customerId: params.customerId,
    walletPublicKey: params.walletPublicKey,
    accepted: true,
    acceptedAt,
    updatedAt: now,
  }
  // TTL 365 días
  await redis.set(key, row, { ex: 60 * 60 * 24 * 365 })
}
