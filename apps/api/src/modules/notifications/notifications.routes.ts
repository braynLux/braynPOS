import type { FastifyPluginAsync } from 'fastify'
import { NotificationService } from './notifications.service.js'
import { authenticate } from '../../middleware/authenticate.js'
import { z } from 'zod'

const GLOBAL_NOTIFICATION_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN']

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // Get notification history
  app.get('/', async (request) => {
    const { page, limit } = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(request.query)

    const isGlobalRole = GLOBAL_NOTIFICATION_ROLES.includes(request.user.role)
    const channelId = isGlobalRole ? undefined : request.user.channelId

    if (!isGlobalRole && !channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }

    return NotificationService.getHistory(channelId, page, limit)
  })

  // Mark as read
  app.post('/:id/read', async (request) => {
    const { id } = request.params as { id: string }
    return NotificationService.markAsRead(id, request.user.role, request.user.channelId)
  })
}
