import type { FastifyPluginAsync } from 'fastify'
import { getCreditStatus, recordRepayment, adjustCreditLimit, getArAgingReport, getApBalanceSummary } from './credit.service.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize }    from '../../middleware/authorize.js'
import { requirePlanFeature } from '../../middleware/plan-guard.js'
import { RATE }         from '../../lib/rate-limit.plugin.js'
import { prisma }       from '../../lib/prisma.js'
import { z }            from 'zod'

const HQ_CREDIT_ROLES = ['PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export const creditRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)
  app.addHook('preHandler', requirePlanFeature('credit'))

  // GET /credit/status/:customerId
  app.get('/status/:customerId', {
    config:     RATE.READ,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER', 'SALES_PERSON')],
  }, async (request, reply) => {
    const { customerId } = request.params as { customerId: string }

    // FIX 13: Extend channel check to ALL non-admin roles, not just when
    // the role is not SUPER_ADMIN/MANAGER_ADMIN. Previously CASHIER and
    // SALES_PERSON could look up credit details for customers from any
    // channel — outstandingCredit, creditLimit, all recent sales included.
    if (!HQ_CREDIT_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      const customer = await prisma.customer.findUnique({
        where:  { id: customerId },
        select: { channelId: true },
      })
      if (!customer) {
        return reply.status(404).send({ error: 'Customer not found' })
      }
      if (customer.channelId && customer.channelId !== request.user.channelId) {
        return reply.status(403).send({
          error:   'Forbidden',
          message: 'Customer does not belong to your channel',
        })
      }
    }

    return getCreditStatus(customerId)
  })

  // GET /credit/outstanding/:customerId
  app.get('/outstanding/:customerId', {
    config:     RATE.READ,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER', 'SALES_PERSON')],
  }, async (request, reply) => {
    const { customerId } = request.params as { customerId: string }

    if (!HQ_CREDIT_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      const customer = await prisma.customer.findUnique({
        where:  { id: customerId },
        select: { channelId: true },
      })
      if (!customer) {
        return reply.status(404).send({ error: 'Customer not found' })
      }
      if (customer.channelId && customer.channelId !== request.user.channelId) {
        return reply.status(403).send({
          error:   'Forbidden',
          message: 'Customer does not belong to your channel',
        })
      }
    }

    const sales = await prisma.sale.findMany({
      where: { customerId, saleType: 'CREDIT', deletedAt: null },
      include: { payments: true }
    })

    const outstandingSales = sales.map(s => {
      const totalPaid = s.payments.filter(p => p.method !== 'CREDIT').reduce((sum, p) => sum + Number(p.amount), 0)
      const outstanding = Number(s.netAmount) - totalPaid
      return {
        saleId: s.id,
        receiptNo: s.receiptNo,
        totalAmount: Number(s.netAmount),
        totalPaid,
        outstanding,
        saleDate: s.createdAt,
        dueDate: s.dueDate
      }
    }).filter(s => s.outstanding > 0)

    return { outstandingSales }
  })

  // GET /credit/aging — accounts-receivable aging across all customers
  app.get('/aging', {
    config:     RATE.READ,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const isHQ = HQ_CREDIT_ROLES.includes(request.user.role)
    if (!isHQ && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    return getArAgingReport(isHQ ? undefined : request.user.channelId!)
  })

  // GET /credit/supplier-balances — approximate AP summary (see service docstring)
  app.get('/supplier-balances', {
    config:     RATE.READ,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const isHQ = HQ_CREDIT_ROLES.includes(request.user.role)
    if (!isHQ && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    return getApBalanceSummary(isHQ ? undefined : request.user.channelId!)
  })

  // POST /credit/repay
  app.post('/repay', {
    config:     RATE.SALE_COMMIT,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER', 'SALES_PERSON')],
  }, async (request, reply) => {
    const body = z.object({
      customerId: z.string().uuid(),
      amount:     z.coerce.number().positive(),
      method:     z.enum(['CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER']),
      reference:  z.string().max(100).optional().nullable(),
      notes:      z.string().max(500).optional().nullable(),
    }).parse(request.body)

    // Non-admins can only record repayments for their own channel's customers
    if (!HQ_CREDIT_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      const customer = await prisma.customer.findUnique({
        where:  { id: body.customerId },
        select: { channelId: true },
      })
      if (customer?.channelId && customer.channelId !== request.user.channelId) {
        return reply.status(403).send({
          error:   'Forbidden',
          message: 'Customer does not belong to your channel',
        })
      }
    }

    const result = await recordRepayment(body as any, request.user)
    reply.status(201).send(result)
  })

  // PATCH /api/v1/credit/adjust-limit
  app.patch('/adjust-limit', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const body = z.object({
      customerId: z.string().uuid(),
      newLimit:   z.coerce.number().min(0),
    }).parse(request.body)

    if (!HQ_CREDIT_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      const customer = await prisma.customer.findUnique({
        where:  { id: body.customerId },
        select: { channelId: true },
      })
      if (!customer) {
        throw { statusCode: 404, message: 'Customer not found' }
      }
      if (customer.channelId && customer.channelId !== request.user.channelId) {
        throw { statusCode: 403, message: 'Customer does not belong to your channel' }
      }
    }

    return adjustCreditLimit(body.customerId, body.newLimit, request.user)
  })
}
