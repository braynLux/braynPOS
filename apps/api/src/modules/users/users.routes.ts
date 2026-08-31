import type { FastifyPluginAsync } from 'fastify'
import { usersService } from './users.service.js'
import { mfaService } from '../auth/mfa.service.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { registerSchema } from '../auth/auth.schema.js'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { verifyPassword } from '../../lib/password.js'
import { validateApprovalToken } from '../auth/manager-approve.routes.js'
import { assertUserQuota } from '../../middleware/plan-guard.js'

const updateUserSchema = z.object({
  username: z.string().min(3).optional(),
  email: z.string().email().optional().or(z.literal('')),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER', 'CASHIER', 'STOREKEEPER', 'PROMOTER', 'SALES_PERSON']).optional(),
  channelId: z.string().uuid().nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'PENDING']).optional(),
})

const listUsersQuery = z.object({
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER', 'CASHIER', 'STOREKEEPER', 'PROMOTER', 'SALES_PERSON']).optional(),
  channelId: z.string().uuid().optional(),
  search: z.string().optional(),
})

export const usersRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // GET /users/me
  app.get('/me', async (request) => {
    return usersService.findById(request.user.sub, request.user)
  })

  // PATCH /users/me
  app.patch('/me', async (request) => {
    const body = z.object({
      username: z.string().min(3).optional(),
      email: z.string().email().optional().or(z.literal('')),
    }).parse(request.body)
    return usersService.update(request.user.sub, body, request.user)
  })

  // PATCH /users/me/password
  app.patch('/me/password', async (request, reply) => {
    const { currentPassword, newPassword } = z.object({
      currentPassword: z.string(),
      newPassword: z.string().min(6),
    }).parse(request.body)

    await usersService.changePassword(request.user.sub, currentPassword, newPassword)
    return { message: 'Password updated successfully' }
  })

  // GET /users
  app.get('/', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request) => {
    const query = listUsersQuery.parse(request.query)
    
    // Strict Channel Isolation for regular Managers
    if (!['PLATFORM_OWNER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN'].includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      query.channelId = request.user.channelId
    }

    return usersService.findAll(query, request.user)
  })

  // GET /users/:id
  app.get('/:id', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id } = request.params as { id: string }
    return usersService.findById(id, request.user)
  })

  // POST /users
  app.post('/', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    // Enforce SaaS Subscription Plan User Quota
    await assertUserQuota(request.user.enterpriseId)

    // Inline schema to ensure validation picks up latest changes during debugging
    const createSchema = z.object({
      username: z.string().min(3).max(50),
      email: z.string().email(),
      password: z.string().min(8).max(100),
      role: z.enum(['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER', 'CASHIER', 'STOREKEEPER', 'PROMOTER', 'SALES_PERSON']),
      channelId: z.union([z.string().uuid(), z.null()]).optional(),
    })
    const body = createSchema.parse(request.body)
    const { approvalToken } = z.object({ approvalToken: z.string().optional() }).parse(request.body)

    // Security check: Only SUPER_ADMIN and PLATFORM_OWNER can create higher roles
    if (request.user.role !== 'SUPER_ADMIN' && request.user.role !== 'PLATFORM_OWNER') {
      if (['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN'].includes(body.role)) {
        return reply.status(403).send({ error: 'You do not have permission to create administrative roles' })
      }
    }

    // Security check: Enforce maximum administrative role counts per enterprise (only count non-deleted users)
    const enterpriseId = request.user.enterpriseId
    if (body.role === 'SUPER_ADMIN') {
      const count = await prisma.user.count({ where: { role: 'SUPER_ADMIN', enterpriseId, deletedAt: null } })
      if (count >= 1) return reply.status(403).send({ error: 'Maximum of 1 Super Admin allowed per enterprise' })
    } else if (body.role === 'ADMIN') {
      const count = await prisma.user.count({ where: { role: 'ADMIN', enterpriseId, deletedAt: null } })
      if (count >= 2) return reply.status(403).send({ error: 'Maximum of 2 Admins allowed per enterprise' })
    } else if (body.role === 'MANAGER_ADMIN') {
      const count = await prisma.user.count({ where: { role: 'MANAGER_ADMIN', enterpriseId, deletedAt: null } })
      if (count >= 2) return reply.status(403).send({ error: 'Maximum of 2 Manager Admins allowed per enterprise' })
    }

    // Security check: Managers and Manager Admins need Administrator Manager approval (for lower roles)
    if (request.user.role === 'MANAGER') {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      // Create user as PENDING
      const user = await usersService.create({ ...body, status: 'PENDING' }, request.user)
      
      // Create an asynchronous approval request
      const approval = await (prisma as any).managerApproval.create({
        data: {
          action: 'user_create',
          contextId: user.id,
          channelId: request.user.channelId,
          requesterId: request.user.sub,
          notes: `Pending creation for ${user.username}`
        }
      })

      return reply.status(201).send({ 
        ...user,
        message: 'User created. Administrator Manager approval required for activation.',
        approvalId: approval.id
      })
    }

    const user = await usersService.create(body, request.user)
    reply.status(201).send(user)
  })

  // PATCH /users/:id
  app.patch('/:id', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = updateUserSchema.parse(request.body)
    const { approvalToken } = z.object({ approvalToken: z.string().optional() }).parse(request.body)

    // Privilege Escalation Protection: Get target user's role
    const targetUser = await prisma.user.findUnique({ where: { id }, select: { role: true } })
    if (!targetUser) return reply.status(404).send({ error: 'User not found' })

    const { hasRole } = await import('../../middleware/authorize.js')
    
    // Non-SUPER_ADMINs/PLATFORM_OWNERs cannot modify users with higher or equal ranking
    if (request.user.role !== 'SUPER_ADMIN' && request.user.role !== 'PLATFORM_OWNER') {
      if (!hasRole(request.user, targetUser.role as any)) {
        return reply.status(403).send({ error: 'You cannot modify a user with a higher administrative rank' })
      }
      // Cannot promote someone to a role higher than themselves
      if (body.role && !hasRole(request.user, body.role as any)) {
         return reply.status(403).send({ error: 'You cannot promote a user to a rank higher than your own' })
      }
    }

    // Security check: Enforce maximum administrative role counts on promotion
    if (body.role && body.role !== targetUser.role) {
      const enterpriseId = request.user.enterpriseId
      if (body.role === 'SUPER_ADMIN') {
        const count = await prisma.user.count({ where: { role: 'SUPER_ADMIN', enterpriseId, deletedAt: null } })
        if (count >= 1) return reply.status(403).send({ error: 'Maximum of 1 Super Admin allowed per enterprise' })
      } else if (body.role === 'ADMIN') {
        const count = await prisma.user.count({ where: { role: 'ADMIN', enterpriseId, deletedAt: null } })
        if (count >= 2) return reply.status(403).send({ error: 'Maximum of 2 Admins allowed per enterprise' })
      } else if (body.role === 'MANAGER_ADMIN') {
        const count = await prisma.user.count({ where: { role: 'MANAGER_ADMIN', enterpriseId, deletedAt: null } })
        if (count >= 2) return reply.status(403).send({ error: 'Maximum of 2 Manager Admins allowed per enterprise' })
      }
    }

    // Security check: Only Managers need approval for sensitive changes
    if (request.user.role === 'MANAGER') {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      const isSensitive = body.role && !['CASHIER', 'STOREKEEPER', 'PROMOTER', 'SALES_PERSON'].includes(body.role)
      const isChannelChange = body.channelId !== undefined

      if (isSensitive || isChannelChange) {
        if (!approvalToken) {
          const approval = await (prisma as any).managerApproval.create({
            data: {
              action: 'user_update',
              contextId: id,
              channelId: request.user.channelId!,
              requesterId: request.user.sub,
              notes: `Update: ${JSON.stringify(body)}`
            }
          })
          return reply.status(403).send({ 
            error: 'Administrator Manager approval required for sensitive user updates', 
            approvalId: approval.id,
            message: 'An approval request has been sent to the Administrator Manager.'
          })
        }
        const approved = await validateApprovalToken(
          approvalToken, 'user_update', id, request.user.channelId || undefined
        )
        if (!approved) {
          return reply.status(403).send({ error: 'Invalid or expired Administrator Manager approval' })
        }
      }
    }

    return usersService.update(id, body, request.user)
  })

  // PATCH /users/:id/salary
  app.patch('/:id/salary', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id } = request.params as { id: string }
    const { grossSalary } = z.object({ grossSalary: z.number().min(0) }).parse(request.body)
    await usersService.findById(id, request.user)
    return usersService.updateSalary(id, grossSalary)
  })


  // DELETE /users/:id (soft delete)
  app.delete('/:id', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { password, approvalToken } = z.object({ 
      password: z.string(),
      approvalToken: z.string().optional()
    }).parse(request.body)

    // Security check: Managers need Administrator Manager approval
    if (request.user.role === 'MANAGER') {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      if (!approvalToken) {
        // Create an asynchronous approval request
        const approval = await (prisma as any).managerApproval.create({
          data: {
            action: 'user_delete',
            contextId: id,
            channelId: request.user.channelId!,
            requesterId: request.user.sub,
            notes: `Request to delete user ${id}`
          }
        })
        return reply.status(403).send({ 
          error: 'Administrator Manager approval required', 
          approvalId: approval.id,
          message: 'An approval request has been sent to the Administrator Manager.'
        })
      }
      // Use the target user ID as contextId
      const approved = await validateApprovalToken(
        approvalToken, 'user_delete', id, request.user.channelId || undefined
      )
      if (!approved) {
        return reply.status(403).send({ error: 'Invalid or expired Administrator Manager approval' })
      }
    }

    // Verify actor password
    const actor = await prisma.user.findUniqueOrThrow({
      where: { id: request.user.sub },
      select: { passwordHash: true }
    })

    const isValid = await verifyPassword(actor.passwordHash, password)
    if (!isValid) {
      return reply.status(403).send({ error: 'Invalid administrator password' })
    }

    return usersService.softDelete(id, request.user)
  })

  // POST /users/:id/reset-password
  app.post('/:id/reset-password', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { password } = z.object({ password: z.string().min(6) }).parse(request.body)
    await usersService.findById(id, request.user)

    // Hierarchy check: actor must strictly outrank target
    const targetUser = await prisma.user.findUnique({ where: { id }, select: { role: true, username: true } })
    if (!targetUser) return reply.status(404).send({ error: 'User not found' })

    const { roleHierarchy } = await import('../../middleware/authorize.js')
    const actorRank  = roleHierarchy[request.user.role]  ?? 0
    const targetRank = roleHierarchy[targetUser.role as any] ?? 0

    if (actorRank <= targetRank) {
      return reply.status(403).send({ error: 'You can only reset passwords for users with a lower rank than your own' })
    }

    await usersService.resetPassword(id, password)
    return { message: `Password reset successfully for ${targetUser.username}` }
  })
  // POST /users/:id/reset-mfa
  app.post('/:id/reset-mfa', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { password } = z.object({ password: z.string() }).parse(request.body)
    await usersService.findById(id, request.user)

    // Fetch target user's role
    const targetUser = await prisma.user.findUnique({ where: { id }, select: { role: true } })
    if (!targetUser) return reply.status(404).send({ error: 'User not found' })

    if (targetUser.role === 'SUPER_ADMIN') {
      return reply.status(403).send({ error: 'Super Admin MFA can only be reset manually via server coding/scripts' })
    }

    // Import role hierarchy to enforce strict rank-based resets
    const { roleHierarchy } = await import('../../middleware/authorize.js')
    const actorRank = roleHierarchy[request.user.role] ?? 0
    const targetRank = roleHierarchy[targetUser.role] ?? 0

    if (actorRank <= targetRank) {
      return reply.status(403).send({ error: 'You can only reset MFA for users with a lower administrative rank than your own' })
    }

    // Verify actor password
    const actor = await prisma.user.findUniqueOrThrow({
      where: { id: request.user.sub },
      select: { passwordHash: true }
    })

    const isValid = await verifyPassword(actor.passwordHash, password)
    if (!isValid) {
      return reply.status(403).send({ error: 'Invalid administrator password' })
    }

    return mfaService.disableMfa(id)
  })
}
