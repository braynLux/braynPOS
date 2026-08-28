import { prisma } from '../lib/prisma.js'
import pino from 'pino'

const logger = pino({ name: 'stock-refresh-worker' })

// Advisory lock key constant for stock_levels refresh (arbitrary 32-bit int)
const STOCK_REFRESH_ADVISORY_LOCK_ID = 8847291

/**
 * Periodically refreshes the stock_levels materialized view.
 * Uses PostgreSQL advisory locks (pg_try_advisory_lock) so only one
 * node/process executes the refresh at a time without needing Redis.
 */
export function startStockRefreshWorker(intervalMs = 300_000) {
  const refresh = async () => {
    try {
      // Try to acquire Postgres advisory lock
      const lockResult = await prisma.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_lock(${STOCK_REFRESH_ADVISORY_LOCK_ID}) AS "acquired"
      `
      if (!lockResult[0]?.acquired) {
        // Another instance is already doing the refresh
        return
      }

      try {
        const exists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
          SELECT to_regclass('public.stock_levels') IS NOT NULL AS "exists"
        `
        if (!exists[0]?.exists) {
          return
        }

        await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY stock_levels`
        logger.info('[StockRefresh] Materialized view refreshed')
      } finally {
        // Always release the advisory lock
        await prisma.$executeRaw`SELECT pg_advisory_unlock(${STOCK_REFRESH_ADVISORY_LOCK_ID})`.catch(() => {})
      }
    } catch (err: any) {
      logger.error({ err: err.message }, '[StockRefresh] Refresh error')
    }
  }

  // Run on interval
  const timer = setInterval(refresh, intervalMs)
  timer.unref() // Don't block Node process exit

  return { stop: () => clearInterval(timer) }
}
