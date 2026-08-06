import type { FastifyPluginAsync } from 'fastify'
import { bankDepositsService } from './bank-deposits.service.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { z } from 'zod'

const HQ_ROLES = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export const bankDepositsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // ── Channel banks ────────────────────────────────────────────────────
  app.get('/banks', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const query = z.object({ channelId: z.string().uuid().optional() }).parse(request.query)
    if (!HQ_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
      query.channelId = request.user.channelId
    }
    return bankDepositsService.listBanks(query.channelId)
  })

  app.post('/banks', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const body = z.object({
      channelId:     z.string().uuid(),
      bankName:      z.string().min(1),
      accountName:   z.string().min(1),
      accountNumber: z.string().min(1),
      paybill:       z.string().optional(),
      branch:        z.string().optional(),
    }).parse(request.body)

    if (!HQ_ROLES.includes(request.user.role) && body.channelId !== request.user.channelId) {
      throw { statusCode: 403, message: 'You can only add banks for your assigned channel' }
    }

    const bank = await bankDepositsService.createBank(body)
    reply.status(201).send(bank)
  })

  // ── Deposits ─────────────────────────────────────────────────────────
  app.get('/', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const query = z.object({
      channelId: z.string().uuid().optional(),
      startDate: z.string().optional(),
      endDate:   z.string().optional(),
      page:      z.coerce.number().min(1).optional(),
      limit:     z.coerce.number().min(1).max(100).optional(),
    }).parse(request.query)

    if (!HQ_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
      query.channelId = request.user.channelId
    }
    return bankDepositsService.listDeposits(query)
  })

  app.get('/cash-position', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const query = z.object({ channelId: z.string().uuid().optional() }).parse(request.query)
    if (!HQ_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
      query.channelId = request.user.channelId
    }
    return bankDepositsService.cashPosition(query.channelId)
  })

  app.post('/', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const body = z.object({
      channelId: z.string().uuid(),
      amount:    z.coerce.number().positive(),
      reference: z.string().optional(),
      notes:     z.string().optional(),
    }).parse(request.body)

    if (!HQ_ROLES.includes(request.user.role) && body.channelId !== request.user.channelId) {
      throw { statusCode: 403, message: 'You can only log deposits for your assigned channel' }
    }

    const deposit = await bankDepositsService.create({ ...body, depositedBy: request.user.sub })
    reply.status(201).send(deposit)
  })
}
