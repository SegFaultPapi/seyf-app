/**
 * redis-guards.ts
 *
 * Three Redis-backed primitives:
 *  1. rateLimiter   — sliding window counter per IP+endpoint, blocks spam on bonus/KYC
 *  2. advanceStore  — persists active advance state per customerId
 *  3. onrampLock    — distributed lock (SET NX PX) that prevents concurrent onramp orders
 */

import { NextResponse } from 'next/server'
import { getUpstashRedis } from '@/lib/seyf/upstash-redis'

function getRedis() {
  return getUpstashRedis()
}

// ─── 1. Rate Limiter ────────────────────────────────────────────────────────

export type RateLimitConfig = {
  /** Key identifier: usually "{ip}:{endpoint}" */
  key: string
  /** Max requests allowed in the window */
  limit: number
  /** Window duration in seconds */
  windowSec: number
}

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSec: number }

/**
 * Sliding-window rate limiter using Redis INCR + EXPIRE.
 * Returns allowed=false with retryAfterSec when the limit is exceeded.
 */
export async function checkRateLimit(cfg: RateLimitConfig): Promise<RateLimitResult> {
  try {
    const redis = getRedis()
    if (!redis) return { allowed: true, remaining: cfg.limit }
    const redisKey = `seyf:rl:${cfg.key}`
    const count = await redis.incr(redisKey)
    if (count === 1) {
      // First request in this window — set the TTL
      await redis.expire(redisKey, cfg.windowSec)
    }
    if (count > cfg.limit) {
      const ttl = await redis.ttl(redisKey)
      return { allowed: false, retryAfterSec: ttl > 0 ? ttl : cfg.windowSec }
    }
    return { allowed: true, remaining: cfg.limit - count }
  } catch {
    // If Redis is down, allow the request (fail open) to avoid blocking legit users
    return { allowed: true, remaining: 1 }
  }
}

/**
 * Convenience wrapper — returns a NextResponse 429 when limited, null when allowed.
 * Usage:
 *   const limited = await rateLimitResponse(request, 'bonus/welcome', { limit: 3, windowSec: 60 })
 *   if (limited) return limited
 */
export async function rateLimitResponse(
  request: Request,
  endpoint: string,
  opts: { limit: number; windowSec: number },
): Promise<NextResponse | null> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  const result = await checkRateLimit({
    key: `${ip}:${endpoint}`,
    limit: opts.limit,
    windowSec: opts.windowSec,
  })
  if (!result.allowed) {
    return NextResponse.json(
      {
        error: {
          code: 'rate_limited',
          message_es: `Demasiadas solicitudes. Intenta de nuevo en ${result.retryAfterSec} segundos.`,
          retryable: true,
          retryAfterSec: result.retryAfterSec,
        },
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(result.retryAfterSec),
          'X-RateLimit-Limit': String(opts.limit),
        },
      },
    )
  }
  return null
}

// ─── 2. Advance Session Store ───────────────────────────────────────────────

export type AdvanceStatus = 'pending' | 'confirmed' | 'repaid' | 'cancelled'

export type AdvanceSession = {
  customerId: string
  amountMxn: number
  feeMxn: number
  netMxn: number
  requestedAt: string
  confirmedAt: string | null
  repaidAt: string | null
  status: AdvanceStatus
  /** Etherfuse order ID of the offramp used to deliver the advance */
  orderId: string | null
}

function advanceKey(customerId: string): string {
  return `seyf:advance:${customerId}`
}

export async function getAdvanceSession(customerId: string): Promise<AdvanceSession | null> {
  try {
    const redis = getRedis()
    if (!redis) return null
    return await redis.get<AdvanceSession>(advanceKey(customerId))
  } catch {
    return null
  }
}

export async function upsertAdvanceSession(
  session: AdvanceSession,
): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  // TTL: 90 days — advances should settle or expire within that window
  await redis.set(advanceKey(session.customerId), session, {
    ex: 60 * 60 * 24 * 90,
  })
}

export async function clearAdvanceSession(customerId: string): Promise<void> {
  try {
    const redis = getRedis()
    if (!redis) return
    await redis.del(advanceKey(customerId))
  } catch {
    // noop
  }
}

export async function hasActiveAdvance(customerId: string): Promise<boolean> {
  const session = await getAdvanceSession(customerId)
  return session !== null && (session.status === 'pending' || session.status === 'confirmed')
}

// ─── 3. Distributed Lock (onramp idempotency) ───────────────────────────────

function lockKey(customerId: string): string {
  return `seyf:lock:onramp:${customerId}`
}

/**
 * Acquires a distributed lock for a customer's onramp flow.
 * Returns true if the lock was acquired, false if another request holds it.
 *
 * The lock auto-expires after `ttlSec` so a crashed request never deadlocks.
 * Always call `releaseOnrampLock` in a finally block.
 */
export async function acquireOnrampLock(
  customerId: string,
  ttlSec = 30,
): Promise<boolean> {
  try {
    const redis = getRedis()
    if (!redis) return true
    // SET key value NX PX <ms> — only sets if key does not exist
    const result = await redis.set(lockKey(customerId), '1', {
      nx: true,
      ex: ttlSec,
    })
    return result === 'OK'
  } catch {
    // If Redis is down, allow the request (fail open)
    return true
  }
}

export async function releaseOnrampLock(customerId: string): Promise<void> {
  try {
    const redis = getRedis()
    if (!redis) return
    await redis.del(lockKey(customerId))
  } catch {
    // noop — lock will expire on its own via TTL
  }
}

/**
 * Convenience wrapper that acquires a lock or returns a 409 conflict response.
 * Usage:
 *   const [locked, unlock] = await onrampLockResponse(customerId)
 *   if (!locked) return locked  // locked is the 409 NextResponse here
 *   try { ... } finally { await unlock() }
 */
export async function withOnrampLock<T>(
  customerId: string,
  fn: () => Promise<T>,
  ttlSec = 30,
): Promise<T | NextResponse> {
  const acquired = await acquireOnrampLock(customerId, ttlSec)
  if (!acquired) {
    return NextResponse.json(
      {
        error: {
          code: 'conflict',
          message_es: 'Ya hay una orden en proceso para esta cuenta. Espera unos segundos e intenta de nuevo.',
          retryable: true,
        },
      },
      { status: 409 },
    )
  }
  try {
    return await fn()
  } finally {
    await releaseOnrampLock(customerId)
  }
}
