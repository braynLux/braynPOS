import type { FastifyPluginAsync } from 'fastify'
import { assetsService } from './assets.service.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { RATE } from '../../lib/rate-limit.plugin.js'
import { z } from 'zod'

const HQ_ASSET_ROLES = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export const assetsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // GET /accounting/assets
  app.get('/', {
    config: RATE.READ,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const { channelId } = z.object({ channelId: z.string().uuid().optional() }).parse(request.query)
    const isHQ = HQ_ASSET_ROLES.includes(request.user.role)
    const targetChannel = isHQ ? (channelId || request.user.channelId) : request.user.channelId
    
    if (!targetChannel) throw app.httpErrors.badRequest('Channel ID required')
    return assetsService.getAssets(targetChannel)
  })

  // POST /accounting/assets
  app.post('/', {
    config: RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const schema = z.object({
      name: z.string().trim().min(1).max(120),
      code: z.string().trim().min(1).max(80),
      category: z.string().trim().min(1).max(80),
      purchaseDate: z.string().refine(value => !isNaN(new Date(value).getTime()), 'Invalid purchase date'),
      purchasePrice: z.coerce.number().positive(),
      depreciationRate: z.coerce.number().min(0).max(100),
      channelId: z.string().uuid(),
      notes: z.string().max(500).optional()
    })
    
    const body = schema.parse(request.body)
    const isHQ = HQ_ASSET_ROLES.includes(request.user.role)
    if (!isHQ && body.channelId !== request.user.channelId) {
      throw { statusCode: 403, message: 'You can only create assets for your assigned channel' }
    }

    const asset = await assetsService.createAsset({
      ...body,
      channelId: isHQ ? body.channelId : request.user.channelId!,
    })
    reply.status(201).send(asset)
  })
}
