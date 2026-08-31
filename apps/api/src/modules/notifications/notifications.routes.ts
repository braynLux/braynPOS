import type { FastifyPluginAsync } from 'fastify'
import { basePrisma as prisma } from '../../lib/prisma.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { BillingService } from '../enterprises/billing.service.js'
import { z } from 'zod'

export const systemNotificationsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // GET /notifications — Fetch notifications for current user/enterprise/platform owner
  app.get('/', async (request) => {
    const isPlatformOwner = request.user.role === 'PLATFORM_OWNER'
    const enterpriseId = request.user.enterpriseId

    const where: any = {}
    if (isPlatformOwner && !enterpriseId) {
      // Platform Owner gets global notifications (enterpriseId IS NULL)
      where.enterpriseId = null
    } else if (enterpriseId) {
      // Tenant user gets notifications for their enterprise
      where.enterpriseId = enterpriseId
    }

    const [notifications, unreadCount] = await Promise.all([
      prisma.systemNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.systemNotification.count({
        where: {
          ...where,
          isRead: false,
        },
      }),
    ])

    return {
      notifications,
      unreadCount,
    }
  })

  // PATCH /notifications/:id/read — Mark single notification as read
  app.patch('/:id/read', async (request) => {
    const { id } = request.params as { id: string }
    const updated = await prisma.systemNotification.update({
      where: { id },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    })
    return { message: 'Notification marked as read', notification: updated }
  })

  // POST /notifications/read-all — Mark all notifications as read in scope
  app.post('/read-all', async (request) => {
    const isPlatformOwner = request.user.role === 'PLATFORM_OWNER'
    const enterpriseId = request.user.enterpriseId

    const where: any = { isRead: false }
    if (isPlatformOwner && !enterpriseId) {
      where.enterpriseId = null
    } else if (enterpriseId) {
      where.enterpriseId = enterpriseId
    }

    await prisma.systemNotification.updateMany({
      where,
      data: {
        isRead: true,
        readAt: new Date(),
      },
    })

    return { message: 'All notifications marked as read' }
  })

  // POST /notifications/evaluate — Trigger subscription lifecycle & notification check
  app.post('/evaluate', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN')],
  }, async () => {
    return BillingService.evaluateSubscriptionsAndNotify()
  })
}
