import { FastifyPluginAsync } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { storeApprovalToken } from '../../lib/pg-store.js'

export const managerApprovalsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // GET /api/v1/users/approvals
  app.get('/', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const where: any = { status: 'PENDING' }
    
    // Standard Managers only see their channel's approvals
    if (request.user.role === 'MANAGER') {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      where.channelId = request.user.channelId
    }

    const approvals = await prisma.managerApproval.findMany({
      where,
      include: {
        requester: { select: { id: true, username: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return approvals
  })

  // GET /api/v1/users/approvals/my-requests
  app.get('/my-requests', async (request) => {
    const approvals = await prisma.managerApproval.findMany({
      where: { requesterId: request.user.sub },
      orderBy: { createdAt: 'desc' },
      take: 20
    })
    return approvals
  })

  // POST /api/v1/users/approvals/:id/approve
  app.post('/:id/approve', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const approval = await prisma.managerApproval.findUnique({
      where: { id },
    })

    if (!approval || approval.status !== 'PENDING') {
      return reply.status(404).send({ error: 'Pending approval request not found' })
    }

    // Permission check for standard managers
    if (request.user.role === 'MANAGER') {
      if (!request.user.channelId) {
        return reply.status(400).send({ error: 'Your account has no channel assigned' })
      }
      if (approval.channelId !== request.user.channelId) {
        return reply.status(403).send({ error: 'Unauthorized: Approval request is for a different channel' })
      }
      const adminOnlyActions = [
        'user_create', 'user_delete', 'user_update',
        'channel_create', 'channel_update', 'channel_delete',
        'purchase_delete', 'expense_delete',
      ]
      if (adminOnlyActions.includes(approval.action)) {
        return reply.status(403).send({ error: 'Higher level admin approval required for this action' })
      }
    }

    const approvalToken = randomUUID()
    await storeApprovalToken(approvalToken, { 
      action: approval.action, 
      contextId: approval.contextId, 
      channelId: approval.channelId, 
      approverId: request.user.sub, 
      actorId: approval.requesterId 
    }, 3600)

    // If it's a user creation approval, activate the user
    if (approval.action === 'user_create') {
      try {
        await prisma.user.update({
          where: { id: approval.contextId },
          data: { status: 'ACTIVE' }
        })
      } catch (err) {
        console.error('Failed to activate user during approval:', err)
      }
    }

    await prisma.managerApproval.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: request.user.sub,
        approvalToken: approvalToken,
        expiresAt: new Date(Date.now() + 3600000)
      }
    })

    return { message: 'Approved successfully', approvalToken }
  })

  // POST /api/v1/users/approvals/:id/reject
  app.post('/:id/reject', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { notes } = z.object({ notes: z.string().optional() }).parse(request.body)

    const approval = await prisma.managerApproval.findUnique({
      where: { id },
    })

    if (!approval || approval.status !== 'PENDING') {
      return reply.status(404).send({ error: 'Pending approval request not found' })
    }

    // Permission check for standard managers
    if (request.user.role === 'MANAGER') {
      if (!request.user.channelId) {
        return reply.status(400).send({ error: 'Your account has no channel assigned' })
      }
      if (approval.channelId !== request.user.channelId) {
        return reply.status(403).send({ error: 'Unauthorized' })
      }
    }

    await prisma.managerApproval.update({
      where: { id },
      data: {
        status: 'REJECTED',
        approvedById: request.user.sub,
        notes
      }
    })

    return { message: 'Rejected successfully' }
  })
}
