import type { FastifyPluginAsync } from 'fastify'
import { PlansService } from './plans.service.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { z } from 'zod'
import { type PlanTier } from '../../lib/plans.js'

export const planConfigRoutes: FastifyPluginAsync = async (app) => {
  // GET /plans/matrix — List all global plan definitions
  app.get('/matrix', async () => {
    return PlansService.getGlobalPlanDefinitions()
  })

  // PUT /plans/matrix/:tier — Update a tier's global configuration (Platform Owner only)
  app.put('/matrix/:tier', {
    preHandler: [authenticate, authorize('PLATFORM_OWNER')],
  }, async (request) => {
    const params = z.object({
      tier: z.enum(['STARTER', 'PRO', 'ENTERPRISE']),
    }).parse(request.params)

    const body = z.object({
      name:               z.string().min(2).optional(),
      tagline:            z.string().optional(),
      maxChannels:        z.number().int().optional(),
      maxUsers:           z.number().int().optional(),
      auditRetentionDays: z.number().int().optional(),
      priceMonthly:       z.number().min(0).optional(),
      priceAnnual:        z.number().min(0).optional(),
      features:           z.record(z.boolean()).optional(),
    }).parse(request.body)

    const updated = await PlansService.updatePlanDefinition(params.tier as PlanTier, body as any)
    return {
      message: `Global ${params.tier} configuration updated successfully.`,
      plan: updated,
    }
  })
}
