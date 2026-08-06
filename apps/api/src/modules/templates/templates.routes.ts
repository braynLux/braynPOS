import type { FastifyPluginAsync } from 'fastify'
import { templatesService } from './templates.service.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { z } from 'zod'

export const templatesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  const isHQRole = (role: string) => ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN'].includes(role)

  app.get('/', async (request) => {
    const isHQ = isHQRole(request.user.role)
    const channelId = request.user.channelId
    if (!isHQ && !channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    return templatesService.findAll(isHQ ? undefined : channelId!)
  })
  
  app.get('/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const isHQ = isHQRole(request.user.role)
    const channelId = request.user.channelId
    if (!isHQ && !channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    return templatesService.findById(id, isHQ ? undefined : channelId!)
  })

  app.post('/', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN')],
  }, async (request, reply) => {
    const body = z.object({
      name: z.string().min(1),
      type: z.string().min(1),
      content: z.string(),
    }).parse(request.body)
    
    reply.status(201).send(await templatesService.create({
      ...body,
      channelId: request.user.channelId || undefined
    }))
  })

  app.patch('/:id', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN')],
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      name: z.string().optional(),
      content: z.string().optional(),
      isActive: z.boolean().optional(),
    }).parse(request.body)
    
    const isHQ = isHQRole(request.user.role)
    const channelId = request.user.channelId
    if (!isHQ && !channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    
    return templatesService.update(id, isHQ ? undefined : channelId!, body)
  })
}
