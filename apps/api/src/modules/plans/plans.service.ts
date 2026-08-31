import { basePrisma } from '../../lib/prisma.js'
import {
  type PlanTier,
  type PlanFeatureKey,
  type PlanDefinition,
  type EnterpriseCapabilities,
  PLAN_DEFINITIONS,
  resolveEnterpriseCapabilities as staticResolve,
} from '../../lib/plans.js'

// In-memory cache for dynamic global plan definitions
let planCache: Record<string, PlanDefinition> | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 60 * 1000 // 1 minute

export class PlansService {
  /**
   * Loads global plan definitions from DB with fast in-memory caching.
   * Falls back to code definitions if DB is not ready.
   */
  static async getGlobalPlanDefinitions(): Promise<Record<string, PlanDefinition>> {
    const now = Date.now()
    if (planCache && now - cacheTimestamp < CACHE_TTL_MS) {
      return planCache
    }

    try {
      const rows = await basePrisma.planConfiguration.findMany()
      if (rows.length === 0) {
        return PLAN_DEFINITIONS
      }

      const map: Record<string, PlanDefinition> = { ...PLAN_DEFINITIONS }
      for (const row of rows) {
        const tier = row.tier.toUpperCase() as PlanTier
        const defaultDef = PLAN_DEFINITIONS[tier] || PLAN_DEFINITIONS.STARTER
        const dbFeatures = (typeof row.features === 'object' && row.features !== null) ? row.features : defaultDef.features

        map[tier] = {
          tier,
          name: row.name || defaultDef.name,
          tagline: row.tagline || defaultDef.tagline,
          limits: {
            maxChannels: row.maxChannels,
            maxUsers: row.maxUsers,
            auditRetentionDays: row.auditRetentionDays,
          },
          features: {
            ...defaultDef.features,
            ...(dbFeatures as any),
          },
        }
      }

      planCache = map
      cacheTimestamp = now
      return map
    } catch {
      return PLAN_DEFINITIONS
    }
  }

  /**
   * Update global plan matrix for a tier (Platform Owner only).
   */
  static async updatePlanDefinition(
    tier: PlanTier,
    updates: {
      name?: string
      tagline?: string
      maxChannels?: number
      maxUsers?: number
      auditRetentionDays?: number
      priceMonthly?: number
      priceAnnual?: number
      features?: Partial<Record<PlanFeatureKey, boolean>>
    }
  ) {
    const defaultDef = PLAN_DEFINITIONS[tier] || PLAN_DEFINITIONS.STARTER

    const existing = await basePrisma.planConfiguration.findUnique({
      where: { tier },
    })

    const existingFeatures = existing && typeof existing.features === 'object' ? existing.features : defaultDef.features
    const mergedFeatures = {
      ...(existingFeatures as any),
      ...(updates.features || {}),
    }

    const updated = await basePrisma.planConfiguration.upsert({
      where: { tier },
      create: {
        id: `plan-${tier.toLowerCase()}`,
        tier,
        name: updates.name || defaultDef.name,
        tagline: updates.tagline || defaultDef.tagline,
        maxChannels: updates.maxChannels ?? defaultDef.limits.maxChannels,
        maxUsers: updates.maxUsers ?? defaultDef.limits.maxUsers,
        auditRetentionDays: updates.auditRetentionDays ?? defaultDef.limits.auditRetentionDays,
        priceMonthly: updates.priceMonthly ?? (tier === 'STARTER' ? 2500 : tier === 'PRO' ? 7500 : 25000),
        priceAnnual: updates.priceAnnual ?? (tier === 'STARTER' ? 25000 : tier === 'PRO' ? 75000 : 250000),
        features: mergedFeatures as any,
      },
      update: {
        ...(updates.name ? { name: updates.name } : {}),
        ...(updates.tagline !== undefined ? { tagline: updates.tagline } : {}),
        ...(updates.maxChannels !== undefined ? { maxChannels: updates.maxChannels } : {}),
        ...(updates.maxUsers !== undefined ? { maxUsers: updates.maxUsers } : {}),
        ...(updates.auditRetentionDays !== undefined ? { auditRetentionDays: updates.auditRetentionDays } : {}),
        ...(updates.priceMonthly !== undefined ? { priceMonthly: updates.priceMonthly } : {}),
        ...(updates.priceAnnual !== undefined ? { priceAnnual: updates.priceAnnual } : {}),
        ...(updates.features ? { features: mergedFeatures as any } : {}),
      },
    })

    // Invalidate cache immediately
    planCache = null
    cacheTimestamp = 0

    return updated
  }

  /**
   * Resolves effective capabilities dynamically for an enterprise context.
   */
  static async resolveCapabilities(
    enterprise?: { plan?: string; planFeatures?: any } | null
  ): Promise<EnterpriseCapabilities> {
    if (!enterprise || !enterprise.plan) {
      const defaultEnt = PLAN_DEFINITIONS.ENTERPRISE
      return {
        tier: 'ENTERPRISE',
        name: defaultEnt.name,
        limits: { ...defaultEnt.limits },
        features: { ...defaultEnt.features },
        hasFeature: () => true,
        isUnlimitedChannels: true,
        isUnlimitedUsers: true,
      }
    }

    const tierKey = (enterprise.plan.toUpperCase() in PLAN_DEFINITIONS ? enterprise.plan.toUpperCase() : 'STARTER') as PlanTier
    const globalDefs = await this.getGlobalPlanDefinitions()
    const baseDef = globalDefs[tierKey] || PLAN_DEFINITIONS[tierKey]

    const customOverrides = typeof enterprise.planFeatures === 'object' && enterprise.planFeatures !== null ? enterprise.planFeatures : {}

    const mergedLimits = {
      maxChannels: typeof customOverrides.maxChannels === 'number' ? customOverrides.maxChannels : baseDef.limits.maxChannels,
      maxUsers: typeof customOverrides.maxUsers === 'number' ? customOverrides.maxUsers : baseDef.limits.maxUsers,
      auditRetentionDays: typeof customOverrides.auditRetentionDays === 'number' ? customOverrides.auditRetentionDays : baseDef.limits.auditRetentionDays,
    }

    const mergedFeatures: Record<PlanFeatureKey, boolean> = {
      ...baseDef.features,
    }

    for (const [k, v] of Object.entries(customOverrides)) {
      if (k in mergedFeatures && typeof v === 'boolean') {
        mergedFeatures[k as PlanFeatureKey] = v
      }
    }

    return {
      tier: tierKey,
      name: baseDef.name,
      limits: mergedLimits,
      features: mergedFeatures,
      hasFeature: (feat: PlanFeatureKey) => Boolean(mergedFeatures[feat]),
      isUnlimitedChannels: mergedLimits.maxChannels === -1,
      isUnlimitedUsers: mergedLimits.maxUsers === -1,
    }
  }
}
