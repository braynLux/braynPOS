import type { FastifyPluginAsync } from 'fastify'
import { expensesService } from './expenses.service.js'
import { authenticate }    from '../../middleware/authenticate.js'
import { authorize }       from '../../middleware/authorize.js'
import { RATE }            from '../../lib/rate-limit.plugin.js'
import { prisma }          from '../../lib/prisma.js'
import { z }               from 'zod'

const HQ_EXPENSE_ROLES = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export const expensesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // GET /expenses
  app.get('/', {
    config:     RATE.READ,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const query = z.object({
      channelId: z.string().uuid().optional(),
      startDate: z.string().optional(),
      endDate:   z.string().optional(),
      page:      z.coerce.number().min(1).optional(),
      limit:     z.coerce.number().min(1).max(100).optional(),
    }).parse(request.query)

    if (!HQ_EXPENSE_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      query.channelId = request.user.channelId
    }

    return expensesService.findAll(query)
  })

  // GET /expenses/:id
  // FIX 5: Added authorize() — was open to any authenticated user.
  // Expense records contain amount, description, and channel data.
  app.get('/:id', {
    config:     RATE.READ,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { id }    = request.params as { id: string }
    const isHQ      = HQ_EXPENSE_ROLES.includes(request.user.role)
    if (!isHQ && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    const channelId = isHQ ? undefined : (request.user.channelId || undefined)
    const expense   = await expensesService.findById(id, channelId)

    if (!isHQ && expense.channelId !== request.user.channelId) {
      return reply.status(403).send({ error: 'Forbidden', message: 'You do not have access to this expense' })
    }

    return expense
  })

  // POST /expenses
  app.post('/', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const body = z.object({
      channelId:   z.string().uuid(),
      description: z.string().min(1).max(200),
      amount:      z.coerce.number().positive(),
      category:      z.string().optional(),
      receiptRef:    z.string().optional(),
      notes:         z.string().max(500).optional(),
      paymentSource: z.enum(['CASH', 'BANK', 'CREDITOR', 'CAPITAL']).optional(),
    }).parse(request.body)

    if (!HQ_EXPENSE_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      if (body.channelId !== request.user.channelId) {
        throw { statusCode: 403, message: 'You can only record expenses for your assigned channel' }
      }
    }

    const expense = await expensesService.create({ ...body, createdBy: request.user.sub })
    reply.status(201).send(expense)
  })

  // DELETE /expenses/:id
  app.delete('/:id', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { id }            = request.params as { id: string }
    const { approvalToken } = z.object({ approvalToken: z.string().optional() }).parse(request.body || {})

    if (request.user.role === 'MANAGER') {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      if (!approvalToken) {
        // FIX 9: Use top-level prisma import — dynamic import was redundant
        const approval = await (prisma as any).managerApproval.create({
          data: {
            action:      'expense_delete',
            contextId:   id,
            channelId:   request.user.channelId!,
            requesterId: request.user.sub,
          },
        })
        return reply.status(403).send({
          error:      'Administrator Manager approval required for expense deletion',
          approvalId: approval.id,
          message:    'An approval request has been sent to the Administrator Manager.',
        })
      }

      const { validateApprovalToken } = await import('../auth/manager-approve.routes.js')
      // FIX 8: Pass channelId to prevent cross-channel approval token replay
      const approved = await validateApprovalToken(
        approvalToken, 'expense_delete', id, request.user.channelId || undefined
      )
      if (!approved) {
        return reply.status(403).send({ error: 'Invalid or expired Administrator Manager approval' })
      }
    }

    const isHQ      = HQ_EXPENSE_ROLES.includes(request.user.role)
    const channelId = isHQ ? undefined : (request.user.channelId || undefined)

    // FIX 1: Correct param order — was passing request.user.sub as channelId.
    // service.softDelete(id, channelId, deletedBy)
    return expensesService.softDelete(id, channelId, request.user.sub)
  })

  // GET /expenses/categories — shared, team-wide category list
  app.get('/categories', {
    config:     RATE.READ,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const isHQ = HQ_EXPENSE_ROLES.includes(request.user.role)
    return prisma.expenseCategory.findMany({
      where:   { isActive: true, ...(!isHQ && { channelId: request.user.channelId ?? null }) },
      orderBy: { name: 'asc' },
    })
  })

  // POST /expenses/categories
  app.post('/categories', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { name } = z.object({ name: z.string().min(1).max(100) }).parse(request.body)
    const isHQ = HQ_EXPENSE_ROLES.includes(request.user.role)

    if (!isHQ && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }

    const channelId = isHQ ? null : request.user.channelId
    const existing = await prisma.expenseCategory.findFirst({ where: { channelId, name } })
    const category = existing
      ? await prisma.expenseCategory.update({ where: { id: existing.id }, data: { isActive: true } })
      : await prisma.expenseCategory.create({ data: { name, channelId } })
    reply.status(201).send(category)
  })
}
