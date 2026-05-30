import { getUpstashRedis } from '@/lib/seyf/upstash-redis'
import type { EtherfuseKycSnapshot, EtherfuseKycStatus } from '@/lib/etherfuse/kyc'

type KycStateRow = {
  customerId: string
  walletPublicKey: string
  status: EtherfuseKycStatus
  approvedAt: string | null
  currentRejectionReason: string | null
  updatedAt: string
  lastEventId: string | null
}

function getRedis() {
  return getUpstashRedis()
}

function kycKey(customerId: string, walletPublicKey: string): string {
  return `seyf:kyc:${customerId}:${walletPublicKey}`
}

function kycIndexKey(customerId: string): string {
  return `seyf:kyc:index:${customerId}`
}

function rowToSnapshot(row: KycStateRow): EtherfuseKycSnapshot {
  return {
    customerId: row.customerId,
    walletPublicKey: row.walletPublicKey,
    status: row.status,
    approvedAt: row.approvedAt,
    currentRejectionReason: row.currentRejectionReason,
    verifiedProfile: null,
    documentsCount: 0,
    selfiesCount: 0,
  }
}

export async function getStoredKycSnapshot(
  customerId: string,
  walletPublicKey: string,
): Promise<EtherfuseKycSnapshot | null> {
  try {
    const redis = getRedis()
    if (!redis) return null
    const row = await redis.get<KycStateRow>(kycKey(customerId, walletPublicKey))
    return row ? rowToSnapshot(row) : null
  } catch {
    return null
  }
}

export async function upsertStoredKycSnapshot(params: {
  customerId: string
  walletPublicKey: string
  status: EtherfuseKycStatus
  approvedAt?: string | null
  currentRejectionReason?: string | null
  eventId?: string | null
  eventTimestamp?: string | null
}): Promise<{ updated: boolean }> {
  const redis = getRedis()
  if (!redis) return { updated: false }
  const key = kycKey(params.customerId, params.walletPublicKey)
  const existing = await redis.get<KycStateRow>(key)

  const eventId = params.eventId ?? null
  const hasExplicitTimestamp = Boolean(params.eventTimestamp)
  const incomingTs = hasExplicitTimestamp
    ? new Date(params.eventTimestamp as string).getTime()
    : Date.now()

  if (existing) {
    const samePayload =
      existing.status === params.status &&
      existing.approvedAt === (params.approvedAt ?? null) &&
      existing.currentRejectionReason === (params.currentRejectionReason ?? null)
    if (!eventId && samePayload) return { updated: false }
    if (eventId && existing.lastEventId === eventId) return { updated: false }

    const currentTs = new Date(existing.updatedAt).getTime()
    if (Number.isFinite(currentTs) && Number.isFinite(incomingTs) && incomingTs < currentTs) {
      return { updated: false }
    }
    const effectiveTs =
      hasExplicitTimestamp && Number.isFinite(incomingTs) ? incomingTs : currentTs || Date.now()
    const updated: KycStateRow = {
      ...existing,
      status: params.status,
      approvedAt: params.approvedAt ?? null,
      currentRejectionReason: params.currentRejectionReason ?? null,
      updatedAt: new Date(effectiveTs).toISOString(),
      lastEventId: eventId,
    }
    await redis.set(key, updated, { ex: 60 * 60 * 24 * 180 })
    return { updated: true }
  }

  const row: KycStateRow = {
    customerId: params.customerId,
    walletPublicKey: params.walletPublicKey,
    status: params.status,
    approvedAt: params.approvedAt ?? null,
    currentRejectionReason: params.currentRejectionReason ?? null,
    updatedAt: new Date(incomingTs).toISOString(),
    lastEventId: eventId,
  }
  await Promise.all([
    redis.set(key, row, { ex: 60 * 60 * 24 * 180 }),
    // Index: customerId → list of walletPublicKey (para listStoredKycRows)
    redis.sadd(kycIndexKey(params.customerId), params.walletPublicKey),
  ])
  return { updated: true }
}

export async function listStoredKycRows(limit = 200): Promise<
  Array<{
    customerId: string
    walletPublicKey: string
    status: EtherfuseKycStatus
    approvedAt: string | null
    currentRejectionReason: string | null
    updatedAt: string
  }>
> {
  try {
    const redis = getRedis()
    if (!redis) return []
    // Scan keys matching seyf:kyc:*:* (skip index keys)
    const keys: string[] = []
    let cursor = 0
    do {
      const [nextCursor, batch] = await redis.scan(cursor, {
        match: 'seyf:kyc:*:G*',
        count: 100,
      })
      cursor = Number(nextCursor)
      keys.push(...batch)
      if (keys.length >= limit) break
    } while (cursor !== 0)

    const rows = await Promise.all(
      keys.slice(0, limit).map((k) => redis.get<KycStateRow>(k)),
    )
    return rows
      .filter((r): r is KycStateRow => r !== null)
      .map((row) => ({
        customerId: row.customerId,
        walletPublicKey: row.walletPublicKey,
        status: row.status,
        approvedAt: row.approvedAt,
        currentRejectionReason: row.currentRejectionReason,
        updatedAt: row.updatedAt,
      }))
  } catch {
    return []
  }
}
