import * as Sentry from '@sentry/node'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import sensible from '@fastify/sensible'
import { logger } from './lib/logger.js'
import { requestContextPlugin } from './lib/request-context.plugin.js'
import { rateLimitPlugin } from './lib/rate-limit.plugin.js'
import { healthPlugin } from './lib/health.plugin.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { channelsRoutes } from './modules/channels/channels.routes.js'
import { usersRoutes } from './modules/users/users.routes.js'
import { idempotencyCheckMiddleware } from './middleware/idempotency-check.js'
import { commissionRoutes } from './modules/commission/commission.routes.js'
import multipart from '@fastify/multipart'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'

export function globalErrorHandler(error: any, request: any, reply: any) {
  // 1. Validation Errors (Zod)
  if (error instanceof ZodError) {
    return reply.status(400).send({
      statusCode: 400,
      error:      'Validation Error',
      message:    error.errors.map(e => e.message).join(', ')
    })
  }

  // 2. Database Connection / Initialization Failure (Prisma)
  if (error instanceof Prisma.PrismaClientInitializationError) {
    request.log.error({ err: error, url: request.url }, 'database connection failure')
    return reply.status(503).send({
      statusCode: 503,
      error:      'Database Unavailable',
      message:    'Unable to connect to the database server. Please ensure the database service is running.'
    })
  }

  // 3. Known Request Errors (Prisma constraints, not found, etc.)
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    request.log.error({ code: error.code, meta: error.meta, url: request.url }, 'prisma known request error')
    switch (error.code) {
      case 'P2002': {
        const target = (error.meta?.target as string[])?.join(', ') || 'field'
        return reply.status(409).send({
          statusCode: 409,
          error:      'Conflict',
          message:    `A record with this ${target} already exists.`
        })
      }
      case 'P2025':
        return reply.status(404).send({
          statusCode: 404,
          error:      'Not Found',
          message:    'The requested record was not found.'
        })
      case 'P2003':
        return reply.status(400).send({
          statusCode: 400,
          error:      'Constraint Violation',
          message:    'This operation cannot be completed because related records exist.'
        })
      case 'P2024':
      case 'P1001':
      case 'P1002':
        return reply.status(503).send({
          statusCode: 503,
          error:      'Database Unavailable',
          message:    'The database server is currently unreachable or timed out. Please verify your database connection.'
        })
      default:
        return reply.status(500).send({
          statusCode: 500,
          error:      'Database Error',
          message:    'A database error occurred while processing your request. Please try again.'
        })
    }
  }

  // 4. Unknown Prisma Errors / Validation / Panics
  if (
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    request.log.error({ err: error, url: request.url }, 'prisma query or validation error')
    return reply.status(500).send({
      statusCode: 500,
      error:      'Database Error',
      message:    'An unexpected database error occurred. Please try again.'
    })
  }

  const statusCode    = (error as { statusCode?: number }).statusCode ?? (error as { status?: number }).status ?? 500
  const isServerError = statusCode >= 500
  const rawMessage    = typeof error.message === 'string' ? error.message : 'Internal Server Error'

  if (isServerError) {
    request.log.error({ err: error, url: request.url, method: request.method }, 'server error')
    if (process.env.SENTRY_DSN) {
      Sentry.captureException(error, {
        user: { id: (request.user as any)?.sub, email: (request.user as any)?.email },
        extra: { url: request.url, method: request.method, requestId: request.id },
      })
    }
  } else {
    request.log.warn({ statusCode, message: rawMessage, url: request.url }, 'client error handled')
  }

  const lowerMessage = rawMessage.toLowerCase()
  const isTechnicalDbError =
    lowerMessage.includes('prisma') ||
    lowerMessage.includes('database') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('enotfound') ||
    lowerMessage.includes('syntax error') ||
    lowerMessage.includes('invocation in') ||
    lowerMessage.includes('column') ||
    lowerMessage.includes('relation') ||
    lowerMessage.includes('15432') ||
    lowerMessage.includes('127.0.0.1:') ||
    lowerMessage.includes('localhost:')

  let safeMessage = rawMessage
  if (isTechnicalDbError) {
    safeMessage = (lowerMessage.includes('reach') || lowerMessage.includes('connect') || lowerMessage.includes('econnrefused'))
      ? 'Unable to connect to the database server. Please ensure the database service is running.'
      : 'A database error occurred. Please try again or contact support.'
  } else if (isServerError) {
    safeMessage = 'An unexpected server error occurred. Please try again or contact support.'
  }

  return reply.status(statusCode).send({
    error:      safeMessage,
    message:    safeMessage,
    statusCode,
  })
}

