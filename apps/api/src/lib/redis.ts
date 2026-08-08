import { EventEmitter } from 'events'
import pino from 'pino'

const log = pino({ name: 'redis' })

// ── In-memory fallback (used when REDIS_URL is not set) ──────────────
//
// FIX: this used to be a pure no-op stub — get() always returned null and
// set() always returned 'OK' regardless of the NX flag. Every caller silently
// broke wherever REDIS_URL was unset, which includes single-service
// deployments with no Redis attached:
//
//   • manager approval tokens (setex → get) were never readable, so
//     validateApprovalToken() always returned null and NO approval could
//     ever be granted;
//   • revoked JWTs (setex `revoked:` → get) were never seen as revoked, so
//     logout did not actually invalidate a token;
//   • login-failure counters (incr/expire) never accumulated, so the
//     brute-force lockout never triggered;
//   • acquireIdempotencyLock()'s SET NX always reported success, so two
//     concurrent requests with the same key both proceeded.
//
// It is now a real in-memory store with TTL and NX/XX semantics, which is
// correct for a single-instance deployment. It is still per-process: with
// more than one replica each holds its own copy, so a shared Redis remains
// required for multi-instance correctness (hence the warning below).
type MockEntry = { value: string; expiresAt: number | null }

class RedisMock extends EventEmitter {
  private store  = new Map<string, MockEntry>()
  private hashes = new Map<string, Map<string, string>>()

  /** Read an entry, treating an elapsed TTL as absent (lazy expiry). */
  private live(key: string): MockEntry | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key)
      return undefined
    }
    return entry
  }

  async quit() { this.store.clear(); this.hashes.clear(); return 'OK' }
  async ping() { return 'PONG' }

  async get(k: string) { return this.live(k)?.value ?? null }

  // Supports the ioredis variadic form: set(key, value, 'EX', 30, 'NX')
  async set(k: string, v: string, ...args: any[]) {
    let ttlMs: number | null = null
    let nx = false
    let xx = false

    for (let i = 0; i < args.length; i++) {
      const flag = String(args[i]).toUpperCase()
      if (flag === 'EX')      { ttlMs = Number(args[++i]) * 1000 }
      else if (flag === 'PX') { ttlMs = Number(args[++i]) }
      else if (flag === 'NX') { nx = true }
      else if (flag === 'XX') { xx = true }
    }

    const exists = this.live(k) !== undefined
    if ((nx && exists) || (xx && !exists)) return null  // ioredis returns null when the condition fails

    this.store.set(k, { value: String(v), expiresAt: ttlMs !== null ? Date.now() + ttlMs : null })
    return 'OK'
  }

  async del(...keys: string[]) {
    let removed = 0
    for (const k of keys.flat()) {
      if (this.live(k) !== undefined) removed++
      this.store.delete(k)
      this.hashes.delete(k)
    }
    return removed
  }

  async exists(...keys: string[]) {
    return keys.flat().reduce((n, k) => n + (this.live(k) !== undefined ? 1 : 0), 0)
  }

  async incr(k: string) {
    const entry = this.live(k)
    const next  = (entry ? parseInt(entry.value, 10) || 0 : 0) + 1
    // INCR preserves any TTL already set on the key
    this.store.set(k, { value: String(next), expiresAt: entry?.expiresAt ?? null })
    return next
  }

  async expire(k: string, s: number) {
    const entry = this.live(k)
    if (!entry) return 0
    entry.expiresAt = Date.now() + s * 1000
    return 1
  }

  async setex(k: string, s: number, v: string) {
    this.store.set(k, { value: String(v), expiresAt: Date.now() + s * 1000 })
    return 'OK'
  }

  async hset(k: string, ...args: any[]) {
    const hash = this.hashes.get(k) ?? new Map<string, string>()
    // Accepts hset(key, field, value) and hset(key, { field: value, … })
    if (args.length === 1 && typeof args[0] === 'object') {
      for (const [f, v] of Object.entries(args[0])) hash.set(f, String(v))
    } else {
      for (let i = 0; i + 1 < args.length; i += 2) hash.set(String(args[i]), String(args[i + 1]))
    }
    this.hashes.set(k, hash)
    return 1
  }

  async hget(k: string, f: string) { return this.hashes.get(k)?.get(f) ?? null }

  duplicateOptions = {}
  duplicate() { return this }
  status = 'ready'
}

// ── Real Redis client (when REDIS_URL is set) ─────────────────────────
function createRealClient() {
  // Dynamic import to avoid requiring ioredis when not needed
  const Redis = require('ioredis')
  const client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck:     false,
    lazyConnect:          true,
  })
  client.on('error', (err: Error) => log.warn({ err: err.message }, '[Redis] connection error'))
  client.on('connect', ()       => log.info('[Redis] connected'))
  return client
}

export const redis: any = process.env.REDIS_URL
  ? createRealClient()
  : (() => {
      log.warn(
        '[Redis] REDIS_URL not set — using the in-memory fallback. State is per-process and lost on restart: ' +
        'approval tokens, token revocation, login-failure lockouts and idempotency locks will NOT be shared ' +
        'across replicas. Attach a Redis instance before scaling beyond one replica.'
      )
      return new RedisMock()
    })()

/**
 * Returns a BullMQ-compatible connection.
 * When REDIS_URL is absent we return the mock, which silently no-ops queue operations.
 */
export const createBullConnection = (): any => {
  if (!process.env.REDIS_URL) return new RedisMock()
  const Redis = require('ioredis')
  return new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck:     false,
  })
}

export default redis
