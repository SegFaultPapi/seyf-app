/**
 * Redis-backed Etherfuse onboarding session store.
 *
 * Clave: seyf:onboarding:{walletPublicKey}
 * Valor: { customerId, bankAccountId, updatedAt }
 *
 * Sin UPSTASH_REDIS_* en .env: no-op (sesión solo vía cookie/API en dev).
 */

import { getUpstashRedis } from '@/lib/seyf/upstash-redis'

const KEY_PREFIX = 'seyf:onboarding'
const TTL_SEC = 60 * 60 * 24 * 365 // 1 año

export type StoredOnboardingSession = {
  customerId: string
  bankAccountId: string
  walletPublicKey: string
  updatedAt: string
}

function redisKey(walletPublicKey: string): string {
  return `${KEY_PREFIX}:${walletPublicKey}`
}

export async function getStoredOnboardingSession(
  walletPublicKey: string,
): Promise<StoredOnboardingSession | null> {
  const redis = getUpstashRedis()
  if (!redis) return null
  try {
    const raw = await redis.get<StoredOnboardingSession>(redisKey(walletPublicKey))
    if (!raw || typeof raw !== 'object') return null
    if (!raw.customerId || !raw.bankAccountId) return null
    return raw
  } catch (e) {
    console.warn('[onboarding-store] Redis get failed:', e)
    return null
  }
}

export async function saveStoredOnboardingSession(
  data: Omit<StoredOnboardingSession, 'updatedAt'>,
): Promise<void> {
  const redis = getUpstashRedis()
  if (!redis) return
  try {
    const record: StoredOnboardingSession = {
      ...data,
      updatedAt: new Date().toISOString(),
    }
    await redis.set(redisKey(data.walletPublicKey), record, { ex: TTL_SEC })
  } catch (e) {
    console.warn('[onboarding-store] Redis set failed:', e)
  }
}

export async function clearStoredOnboardingSession(walletPublicKey: string): Promise<void> {
  const redis = getUpstashRedis()
  if (!redis) return
  try {
    await redis.del(redisKey(walletPublicKey))
  } catch (e) {
    console.warn('[onboarding-store] Redis del failed:', e)
  }
}
