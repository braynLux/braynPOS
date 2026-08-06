import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { z } from 'zod'

export const checklistRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)
  const isGlobalRole = (role: string) => ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN'].includes(role)

  // GET /settings/checklists
  app.get('/checklists', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const channelId = request.user.channelId || (request.query as any).channelId
    return prisma.serviceChecklist.findMany({
      where: { 
        ...(channelId && { channelId })
      },
      orderBy: { createdAt: 'desc' }
    })
  })

  // POST /settings/checklists
  app.post('/checklists', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const schema = z.object({
      name:      z.string().min(1),
      channelId: z.string().uuid(),
      fields:    z.array(z.object({
        label:    z.string().min(1),
        type:     z.enum(['CHECKBOX', 'TEXT', 'NUMBER']),
        required: z.boolean().default(false)
      }))
    })

    const body = schema.parse(request.body)
    if (!isGlobalRole(request.user.role) && body.channelId !== request.user.channelId) {
      throw { statusCode: 403, message: 'You can only create checklists for your assigned channel' }
    }
    const checklist = await prisma.serviceChecklist.create({
      data: {
        name:      body.name,
        channelId: body.channelId,
        fields:    body.fields as any
      }
    })
    reply.status(201).send(checklist)
  })

  // DELETE /settings/checklists/:id
  app.delete('/checklists/:id', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id } = request.params as { id: string }
    if (!isGlobalRole(request.user.role)) {
      const checklist = await prisma.serviceChecklist.findUnique({
        where:  { id },
        select: { channelId: true },
      })
      if (!checklist || checklist.channelId !== request.user.channelId) {
        throw { statusCode: 404, message: 'Checklist not found' }
      }
    }
    return prisma.serviceChecklist.delete({ where: { id } })
  })
}