export async function buildApp() {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn:              process.env.SENTRY_DSN,
      environment:      process.env.NODE_ENV ?? 'development',
      tracesSampleRate: 1.0,
      integrations:     [], // Add profiling if needed
    })
  }

  const app = Fastify({
    // ── Use the pino instance directly ──────
    logger,
    rewriteUrl: (req) => {
      if (req.url && req.url.startsWith('/api/v1')) {
        return req.url.replace('/api/v1', '/v1')
      }
      return req.url || ''
    },
    genReqId: (req) => {
      const fromHeader = req.headers['x-request-id']
      if (typeof fromHeader === 'string' && fromHeader.length > 0) return fromHeader
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    },
    bodyLimit:         5 * 1024 * 1024,
    trustProxy:        true,
    connectionTimeout: 30_000,
  })

  // ── Global Error Handler (Registered Early) ──────────────────────
  app.setErrorHandler(globalErrorHandler)


  // ── Health + Readiness — FIRST, before all other plugins ────────
  await app.register(healthPlugin)

  // ── Request context / structured logging ────────────────────────
  await app.register(requestContextPlugin)

  // ── Content-Type guard ──────────────────────────────────────────
  app.addHook('preHandler', async (request, reply) => {
    const method      = request.method
    const hasBody     = ['POST', 'PUT', 'PATCH'].includes(method)
    const contentType = request.headers['content-type'] ?? ''

    if (hasBody && !contentType.includes('application/json') && !contentType.includes('multipart/form-data')) {
      return reply.status(415).send({
        statusCode: 415,
        error:      'Unsupported Media Type',
        message:    'Content-Type must be application/json or multipart/form-data',
      })
    }
  })

  // ── Multipart support ──────────────────────────────────────────
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } })

  // ── Global plugins ──────────────────────────────────────────────
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',')
      : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
  })
  await app.register(helmet)
  await app.register(sensible)
  await app.register(rateLimitPlugin)

  // ── Swagger Documentation (Phase 6) ─────────────────────────────
  const { fastifySwagger }   = await import('@fastify/swagger')
  const { fastifySwaggerUi } = await import('@fastify/swagger-ui')

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title:       'LUX POS API v2.0',
        description: 'Hardened Production-Grade Point of Sale API',
        version:     '2.0.0',
      },
      servers: [{ url: `http://localhost:${process.env.PORT || 4000}` }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type:         'http',
            scheme:       'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  })

  await app.register(fastifySwaggerUi, {
    routePrefix: '/v1/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking:  false,
    },
    staticCSP: true,
  })

  // ── Idempotency middleware ───────────────────────────────────────
  await app.register(idempotencyCheckMiddleware)

  // ── Public Catalog routes ───────────────────────────────────────
  const { catalogRoutes } = await import('./modules/catalog/catalog.routes.js')
  await app.register(catalogRoutes, { prefix: '/v1/public/catalog' })

  // ── API v1 routes ───────────────────────────────────────────────
  await app.register(async (v1) => {
    v1.setErrorHandler(globalErrorHandler)

    await v1.register(authRoutes, { prefix: '/auth' })
    const { managerApproveRoutes } = await import('./modules/auth/manager-approve.routes.js')
    await v1.register(managerApproveRoutes, { prefix: '/auth' })

    const { enterpriseRoutes } = await import('./modules/enterprises/enterprises.routes.js')
    await v1.register(enterpriseRoutes, { prefix: '/enterprises' })

    const { googleRoutes } = await import('./modules/settings/google.routes.js')
    await v1.register(googleRoutes, { prefix: '/settings/google' })

    await v1.register(channelsRoutes, { prefix: '/channels' })
    await v1.register(usersRoutes,    { prefix: '/users' })
    const { managerApprovalsRoutes } = await import('./modules/users/manager-approvals.routes.js')
    await v1.register(managerApprovalsRoutes, { prefix: '/users/approvals' })

    const { itemsRoutes } = await import('./modules/items/items.routes.js')
    await v1.register(itemsRoutes, { prefix: '/items' })

    const { stockOverviewRoutes } = await import('./modules/stock/stock-overview.routes.js')
    await v1.register(stockOverviewRoutes, { prefix: '/stock' })

    const { stockTakeRoutes } = await import('./modules/stock/stock-take.routes.js')
    await v1.register(stockTakeRoutes, { prefix: '/stock/take' })

    const { serialsRoutes } = await import('./modules/serials/serials.routes.js')
    await v1.register(serialsRoutes, { prefix: '/serials' })

    const { accountsRoutes } = await import('./modules/accounting/accounts.routes.js')
    await v1.register(accountsRoutes, { prefix: '/accounting/accounts' })

    const { ledgerRoutes } = await import('./modules/accounting/ledger.routes.js')
    await v1.register(ledgerRoutes, { prefix: '/accounting' })

    const { assetsRoutes } = await import('./modules/accounting/assets.routes.js')
    await v1.register(assetsRoutes, { prefix: '/accounting/assets' })

    const { bankDepositsRoutes } = await import('./modules/accounting/bank-deposits.routes.js')
    await v1.register(bankDepositsRoutes, { prefix: '/accounting/bank-deposits' })

    const { sessionsRoutes } = await import('./modules/sessions/sessions.routes.js')
    await v1.register(sessionsRoutes, { prefix: '/sessions' })

    const { customersRoutes } = await import('./modules/customers/customers.routes.js')
    await v1.register(customersRoutes, { prefix: '/customers' })

    const { paymentsRoutes } = await import('./modules/payments/payments.routes.js')
    await v1.register(paymentsRoutes, { prefix: '/payments' })

    const { salesRoutes } = await import('./modules/sales/sales.routes.js')
    await v1.register(salesRoutes, { prefix: '/sales' })

    const { returnsRoutes } = await import('./modules/sales/returns.routes.js')
    await v1.register(returnsRoutes, { prefix: '/sales/returns' })

    const { lpoRoutes } = await import('./modules/purchases/lpo.routes.js')
    await v1.register(lpoRoutes, { prefix: '/purchases/lpo' })

    const { purchaseRoutes } = await import('./modules/purchases/purchase.routes.js')
    await v1.register(purchaseRoutes, { prefix: '/purchases' })

    const { transfersRoutes } = await import('./modules/transfers/transfers.routes.js')
    await v1.register(transfersRoutes, { prefix: '/transfers' })

    const { invoiceRoutes } = await import('./modules/invoicing/invoice.routes.js')
    await v1.register(invoiceRoutes, { prefix: '/invoices' })

    const { expensesRoutes } = await import('./modules/expenses/expenses.routes.js')
    await v1.register(expensesRoutes, { prefix: '/expenses' })

    const { creditRoutes } = await import('./modules/credit/credit.routes.js')
    await v1.register(creditRoutes, { prefix: '/credit' })

    const { reportsRoutes } = await import('./modules/reports/reports.routes.js')
    await v1.register(reportsRoutes, { prefix: '/reports' })

    const { exportRoutes } = await import('./modules/export/export.routes.js')
    await v1.register(exportRoutes, { prefix: '/export' })

    const { dashboardRoutes } = await import('./modules/dashboard/dashboard.routes.js')
    await v1.register(dashboardRoutes, { prefix: '/dashboard' })

    const { checklistRoutes } = await import('./modules/settings/checklists.routes.js')
    await v1.register(checklistRoutes, { prefix: '/settings' })

    const { payrollRoutes } = await import('./modules/payroll/payroll.routes.js')
    await v1.register(payrollRoutes, { prefix: '/payroll' })

    await v1.register(commissionRoutes, { prefix: '/commission' })

    const { taxRoutes } = await import('./modules/tax/tax.routes.js')
    await v1.register(taxRoutes, { prefix: '/tax' })

    const { supportRoutes } = await import('./modules/support/support.routes.js')
    await v1.register(supportRoutes, { prefix: '/support' })

    const { loyaltyRoutes } = await import('./modules/loyalty/loyalty.routes.js')
    await v1.register(loyaltyRoutes, { prefix: '/loyalty' })

    const { receiptsRoutes } = await import('./modules/receipts/receipts.routes.js')
    await v1.register(receiptsRoutes, { prefix: '/receipts' })

    const { aiRoutes } = await import('./modules/ai/ai.routes.js')
    await v1.register(aiRoutes, { prefix: '/ai' })

    const { notificationRoutes } = await import('./modules/notifications/notifications.routes.js')
    await v1.register(notificationRoutes, { prefix: '/notifications' })

    const { auditRoutes } = await import('./modules/audit/audit.routes.js')
    await v1.register(auditRoutes, { prefix: '/audit' })

    const { marginCorrectionRoutes } = await import('./modules/audit/margin-correction.routes.js')
    await v1.register(marginCorrectionRoutes, { prefix: '/audit/margin-correction' })

  }, { prefix: '/v1' })

  return app
}

