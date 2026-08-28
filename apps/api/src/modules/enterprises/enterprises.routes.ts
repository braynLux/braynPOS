import type { FastifyPluginAsync } from 'fastify'
import { EnterpriseService } from './enterprises.service.js'
import { OnboardEnterpriseSchema, UpdateEnterpriseSchema, CreateInviteSchema, UpdatePlanSchema } from './enterprises.schema.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'

export const enterpriseRoutes: FastifyPluginAsync = async (app) => {
  // ── Public: Validate Invite Code Pre-Flight ──────────────────────────
  app.get('/invites/validate/:code', async (request) => {
    const { code } = request.params as { code: string }
    return EnterpriseService.validateInvite(code)
  })

  // ── Public: Onboard with One-Time Invite Code ────────────────────────
  app.post('/onboard', {
    config: {
      rateLimit: {
        max:        5,
        timeWindow: '15 minutes',
      },
    },
  }, async (request, reply) => {
    const body = OnboardEnterpriseSchema.parse(request.body)
    const result = await EnterpriseService.onboard(body)
    return reply.status(201).send(result)
  })

  // ── Authenticated Routes ─────────────────────────────────────────────
  app.register(async (authApp) => {
    authApp.addHook('preHandler', authenticate)

    // ── Invite Code Management (Platform Owner Only) ───────────────────
    authApp.post('/invites', {
      preHandler: [authorize('PLATFORM_OWNER')],
    }, async (request, reply) => {
      const body = CreateInviteSchema.parse(request.body)
      const invite = await EnterpriseService.createInvite(body, request.user.sub)
      return reply.status(201).send(invite)
    })

    authApp.get('/invites', {
      preHandler: [authorize('PLATFORM_OWNER')],
    }, async () => {
      return EnterpriseService.listInvites()
    })

    authApp.delete('/invites/:id', {
      preHandler: [authorize('PLATFORM_OWNER')],
    }, async (request) => {
      const { id } = request.params as { id: string }
      return EnterpriseService.revokeInvite(id)
    })

    // ── Fleet Management (Platform Owner Only) ─────────────────────────
    // NOTE: These routes MUST be registered BEFORE /:id routes to avoid path collision

    authApp.get('/fleet/stats', {
      preHandler: [authorize('PLATFORM_OWNER')],
    }, async () => {
      return EnterpriseService.getFleetStats()
    })

    authApp.get('/fleet/security', {
      preHandler: [authorize('PLATFORM_OWNER')],
    }, async () => {
      return EnterpriseService.getSecurityOverview()
    })

    // ── Enterprise Management ─────────────────────────────────────────
    // Current enterprise info
    authApp.get('/me', async (request, reply) => {
      const enterpriseId = request.user.enterpriseId
      if (!enterpriseId) {
        return reply.status(400).send({ error: 'User is not linked to any enterprise' })
      }
      return EnterpriseService.findById(enterpriseId)
    })

    // Update current enterprise
    authApp.patch('/me', {
      preHandler: [authorize('PLATFORM_OWNER', 'MANAGER_ADMIN', 'SUPER_ADMIN')],
    }, async (request, reply) => {
      const enterpriseId = request.user.enterpriseId
      if (!enterpriseId) {
        return reply.status(400).send({ error: 'User is not linked to any enterprise' })
      }
      const body = UpdateEnterpriseSchema.parse(request.body)
      return EnterpriseService.update(enterpriseId, body)
    })

    // List all enterprises (Platform Owner only)
    authApp.get('/', {
      preHandler: [authorize('PLATFORM_OWNER')],
    }, async () => {
      return EnterpriseService.findAll()
    })

    // Get specific enterprise by ID (Platform Owner or Tenant Owner)
    authApp.get('/:id', {
      preHandler: [authorize('PLATFORM_OWNER', 'MANAGER_ADMIN', 'SUPER_ADMIN')],
    }, async (request, reply) => {
      const { id } = request.params as { id: string }
      if (request.user.role !== 'PLATFORM_OWNER' && request.user.enterpriseId !== id) {
        return reply.status(403).send({ error: 'Access denied to this enterprise' })
      }
      return EnterpriseService.findById(id)
    })

    // Update enterprise (Platform Owner)
    authApp.patch('/:id', {
      preHandler: [authorize('PLATFORM_OWNER')],
    }, async (request) => {
      const { id } = request.params as { id: string }
      const body = UpdateEnterpriseSchema.parse(request.body)
      return EnterpriseService.update(id, body)
    })

    // Soft delete enterprise (Platform Owner)
    authApp.delete('/:id', {
      preHandler: [authorize('PLATFORM_OWNER')],
    }, async (request) => {
      const { id } = request.params as { id: string }
      return EnterpriseService.softDelete(id)
    })

    // Switch into Enterprise Workspace (Platform Owner or Super Admin)
    authApp.post('/:id/switch', {
      preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN')],
    }, async (request) => {
      const { id } = request.params as { id: string }
      return EnterpriseService.switchWorkspace(id, request.user)
    })

    // Suspend enterprise (Platform Owner only)
    authApp.post('/:id/suspend', {
      preHandler: [authorize('PLATFORM_OWNER')],
    }, async (request) => {
      const { id } = request.params as { id: string }
      return EnterpriseService.suspendEnterprise(id)
    })

    // Reactivate enterprise (Platform Owner only)
    authApp.post('/:id/reactivate', {
      preHandler: [authorize('PLATFORM_OWNER')],
    }, async (request) => {
      const { id } = request.params as { id: string }
      return EnterpriseService.reactivateEnterprise(id)
    })

    // Update enterprise plan (Platform Owner only)
    authApp.patch('/:id/plan', {
      preHandler: [authorize('PLATFORM_OWNER')],
    }, async (request) => {
      const { id } = request.params as { id: string }
      const body = UpdatePlanSchema.parse(request.body)
      return EnterpriseService.updatePlan(id, body)
    })
  })
}

