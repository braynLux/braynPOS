import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize }    from '../../middleware/authorize.js'
import { requirePlanFeature } from '../../middleware/plan-guard.js'
import {
  calculateCommission,
  buildCommissionPayout,
  getCommissionSummary,
  getCommissionStats,
} from './commission.service.js'
import { basePrisma, prisma } from '../../lib/prisma.js'

const ruleSchema = z.object({
  name:             z.string().min(1),
  channelId:        z.string().uuid().optional().nullable(),
  userId:           z.string().uuid().optional().nullable(),
  role:             z.enum(['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER', 'CASHIER', 'STOREKEEPER', 'PROMOTER', 'SALES_PERSON']).optional().nullable(),
  ratePercent:      z.coerce.number().min(0).max(100),
  minMarginPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  appliesTo:        z.array(z.enum(['WHOLESALE', 'RETAIL', 'CREDIT', 'PRE_ORDER', 'LAYAWAY'])).optional().default([]),
  isActive:         z.boolean().optional().default(true),
})

const payoutRequestSchema = z.object({
  userId:      z.string().uuid(),
  periodStart: z.string(),
  periodEnd:   z.string(),
  channelId:   z.string().uuid().optional(),
})

const HQ_COMMISSION_ROLES = ['PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export const commissionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)
  app.addHook('preHandler', requirePlanFeature('commissions'))

  const isHQ = (role: string) => HQ_COMMISSION_ROLES.includes(role)

  app.get('/stats', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const query = z.object({
      channelId: z.string().uuid().optional(),
      userId:    z.string().uuid().optional(),
      startDate: z.string().optional(),
      endDate:   z.string().optional(),
    }).parse(request.query)
    if (!isHQ(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      query.channelId = request.user.channelId
    }
    return getCommissionStats(query.channelId, query.userId, query.startDate, query.endDate)
  })

  app.get('/', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER', 'SALES_PERSON', 'PROMOTER')],
  }, async (request) => {
    const query = z.object({
      userId:    z.string().uuid().optional(),
      channelId: z.string().uuid().optional(),
      status:    z.enum(['PENDING', 'APPROVED', 'PAID', 'VOIDED']).optional(),
      startDate: z.string().optional(),
      endDate:   z.string().optional(),
      page:      z.coerce.number().min(1).optional(),
      limit:     z.coerce.number().min(1).max(100).optional(),
    }).parse(request.query)
    if (!isHQ(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      query.channelId = request.user.channelId
      if (request.user.role !== 'MANAGER') {
        query.userId = request.user.sub
      }
    }
    return getCommissionSummary(query, request.user)
  })

  app.post('/rules', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN')],
  }, async (request, reply) => {
    const body = ruleSchema.parse(request.body)
    const rule = await prisma.commissionRule.create({ data: body as any })
    reply.status(201).send(rule)
  })

  app.get('/rules', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const { channelId } = z.object({ channelId: z.string().uuid().optional() }).parse(request.query)
    let effectiveChannelId = channelId
    if (!isHQ(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      effectiveChannelId = request.user.channelId
    }
    return prisma.commissionRule.findMany({
      where:   effectiveChannelId ? { OR: [{ channelId: effectiveChannelId }, { channelId: null }] } : {},
      orderBy: { createdAt: 'desc' },
    })
  })

  app.patch('/rules/:id', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN')],
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body   = ruleSchema.partial().parse(request.body)
    return prisma.commissionRule.update({ where: { id }, data: body as any })
  })

  app.delete('/rules/:id', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN')],
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    await prisma.commissionRule.update({ where: { id }, data: { isActive: false } })
    return { message: 'Rule deactivated' }
  })

  app.patch('/:id/approve', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const existing = await basePrisma.commissionEntry.findUniqueOrThrow({ where: { id } })
    if (!isHQ(request.user.role) && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    if (!isHQ(request.user.role) && existing.channelId !== request.user.channelId) {
      throw { statusCode: 403, message: 'You can only approve commission entries for your assigned channel' }
    }
    const result = await basePrisma.commissionEntry.updateMany({
      where: { id, status: 'PENDING' },
      data:  { status: 'APPROVED' },
    })
    if (result.count === 0) {
      throw { statusCode: 409, message: 'Only pending commission entries can be approved' }
    }
    return basePrisma.commissionEntry.findUniqueOrThrow({ where: { id } })
  })

  app.post('/payout', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const body   = payoutRequestSchema.parse(request.body)
    if (!isHQ(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      body.channelId = request.user.channelId
    }
    const result = await buildCommissionPayout(
      body.userId,
      new Date(body.periodStart),
      new Date(body.periodEnd),
      body.channelId
    )
    if (!result) {
      reply.status(404).send({ error: 'No approved commission entries found for this period' })
      return
    }
    reply.status(201).send(result)
  })

  // ── Single sale recalculation ─────────────────────────────────────
  app.post('/recalculate/:saleId', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN')],
  }, async (request) => {
    const { saleId } = request.params as { saleId: string }
    const result     = await calculateCommission(saleId)
    if (!result) return { message: 'No commission applicable for this sale' }
    return result
  })

  // ── Bulk recalculate entire month ─────────────────────────────────
  // Finds all sales in the given month that have no commission entry yet
  // and runs calculateCommission for each one using current active rules.
  // Safe to run multiple times — calculateCommission is idempotent.
  // After running this, delete the draft salary run and create a new one
  // — it will automatically include all newly calculated commissions.
  app.post('/recalculate-month', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN')],
  }, async (request) => {
    const { month, year } = z.object({
      month: z.coerce.number().int().min(1).max(12),
      year:  z.coerce.number().int().min(2020).max(2100),
    }).parse(request.body)

    const periodStart = new Date(year, month - 1, 1)
    const periodEnd   = new Date(year, month, 0, 23, 59, 59, 999)

    const sales = await prisma.sale.findMany({
      where: {
        deletedAt:       null,
        createdAt:       { gte: periodStart, lte: periodEnd },
        commissionEntry: null,
      },
      select: { id: true, receiptNo: true },
    })

    if (sales.length === 0) {
      return {
        message:    'All sales for this period already have commission entries',
        processed:  0,
        calculated: 0,
        skipped:    0,
      }
    }

    let calculated = 0
    let skipped    = 0
    const details: string[] = []

    for (const sale of sales) {
      try {
        const result = await calculateCommission(sale.id)
        if (result) {
          calculated++
          details.push(`✓ ${sale.receiptNo}`)
        } else {
          skipped++
          details.push(`— ${sale.receiptNo} (no margin or no matching rule)`)
        }
      } catch (err: any) {
        skipped++
        details.push(`✗ ${sale.receiptNo}: ${err?.message ?? 'unknown error'}`)
      }
    }

    return {
      message:    `Commission recalculated for ${month}/${year}`,
      processed:  sales.length,
      calculated,
      skipped,
      details,
    }
  })
}
