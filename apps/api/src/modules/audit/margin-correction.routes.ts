import { FastifyInstance } from 'fastify'
import { marginCorrectionService } from './margin-correction.service.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { z } from 'zod'

export async function marginCorrectionRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate)

  // List "Ghost Items" (weightedAvgCost = 0)
  fastify.get('/ghost-items', {
    preHandler: [authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN')]
  }, async (request) => {
    const { channelId } = request.query as { channelId?: string }
    return marginCorrectionService.listGhostItems(channelId)
  })

  // Bulk Repair Margins
  fastify.post('/repair', {
    preHandler: [authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN')]
  }, async (request, reply) => {
    const body = z.object({
      itemId:            z.string().uuid(),
      channelId:         z.string().uuid(),
      newCost:           z.number().positive(),
      newRetail:         z.number().positive().optional(),
      repairRecentSales: z.boolean().optional(),
    }).parse(request.body)

    const actorId = (request as any).user.sub
    const actorRole = (request as any).user.role
    return marginCorrectionService.repairMargin({ ...body, actorId, actorRole })
  })
}
