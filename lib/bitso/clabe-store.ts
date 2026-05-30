/**
 * clabe-store.ts
 *
 * Capa de persistencia para el mapeo bidireccional entre wallets Stellar (Pollar)
 * y CLABEs Juno. Usa Vercel KV (Redis) como store.
 */

import { getUpstashRedis } from '@/lib/seyf/upstash-redis'
import type { CLABEDetails } from './types'

export type ClabeRecord = CLABEDetails & {
  stellarAddress: string
  savedAt: string
}

const walletKey = (stellarAddress: string) => `clabe:wallet:${stellarAddress}`
const reverseKey = (clabe: string) => `clabe:reverse:${clabe}`

export async function getClabeForWallet(
  stellarAddress: string,
): Promise<ClabeRecord | null> {
  if (!stellarAddress) return null
  const redis = getUpstashRedis()
  if (!redis) return null
  return redis.get<ClabeRecord>(walletKey(stellarAddress))
}

export async function getWalletForClabe(clabe: string): Promise<string | null> {
  if (!clabe) return null
  const redis = getUpstashRedis()
  if (!redis) return null
  return redis.get<string>(reverseKey(clabe))
}

export async function saveClabeMapping(
  stellarAddress: string,
  clabe: CLABEDetails,
): Promise<ClabeRecord> {
  const record: ClabeRecord = {
    ...clabe,
    stellarAddress,
    savedAt: new Date().toISOString(),
  }

  const redis = getUpstashRedis()
  if (!redis) return record

  await Promise.all([
    redis.set(walletKey(stellarAddress), record),
    redis.set(reverseKey(clabe.clabe), stellarAddress),
  ])

  return record
}

export async function deleteClabeMapping(stellarAddress: string): Promise<void> {
  const redis = getUpstashRedis()
  if (!redis) return
  await redis.del(walletKey(stellarAddress))
}
