import type { FastifyPluginAsync } from 'fastify'
import { findReturns, processReturn } from './returns.service.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { z } from 'zod'

const HQ_ROLES = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export const returnsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // ── Return report ────────────────────────────────────────────────────
  app.get('/', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER')],
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
    return findReturns(query)
  })

  // ── Process a return against a sale ─────────────────────────────────
  app.post('/:saleId', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER')],
  }, async (request, reply) => {
    const { saleId } = z.object({ saleId: z.string().uuid() }).parse(request.params)
    const { lines } = z.object({
      lines: z.array(z.object({
        saleItemId: z.string().uuid(),
        quantity:   z.coerce.number().int().positive(),
        reason:     z.string().max(200).optional(),
      })).min(1),
    }).parse(request.body)

    const isHQ = HQ_ROLES.includes(request.user.role)
    if (!isHQ && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }

    const result = await processReturn(saleId, lines, request.user.sub, request.user.role, isHQ ? undefined : request.user.channelId!)
    reply.status(201).send(result)
  })
}
