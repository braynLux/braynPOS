import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { logger } from '../lib/logger.js'

const DB_LATENCY_WARN_MS  = 200
const DB_LATENCY_FATAL_MS = 2000

const HEALTH_TOKEN = process.env.HEALTH_TOKEN

let startedAt:    Date
let lastReadyAt:  Date | null = null

interface CheckResult {
  ok:         boolean
  latencyMs?: number
  message?:   string
  detail?:    string
}

export const healthPlugin = fp(async (app: FastifyInstance) => {
  startedAt = new Date()

  // ── GET /health — public, lightweight ─────────────────────────────
  app.get('/health', async (_request, reply) => {
    reply.status(200).send({
      status:      'ok',
      timestamp:   new Date().toISOString(),
      version:     process.env.npm_package_version ?? '2.0.0',
      uptime:      Math.floor(process.uptime()),
      uptimeSince: startedAt.toISOString(),
    })
  })

  // ── GET /ready — internal only, requires token in production ───────
  app.get('/ready', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      if (!HEALTH_TOKEN) {
        return reply.status(503).send({
          status:  'misconfigured',
          message: 'HEALTH_TOKEN env var not set. /ready is disabled until configured.',
        })
      }

      const provided = request.headers['x-health-token']
      if (provided !== HEALTH_TOKEN) {
        return reply.status(401).send({ error: 'Unauthorized' })
      }
    }

    const checks: Record<string, CheckResult> = {}
    let overallReady = true

    checks.database = await checkDatabase()
    if (!checks.database.ok) overallReady = false

    checks.memory = checkMemory()
    if (!checks.memory.ok) overallReady = false

    checks.eventBus = { ok: true, latencyMs: 0 }

    if (overallReady) lastReadyAt = new Date()

    const statusCode = overallReady ? 200 : 503

    if (!overallReady) {
      logger.error({ checks }, 'readiness check failed — returning 503')
    }

    reply.status(statusCode).send({
      status:      overallReady ? 'ready' : 'not_ready',
      timestamp:   new Date().toISOString(),
      uptime:      Math.floor(process.uptime()),
      lastReadyAt: lastReadyAt?.toISOString() ?? null,
      checks,
    })
  })

  app.log.info('[health] /health and /ready endpoints registered')
})

async function checkDatabase(): Promise<CheckResult> {
  const start = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    const latencyMs = Date.now() - start
    if (latencyMs > DB_LATENCY_FATAL_MS) {
      return { ok: false, latencyMs, message: 'database responding too slowly' }
    }
    if (latencyMs > DB_LATENCY_WARN_MS) {
      logger.warn({ latencyMs }, 'database latency above warning threshold')
    }
    return { ok: true, latencyMs }
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, message: 'database unreachable', detail: err.message }
  }
}

function checkMemory(): CheckResult {
  const mem         = process.memoryUsage()
  const heapUsedMB  = Math.round(mem.heapUsed  / 1024 / 1024)
  const heapTotalMB = Math.round(mem.heapTotal  / 1024 / 1024)
  const usagePct    = Math.round((mem.heapUsed / mem.heapTotal) * 100)
  const ok          = usagePct < 95

  return {
    ok,
    message: ok ? undefined : `heap at ${usagePct}% — memory pressure`,
    detail:  `heap: ${heapUsedMB}MB / ${heapTotalMB}MB (${usagePct}%)`,
  }
}
