import type { FastifyPluginAsync } from 'fastify'
import { channelsService } from './channels.service.js'
import { authenticate }    from '../../middleware/authenticate.js'
import { authorize }       from '../../middleware/authorize.js'
import { z }               from 'zod'
import { prisma }          from '../../lib/prisma.js'
import { verifyPassword }  from '../../lib/password.js'
import { validateApprovalToken } from '../auth/manager-approve.routes.js'

const createChannelSchema = z.object({
  name:           z.string().min(1),
  code:           z.string().min(1).max(20),
  type:           z.enum(['RETAIL_SHOP', 'WHOLESALE_SHOP', 'WAREHOUSE', 'ONLINE']),
  isMainWarehouse: z.boolean().optional(),
  address:        z.string().optional(),
  phone:          z.string().min(10).max(13).regex(/^[+0-9]+$/, 'Invalid phone number format'),
  email:          z.string().email().optional().or(z.literal('')),
  featureFlags:   z.record(z.any()).optional(),
})

const updateChannelSchema = createChannelSchema.partial()

export const channelsRoutes: FastifyPluginAsync = async (app) => {
  // FIX: authenticate hook restored — was commented out for debug testing
  app.addHook('preHandler', authenticate)

  // GET /channels — returns all active channels for all authenticated users.
  // Uses $queryRaw to bypass soft-delete middleware and multi-tenant extension
  // completely — channel names must always be fully visible for UI dropdowns
  // (transfers, reports, etc). Data isolation is enforced at the record level,
  // not by hiding channel names.
  app.get('/', {
    preHandler: [authorize(
      'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER',
      'CASHIER', 'SALES_PERSON', 'STOREKEEPER', 'PROMOTER'
    )],
  }, async () => {
    const { prisma: db } = await import('../../lib/prisma.js')
    return db.$queryRaw`
      SELECT id, name, code, type, "isMainWarehouse",
             address, phone, email, "featureFlags",
             "createdAt", "updatedAt"
      FROM   channels
      WHERE  "deletedAt" IS NULL
      ORDER  BY name ASC
    `
  })

  // GET /channels/:id
  app.get('/:id', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id } = request.params as { id: string }
    if (request.user.role === 'MANAGER' && id !== request.user.channelId) {
      throw { statusCode: 403, message: 'You can only view your assigned channel' }
    }
    return channelsService.findById(id)
  })

  // POST /channels
  app.post('/', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const body              = createChannelSchema.parse(request.body)
    const { approvalToken } = z.object({ approvalToken: z.string().optional() }).parse(request.body)

    if (request.user.role === 'MANAGER') {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      if (!approvalToken) {
        const approval = await prisma.managerApproval.create({
          data: {
            action:      'channel_create',
            contextId:   'new_channel',
            channelId:   request.user.channelId ?? undefined,
            requesterId: request.user.sub,
            notes:       `Create channel: ${body.name}`,
          },
        })
        return reply.status(403).send({
          error:     'Administrator Manager approval required for channel creation',
          approvalId: approval.id,
          message:   'An approval request has been sent to the Administrator Manager.',
        })
      }
      const approved = await validateApprovalToken(
        approvalToken, 'channel_create', 'new_channel', request.user.channelId
      )
      if (!approved) return reply.status(403).send({ error: 'Invalid or expired Administrator Manager approval' })
    }

    const channel = await channelsService.create(body)
    reply.status(201).send(channel)
  })

  // PATCH /channels/:id
  app.patch('/:id', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { id }            = request.params as { id: string }
    const body              = updateChannelSchema.parse(request.body)
    const { approvalToken } = z.object({ approvalToken: z.string().optional() }).parse(request.body)

    if (request.user.role === 'MANAGER') {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      if (!approvalToken) {
        const approval = await prisma.managerApproval.create({
          data: {
            action:      'channel_update',
            contextId:   id,
            channelId:   request.user.channelId ?? undefined,
            requesterId: request.user.sub,
          },
        })
        return reply.status(403).send({
          error:     'Administrator Manager approval required for channel updates',
          approvalId: approval.id,
          message:   'An approval request has been sent to the Administrator Manager.',
        })
      }
      const approved = await validateApprovalToken(
        approvalToken, 'channel_update', id, request.user.channelId
      )
      if (!approved) return reply.status(403).send({ error: 'Invalid or expired Administrator Manager approval' })
    }

    return channelsService.update(id, body)
  })

  // DELETE /channels/:id
  app.delete('/:id', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { id }                   = request.params as { id: string }
    const { password, approvalToken } = z.object({
      password:      z.string(),
      approvalToken: z.string().optional(),
    }).parse(request.body)

    if (request.user.role === 'MANAGER') {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      if (!approvalToken) {
        const approval = await prisma.managerApproval.create({
          data: {
            action:      'channel_delete',
            contextId:   id,
            channelId:   request.user.channelId ?? undefined,
            requesterId: request.user.sub,
          },
        })
        return reply.status(403).send({
          error:     'Administrator Manager approval required for channel deletion',
          approvalId: approval.id,
          message:   'An approval request has been sent to the Administrator Manager.',
        })
      }
      const approved = await validateApprovalToken(
        approvalToken, 'channel_delete', id, request.user.channelId
      )
      if (!approved) return reply.status(403).send({ error: 'Invalid or expired Administrator Manager approval' })
    }

    const admin = await prisma.user.findUniqueOrThrow({
      where:  { id: request.user.sub },
      select: { passwordHash: true },
    })
    const isValid = await verifyPassword(admin.passwordHash, password)
    if (!isValid) return reply.status(403).send({ error: 'Invalid administrator password' })

    return channelsService.softDelete(id)
  })
}
