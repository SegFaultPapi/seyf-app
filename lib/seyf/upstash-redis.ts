import { Redis } from '@upstash/redis'

let client: Redis | null | undefined

function readUpstashCredentials(): { url: string; token: string } | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim() ||
    ''
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim() ||
    ''

  if (!url || !token) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  } catch {
    return null
  }
  return { url, token }
}

/** True cuando hay URL REST absoluta y token de Upstash (o alias KV_* de Vercel). */
export function isUpstashRedisConfigured(): boolean {
  return readUpstashCredentials() !== null
}

/** Cliente Redis o null en local/dev sin Upstash (evita ERR_INVALID_URL /pipeline). */
export function getUpstashRedis(): Redis | null {
  const creds = readUpstashCredentials()
  if (!creds) {
    client = null
    return null
  }
  if (client === undefined) {
    client = new Redis({ url: creds.url, token: creds.token })
  }
  return client
}
