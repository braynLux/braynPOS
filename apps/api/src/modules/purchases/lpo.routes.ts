import type { FastifyPluginAsync } from 'fastify'
import { lpoService } from './lpo.service.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { z } from 'zod'

const HQ_LPO_ROLES = ['PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export const lpoRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'STOREKEEPER')],
  }, async (request) => {
    const query = z.object({
      channelId: z.string().uuid().optional(),
      status: z.enum(['DRAFT', 'SENT', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED']).optional(),
      page: z.coerce.number().min(1).optional(),
      limit: z.coerce.number().min(1).max(100).optional(),
    }).parse(request.query)

    if (!HQ_LPO_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      query.channelId = request.user.channelId
    }

    return lpoService.findAll(query)
  })

  app.get('/:id', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'STOREKEEPER')],
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const isHQ = HQ_LPO_ROLES.includes(request.user.role)
    if (!isHQ && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    return lpoService.findById(id, isHQ ? undefined : request.user.channelId!)
  })

  app.post('/', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const body = z.object({
      supplierId: z.string().uuid(),
      channelId: z.string().uuid(),
      lines: z.array(z.object({
        itemId: z.string(),
        quantity: z.coerce.number().int().positive(),
        unitCost: z.coerce.number().min(0),
      })).min(1),
      notes: z.string().optional(),
      expectedDate: z.string().optional(),
    }).parse(request.body)

    if (!HQ_LPO_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      if (body.channelId !== request.user.channelId) {
      throw { statusCode: 403, message: 'You can only create LPOs for your assigned channel' }
      }
    }

    const lpo = await lpoService.create({ ...body, createdBy: request.user.sub })
    reply.status(201).send(lpo)
  })

  app.post('/:id/send', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const channelId = HQ_LPO_ROLES.includes(request.user.role) ? undefined : (request.user.channelId ?? undefined)
    if (!HQ_LPO_ROLES.includes(request.user.role) && !channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    return lpoService.send(id, channelId)
  })

  app.post('/:id/cancel', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const channelId = HQ_LPO_ROLES.includes(request.user.role) ? undefined : (request.user.channelId ?? undefined)
    if (!HQ_LPO_ROLES.includes(request.user.role) && !channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    return lpoService.cancel(id, channelId)
  })
}
