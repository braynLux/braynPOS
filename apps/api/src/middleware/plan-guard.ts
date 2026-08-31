import type { FastifyRequest, FastifyReply } from 'fastify'
import { basePrisma } from '../lib/prisma.js'
import { requestContext } from '../lib/request-context.plugin.js'
import {
  type PlanFeatureKey,
  resolveEnterpriseCapabilities,
  type EnterpriseCapabilities,
} from '../lib/plans.js'

/**
 * Fastify preHandler hook that ensures the requesting user's enterprise
 * is subscribed to a tier that includes the requested feature.
 */
export function requirePlanFeature(feature: PlanFeatureKey) {
  return async function planFeatureGuard(request: FastifyRequest, reply: FastifyReply) {
    const ctx = requestContext.getStore()

    // Platform Owner has full access across all modules
    if (ctx?.role === 'PLATFORM_OWNER' || (request.user as any)?.role === 'PLATFORM_OWNER') {
      return
    }

    const enterpriseId = ctx?.enterpriseId || (request.user as any)?.enterpriseId
    if (!enterpriseId) {
      // If the user belongs to no enterprise (e.g. system accounts), allow through
      return
    }

    const enterprise = await basePrisma.enterprise.findUnique({
      where:  { id: enterpriseId },
      select: { id: true, plan: true, planFeatures: true, isActive: true },
    })

    if (!enterprise || enterprise.isActive === false) {
      return reply.status(403).send({
        statusCode: 403,
        error:      'ENTERPRISE_INACTIVE',
        message:    'Your enterprise subscription is inactive or suspended. Please contact support.',
      })
    }

    const caps = resolveEnterpriseCapabilities(enterprise)
    if (!caps.hasFeature(feature)) {
      return reply.status(403).send({
        statusCode:  403,
        error:       'PLAN_FEATURE_LOCKED',
        feature,
        currentPlan: caps.tier,
        message:     `The '${feature}' module is not available on your ${caps.tier} plan. Please upgrade to unlock this feature.`,
      })
    }
  }
}

/**
 * Validates whether an enterprise has remaining branch quota before adding a new channel.
 */
export async function assertChannelQuota(enterpriseId?: string | null): Promise<void> {
  if (!enterpriseId) return

  const enterprise = await basePrisma.enterprise.findUnique({
    where:  { id: enterpriseId },
    select: { plan: true, planFeatures: true },
  })

  const caps = resolveEnterpriseCapabilities(enterprise)
  if (caps.isUnlimitedChannels) return

  const currentCount = await basePrisma.channel.count({
    where: { enterpriseId, deletedAt: null },
  })

  if (currentCount >= caps.limits.maxChannels) {
    throw {
      statusCode: 403,
      error:      'PLAN_QUOTA_EXCEEDED',
      message:    `Your ${caps.tier} plan allows a maximum of ${caps.limits.maxChannels} branch(es). Please upgrade to PRO or ENTERPRISE to add more branches.`,
      quotaType:  'CHANNELS',
      max:        caps.limits.maxChannels,
      current:    currentCount,
    }
  }
}

/**
 * Validates whether an enterprise has remaining staff account quota before creating/inviting a user.
 */
export async function assertUserQuota(enterpriseId?: string | null): Promise<void> {
  if (!enterpriseId) return

  const enterprise = await basePrisma.enterprise.findUnique({
    where:  { id: enterpriseId },
    select: { plan: true, planFeatures: true },
  })

  const caps = resolveEnterpriseCapabilities(enterprise)
  if (caps.isUnlimitedUsers) return

  const currentCount = await basePrisma.user.count({
    where: { enterpriseId, deletedAt: null },
  })

  if (currentCount >= caps.limits.maxUsers) {
    throw {
      statusCode: 403,
      error:      'PLAN_QUOTA_EXCEEDED',
      message:    `Your ${caps.tier} plan allows a maximum of ${caps.limits.maxUsers} staff user(s). Please upgrade your subscription to add more staff.`,
      quotaType:  'USERS',
      max:        caps.limits.maxUsers,
      current:    currentCount,
    }
  }
}
