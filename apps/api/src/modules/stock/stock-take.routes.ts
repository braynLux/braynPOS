import type { FastifyPluginAsync } from 'fastify'
import { stockTakeService } from './stock-take.service.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { RATE } from '../../lib/rate-limit.plugin.js'
import { z } from 'zod'

const HQ_STOCK_TAKE_ROLES = ['PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export const stockTakeRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // POST /api/v1/stock/take
  app.post('/', {
    preHandler: [authorize('PLATFORM_OWNER', 'MANAGER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN')]
  }, async (request) => {
    const { channelId } = z.object({
      channelId: z.string().uuid()
    }).parse(request.body)
    if (!HQ_STOCK_TAKE_ROLES.includes(request.user.role) && channelId !== request.user.channelId) {
      throw { statusCode: 403, message: 'You can only start stock takes for your assigned channel' }
    }
    
    return stockTakeService.start(channelId, request.user.sub)
  })

  // GET /api/v1/stock/take
  app.get('/', {
    config: RATE.STOCK_READ,
    preHandler: [authorize('PLATFORM_OWNER', 'STOREKEEPER', 'MANAGER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN')],
  }, async (request) => {
    const query = z.object({
      channelId: z.string().uuid().optional()
    }).parse(request.query)

    let cid = query.channelId
    if (!HQ_STOCK_TAKE_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      cid = request.user.channelId || undefined
    }
    
    return stockTakeService.list(cid)
  })

  // GET /api/v1/stock/take/:id
  app.get('/:id', {
    config: RATE.STOCK_READ,
    preHandler: [authorize('PLATFORM_OWNER', 'STOREKEEPER', 'MANAGER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN')],
  }, async (request) => {
    const { id } = request.params as { id: string }
    const take = await stockTakeService.getTakeDetails(id, request.user.role)
    if (!HQ_STOCK_TAKE_ROLES.includes(request.user.role) && take.channelId !== request.user.channelId) {
      throw { statusCode: 403, message: 'You do not have access to this stock take' }
    }
    return take
  })

  // POST /api/v1/stock/take/:id/record
  app.post('/:id/record', {
    preHandler: [authorize('PLATFORM_OWNER', 'STOREKEEPER', 'MANAGER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN')]
  }, async (request) => {
    const { id } = request.params as { id: string }
    const { itemId, recordedQty } = z.object({
      itemId: z.string().uuid(),
      recordedQty: z.number().int().min(0)
    }).parse(request.body)
    const take = await stockTakeService.getTakeDetails(id, request.user.role)
    if (!HQ_STOCK_TAKE_ROLES.includes(request.user.role) && take.channelId !== request.user.channelId) {
      throw { statusCode: 403, message: 'You cannot record counts for another channel' }
    }
    
    return stockTakeService.recordCount(id, itemId, recordedQty)
  })

  // POST /api/v1/stock/take/:id/complete
  app.post('/:id/complete', {
    preHandler: [authorize('PLATFORM_OWNER', 'MANAGER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN')]
  }, async (request) => {
    const { id } = request.params as { id: string }
    const take = await stockTakeService.getTakeDetails(id, request.user.role)
    if (!HQ_STOCK_TAKE_ROLES.includes(request.user.role) && take.channelId !== request.user.channelId) {
      throw { statusCode: 403, message: 'You cannot complete stock takes for another channel' }
    }
    return stockTakeService.complete(id, request.user.sub)
  })
}
