import type { FastifyPluginAsync } from 'fastify'
import { transfersService } from './transfers.service.js'
import { authenticate }     from '../../middleware/authenticate.js'
import { authorize }        from '../../middleware/authorize.js'
import { RATE }             from '../../lib/rate-limit.plugin.js'
import { z }                from 'zod'

const HQ_TRANSFER_ROLES = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export const transfersRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // GET /transfers
  app.get('/', {
    config:     RATE.READ,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'STOREKEEPER')],
  }, async (request) => {
    const query = z.object({
      channelId: z.string().uuid().optional(),
      status:    z.enum(['DRAFT', 'SENT', 'AWAITING_RECEIVER', 'RECEIVED', 'DISPUTED', 'REJECTED']).optional(),
      startDate: z.string().optional(),
      endDate:   z.string().optional(),
      page:      z.coerce.number().min(1).optional(),
      limit:     z.coerce.number().min(1).max(100).optional(),
    }).parse(request.query)

    if (!HQ_TRANSFER_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      query.channelId = request.user.channelId
    }

    return transfersService.findAll(query)
  })

  // GET /transfers/:id
  app.get('/:id', {
    config:     RATE.READ,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'STOREKEEPER')],
  }, async (request, reply) => {
    const { id }   = z.object({ id: z.string().uuid() }).parse(request.params)
    const transfer = await transfersService.findById(id)

    if (!HQ_TRANSFER_ROLES.includes(request.user.role)) {
      const ch = request.user.channelId
      if (!ch) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      if ((transfer as any).fromChannelId !== ch && (transfer as any).toChannelId !== ch) {
        return reply.status(403).send({ error: 'Forbidden' })
      }
    }
    return transfer
  })

  // POST /transfers
  app.post('/', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'STOREKEEPER')],
  }, async (request, reply) => {
    const body = z.object({
      fromChannelId: z.string().uuid(),
      toChannelId:   z.string().uuid(),
      lines: z.array(z.object({
        // FIX: was z.string().uuid() — rejects slug-style IDs like "item-mouse-002"
        // Some items were created before UUID enforcement; accept any non-empty string
        itemId:    z.string().min(1),
        quantity:  z.coerce.number().int().positive(),
        serialIds: z.array(z.string()).optional(),
      })).min(1),
      notes: z.string().max(500).optional(),
    }).parse(request.body)

    if (body.fromChannelId === body.toChannelId) {
      return reply.status(400).send({ error: 'Source and destination channel cannot be the same' })
    }

    if (!HQ_TRANSFER_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      if (body.fromChannelId !== request.user.channelId) {
        throw { statusCode: 403, message: 'You can only initiate transfers from your assigned channel' }
      }
    }

    const transfer = await transfersService.create({ ...body, sentBy: request.user.sub })
    reply.status(201).send(transfer)
  })

  // POST /transfers/:id/receive
  app.post('/:id/receive', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'STOREKEEPER')],
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body   = z.object({
      lines: z.array(z.object({
        itemId:           z.string().min(1),  // FIX: was uuid()
        receivedQuantity: z.coerce.number().int().min(0),
        disputeReason:    z.string().optional(),
      })).min(1),
    }).parse(request.body)
    const transfer = await transfersService.findById(id)
    if (!HQ_TRANSFER_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      if ((transfer as any).toChannelId !== request.user.channelId) {
        throw { statusCode: 403, message: 'You can only receive transfers sent to your assigned channel' }
      }
    }
    return transfersService.receive(id, request.user.sub, body.lines)
  })

  // POST /transfers/:id/cancel
  app.post('/:id/cancel', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const transfer = await transfersService.findById(id)
    if (!HQ_TRANSFER_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      if ((transfer as any).fromChannelId !== request.user.channelId) {
        throw { statusCode: 403, message: 'You can only cancel transfers from your assigned channel' }
      }
    }
    return transfersService.cancel(id, request.user.sub)
  })
}
