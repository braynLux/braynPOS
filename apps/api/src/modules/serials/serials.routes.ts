import type { FastifyPluginAsync } from 'fastify'
import { serialsService } from './serials.service.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { requirePlanFeature } from '../../middleware/plan-guard.js'
import { z } from 'zod'

export const serialsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)
  app.addHook('preHandler', requirePlanFeature('serials'))
  const isGlobalRole = (role: string) => ['PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN'].includes(role)

  // GET /serials?itemId=xxx&channelId=xxx
  app.get('/', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'STOREKEEPER', 'CASHIER')],
  }, async (request) => {
    const query = z.object({
      itemId: z.string(),
      channelId: z.string().uuid().optional(),
    }).parse(request.query)
    if (!isGlobalRole(request.user.role)) {
      if (!request.user.channelId) throw { statusCode: 400, message: 'User is not assigned to a channel' }
      query.channelId = request.user.channelId
    }
    return serialsService.findByItem(query.itemId, query.channelId)
  })

  // GET /serials/lookup/:serialNo
  app.get('/lookup/:serialNo', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'STOREKEEPER', 'CASHIER', 'SALES_PERSON', 'PROMOTER')],
  }, async (request) => {
    const { serialNo } = request.params as { serialNo: string }
    const serial = await serialsService.findBySerialNo(serialNo, request.user)
    if (!serial) throw { statusCode: 404, message: 'Serial not found' }
    return serial
  })

  // GET /serials/search?q=xxx
  app.get('/search', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'STOREKEEPER', 'CASHIER', 'SALES_PERSON', 'PROMOTER')],
  }, async (request) => {
    const { q } = z.object({ q: z.string().min(1) }).parse(request.query)
    return serialsService.searchSerials(q, request.user)
  })

  // GET /serials/available?itemId=xxx&channelId=xxx
  app.get('/available', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'STOREKEEPER', 'CASHIER', 'SALES_PERSON', 'PROMOTER')],
  }, async (request) => {
    const query = z.object({
      itemId: z.string(),
      channelId: z.string().uuid(),
    }).parse(request.query)
    if (!isGlobalRole(request.user.role) && !request.user.channelId) {
      throw { statusCode: 400, message: 'User is not assigned to a channel' }
    }
    if (!isGlobalRole(request.user.role) && query.channelId !== request.user.channelId) {
      throw { statusCode: 403, message: 'You can only view serials in your assigned channel' }
    }
    return serialsService.findAvailableInChannel(query.itemId, query.channelId)
  })

  // POST /serials
  app.post('/', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'STOREKEEPER')],
  }, async (request, reply) => {
    const body = z.object({
      serialNo: z.string().min(1),
      itemId: z.string(),
      channelId: z.string().uuid(),
    }).parse(request.body)
    if (!isGlobalRole(request.user.role) && !request.user.channelId) {
      throw { statusCode: 400, message: 'User is not assigned to a channel' }
    }
    if (!isGlobalRole(request.user.role) && body.channelId !== request.user.channelId) {
      throw { statusCode: 403, message: 'You can only create serials in your assigned channel' }
    }
    const serial = await serialsService.create(body)
    reply.status(201).send(serial)
  })

  // POST /serials/bulk
  app.post('/bulk', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'STOREKEEPER')],
  }, async (request, reply) => {
    const body = z.object({
      serials: z.array(z.object({
        serialNo: z.string().min(1),
        itemId: z.string(),
        channelId: z.string().uuid(),
      })).min(1).max(500),
    }).parse(request.body)
    if (!isGlobalRole(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'User is not assigned to a channel' }
      }
      const invalid = body.serials.some(serial => serial.channelId !== request.user.channelId)
      if (invalid) throw { statusCode: 403, message: 'You can only create serials in your assigned channel' }
    }
    const result = await serialsService.createMany(body.serials)
    reply.status(201).send(result)
  })

  // POST /serials/:id/write-off
  app.post('/:id/write-off', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    if (!isGlobalRole(request.user.role) && !request.user.channelId) {
      throw { statusCode: 400, message: 'User is not assigned to a channel' }
    }
    return serialsService.writeOff(id, isGlobalRole(request.user.role) ? undefined : request.user.channelId!)
  })
}
