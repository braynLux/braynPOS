import type { FastifyPluginAsync } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { basePrisma, prisma } from '../../lib/prisma.js'
import { RATE } from '../../lib/rate-limit.plugin.js'
import { mobileMoneyProvider } from './providers/mobile-money.provider.js'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const webhookSchema = z.object({
  TransID: z.string().min(1).max(120),
  TransAmount: z.coerce.number().nonnegative().optional(),
  ResultCode: z.coerce.number().int(),
}).passthrough()

function validWebhookSecret(headerValue: unknown, secret: string): boolean {
  if (typeof headerValue !== 'string') return false
  const received = Buffer.from(headerValue)
  const expected = Buffer.from(secret)
  return received.length === expected.length && timingSafeEqual(received, expected)
}

export const paymentsRoutes: FastifyPluginAsync = async (app) => {
  // Authenticated routes live in their own encapsulated context so the
  // `authenticate` preHandler hook doesn't leak onto the public /webhook
  // route below — Fastify hooks apply to the whole encapsulation context
  // they're added to, regardless of registration order, so `/webhook` must
  // stay outside this nested `register` block to remain unauthenticated.
  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', authenticate)

    // GET /payments?saleId=xxx
    protectedRoutes.get('/', {
      config: RATE.READ,
      preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER', 'SALES_PERSON')],
    }, async (request) => {
      const { saleId } = z.object({ saleId: z.string().uuid() }).parse(request.query)

      const sale = await basePrisma.sale.findUnique({
        where: { id: saleId },
        select: { channelId: true },
      })

      if (!sale) return [] // If it truly doesn't exist, return empty list

      // Isolation check
      if (!['PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN'].includes(request.user.role)) {
        if (sale.channelId !== request.user.channelId) {
          throw { statusCode: 403, message: 'Access denied: Sale belongs to another channel' }
        }
      }

      return prisma.payment.findMany({
        where: { saleId },
        orderBy: { createdAt: 'desc' },
      })
    })
  })

  // POST /payments/webhook — mobile money webhook (no auth required)
  app.post('/webhook', {
    config: {
      rawBody: true,
      rateLimit: { max: 60, timeWindow: '1 minute' },
    },
  }, async (request, reply) => {
    const secret = process.env.MOBILE_MONEY_WEBHOOK_SECRET
    if (secret && !validWebhookSecret(request.headers['x-webhook-secret'], secret)) {
      return reply.status(401).send({ error: 'Invalid webhook secret' })
    }
    if (!secret && process.env.NODE_ENV === 'production') {
      return reply.status(503).send({ error: 'Mobile money webhook secret is not configured' })
    }

    const payload = webhookSchema.parse(request.body)
    const result = await mobileMoneyProvider.handleWebhook(payload)

    if (result.status === 'CONFIRMED') {
      await prisma.payment.updateMany({
        where: { reference: result.transactionId, status: 'PENDING' },
        data: { status: 'CONFIRMED' },
      })
    } else {
      await prisma.payment.updateMany({
        where: { reference: result.transactionId, status: 'PENDING' },
        data: { status: 'FAILED' },
      })
    }

    return { received: true }
  })
}
