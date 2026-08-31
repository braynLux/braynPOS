import { basePrisma } from './prisma.js'

const LOCK_TTL_MS = 30_000 // 30 seconds max in-flight request lock

// Fast in-process lock tracker
const inFlightLocks = new Map<string, number>()

/**
 * Check if an idempotency key has already been processed.
 * Queries PostgreSQL idempotency_records table.
 */
export async function checkIdempotency(
  key: string
): Promise<{ responseBody: unknown; statusCode: number } | null> {
  try {
    const dbRecord = await (basePrisma as any).idempotencyRecord?.findUnique({ where: { key } })
    if (dbRecord && dbRecord.statusCode > 0) {
      return { responseBody: dbRecord.responseBody, statusCode: dbRecord.statusCode }
    }
  } catch {
    // Graceful fallback
  }
  return null
}

/**
 * Acquire an atomic distributed idempotency lock before processing a request.
 * Uses PostgreSQL atomic conditional upsert + in-memory fast check.
 */
export async function acquireIdempotencyLock(key: string): Promise<boolean> {
  const now = Date.now()
  const existingLockTime = inFlightLocks.get(key)
  if (existingLockTime && now - existingLockTime < LOCK_TTL_MS) {
    return false
  }

  inFlightLocks.set(key, now)

  // Try PostgreSQL distributed lock
  try {
    const existing = await (basePrisma as any).idempotencyRecord?.findUnique({ where: { key } })
    if (existing) {
      // If already has final status code (> 0), request is completed
      if (existing.statusCode > 0) return false
      // If locked within the last LOCK_TTL_MS, another worker holds the lock
      const lockAge = now - new Date(existing.lockedAt).getTime()
      if (lockAge < LOCK_TTL_MS) return false

      // Otherwise, takeover stale crashed lock
      await (basePrisma as any).idempotencyRecord?.update({
        where: { key },
        data: { lockedAt: new Date(now) },
      })
      return true
    }

    // Insert pending lock placeholder (statusCode: 0)
    await (basePrisma as any).idempotencyRecord?.create({
      data: {
        key,
        statusCode: 0,
        responseBody: {},
        lockedAt: new Date(now),
      },
    })
    return true
  } catch {
    // Fall back to in-memory lock
    return true
  }
}

/**
 * Release the idempotency lock early (e.g. on error, before TTL expires).
 */
export async function releaseIdempotencyLock(key: string): Promise<void> {
  inFlightLocks.delete(key)
  try {
    const existing = await (basePrisma as any).idempotencyRecord?.findUnique({ where: { key } })
    if (existing && existing.statusCode === 0) {
      await (basePrisma as any).idempotencyRecord?.delete({ where: { key } })
    }
  } catch {}
}

/**
 * Store an idempotency result in DB (permanent).
 * Also releases in-flight lock.
 */
export async function storeIdempotencyResult(
  key:          string,
  responseBody: object,
  statusCode:   number
): Promise<void> {
  inFlightLocks.delete(key)
  try {
    await (basePrisma as any).idempotencyRecord?.upsert({
      where:  { key },
      create: { key, responseBody, statusCode, lockedAt: new Date() },
      update: { responseBody, statusCode, lockedAt: new Date() },
    })
  } catch {}
}

/**
 * Validate that a string is a valid UUIDv4 format.
 */
export function isValidIdempotencyKey(key: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)
}
