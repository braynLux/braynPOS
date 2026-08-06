import { Worker } from 'bullmq'
import { createBullConnection } from '../lib/redis.js'
import { prisma } from '../lib/prisma.js'
import { BACKOFF_OPTIONS } from '../lib/worker-backoff.js'
import pino from 'pino'

const logger = pino({ name: 'stock-refresh-worker' })

export function startStockRefreshWorker() {
  const worker = new Worker(
    'stock-refresh',
    async () => {
      try {
        const exists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
          SELECT to_regclass('public.stock_levels') IS NOT NULL AS "exists"
        `
        if (!exists[0]?.exists) {
          logger.warn('[StockRefresh] stock_levels materialized view is not installed; skipping refresh')
          return
        }
        await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY stock_levels`
        logger.info('[StockRefresh] Materialized view refreshed')
      } catch (err) {
        logger.error({ err: (err as Error).message }, '[StockRefresh] Failed to refresh')
        throw err
      }
    },
    {
      connection: createBullConnection(),
      concurrency: 1,
      ...BACKOFF_OPTIONS,
      limiter: {
        max: 1,
        duration: 300_000,
      },
    }
  )

  worker.on('completed', () => logger.info('[StockRefresh] Job completed'))
  worker.on('failed', (_job, err) => logger.error({ err: err.message }, '[StockRefresh] Job failed'))
  return worker
}
