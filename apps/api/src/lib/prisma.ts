import { PrismaClient } from '@prisma/client'
import { multiTenantExtension } from './prisma-multi-tenant.extension.js'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// ── Base client (no extension) ────────────────────────────────────────
// Used directly for models like Transfer that use fromChannelId/toChannelId
// instead of channelId — the multi-tenant extension cannot handle these
// and must not intercept their create() calls.
function buildDatasourceUrl() {
  if (!process.env.DATABASE_URL) return undefined
  try {
    const url = new URL(process.env.DATABASE_URL)
    url.searchParams.set('connect_timeout', '10')
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', process.env.DATABASE_POOL_SIZE || '30')
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', '15')
    }
    return url.toString()
  } catch {
    // Malformed URL — return as-is so Prisma surfaces the real error
    return process.env.DATABASE_URL
  }
}

export const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: buildDatasourceUrl(),
    log: process.env.NODE_ENV === 'production'
      ? ['error', 'warn']
      : ['query', 'error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = basePrisma
}

// ── Extended client (with multi-tenant isolation + slow query logging) ───
export const prisma = basePrisma
  .$extends(multiTenantExtension)
  .$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const start   = Date.now()
          const result  = await query(args)
          const duration = Date.now() - start

          if (duration > 200) {
            const { logger } = await import('./logger.js')
            logger.warn({ model, operation, duration, msg: 'slow query detected' })
          }

          return result
        },
      },
    },
  })

// ── TransactionClient type ────────────────────────────────────────────
export type TransactionClient = any
