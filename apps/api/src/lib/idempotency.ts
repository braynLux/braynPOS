import { prisma } from './prisma.js'

const LOCK_TTL_MS = 30_000 // 30 seconds max in-flight request lock

// In-memory request lock tracker (locks active processing requests without requiring Redis)
const inFlightLocks = new Map<string, number>()

/**
 * Check if an idempotency key has already been processed.
 * Queries PostgreSQL idempotency_records table.
 */
export async function checkIdempotency(
  key: string
): Promise<{ responseBody: unknown; statusCode: number } | null> {
  const dbRecord = await prisma.idempotencyRecord.findUnique({ where: { key } })
  if (dbRecord) {
    return { responseBody: dbRecord.responseBody, statusCode: dbRecord.statusCode }
  }
  return null
}

/**
 * Acquire an atomic idempotency lock before processing a request.
 * Uses in-memory lock map with expiration check.
 */
export async function acquireIdempotencyLock(key: string): Promise<boolean> {
  const now = Date.now()
  const existingLockTime = inFlightLocks.get(key)

  if (existingLockTime && now - existingLockTime < LOCK_TTL_MS) {
    return false // Lock already held and not expired
  }

  inFlightLocks.set(key, now)
  return true
}

/**
 * Release the idempotency lock early (e.g. on error, before TTL expires).
 */
export async function releaseIdempotencyLock(key: string): Promise<void> {
  inFlightLocks.delete(key)
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
  await prisma.idempotencyRecord.upsert({
    where:  { key },
    create: { key, responseBody, statusCode },
    update: {},  // No-op if already stored — first-write-wins
  })

  // Release in-flight lock
  inFlightLocks.delete(key)
}

/**
 * Validate that a string is a valid UUIDv4 format.
 */
export function isValidIdempotencyKey(key: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)
}
