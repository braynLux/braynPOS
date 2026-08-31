/**
 * plans.ts
 * Central SaaS Subscription Tier & Feature Gating specification for braynPOS.
 * Defines quotas and feature entitlements for STARTER, PRO, and ENTERPRISE tiers.
 */

export type PlanTier = 'STARTER' | 'PRO' | 'ENTERPRISE'

export type PlanFeatureKey =
  | 'pos'
  | 'inventory'
  | 'serials'
  | 'transfers'
  | 'invoicing'
  | 'credit'
  | 'commissions'
  | 'accounting'
  | 'catalog'
  | 'fixedAssets'
  | 'payroll'
  | 'marginAudit'
  | 'aiPortal'

export interface PlanLimits {
  /** Maximum number of branches/channels allowed (-1 = unlimited) */
  maxChannels: number
  /** Maximum number of staff user accounts (-1 = unlimited) */
  maxUsers: number
  /** Number of days audit logs are retained (-1 = unlimited/lifetime) */
  auditRetentionDays: number
}

export interface PlanDefinition {
  tier: PlanTier
  name: string
  tagline: string
  limits: PlanLimits
  features: Record<PlanFeatureKey, boolean>
}

export const PLAN_DEFINITIONS: Record<PlanTier, PlanDefinition> = {
  STARTER: {
    tier: 'STARTER',
    name: 'Starter Shop',
    tagline: 'Ideal for single retail shops & independent stores',
    limits: {
      maxChannels: 1,
      maxUsers: 3,
      auditRetentionDays: 7,
    },
    features: {
      pos: true,
      inventory: true,
      serials: false,
      transfers: false,
      invoicing: false,
      credit: false,
      commissions: false,
      accounting: false,
      catalog: false,
      fixedAssets: false,
      payroll: false,
      marginAudit: false,
      aiPortal: false,
    },
  },
  PRO: {
    tier: 'PRO',
    name: 'Business Pro',
    tagline: 'Multi-branch operations with accounting, credit & transfers',
    limits: {
      maxChannels: 5,
      maxUsers: 15,
      auditRetentionDays: 90,
    },
    features: {
      pos: true,
      inventory: true,
      serials: true,
      transfers: true,
      invoicing: true,
      credit: true,
      commissions: true,
      accounting: true,
      catalog: false,
      fixedAssets: false,
      payroll: false,
      marginAudit: false,
      aiPortal: false,
    },
  },
  ENTERPRISE: {
    tier: 'ENTERPRISE',
    name: 'Enterprise Fleet',
    tagline: 'Unlimited scale with master catalog, payroll, fixed assets & AI forensics',
    limits: {
      maxChannels: -1,
      maxUsers: -1,
      auditRetentionDays: -1,
    },
    features: {
      pos: true,
      inventory: true,
      serials: true,
      transfers: true,
      invoicing: true,
      credit: true,
      commissions: true,
      accounting: true,
      catalog: true,
      fixedAssets: true,
      payroll: true,
      marginAudit: true,
      aiPortal: true,
    },
  },
}

export interface EnterpriseCapabilities {
  tier: PlanTier
  name: string
  limits: PlanLimits
  features: Record<PlanFeatureKey, boolean>
  hasFeature: (feature: PlanFeatureKey) => boolean
  isUnlimitedChannels: boolean
  isUnlimitedUsers: boolean
}

/**
 * Resolves effective capabilities for an enterprise by merging standard tier defaults
 * with any custom JSONB overrides stored in `enterprise.planFeatures`.
 */
export function resolveEnterpriseCapabilities(
  enterprise?: { plan?: string; planFeatures?: any } | null
): EnterpriseCapabilities {
  // If no enterprise context is passed (e.g. Platform Owner in Fleet HQ), grant full enterprise access
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
  const baseDef = PLAN_DEFINITIONS[tierKey]

  const customOverrides = typeof enterprise.planFeatures === 'object' && enterprise.planFeatures !== null ? enterprise.planFeatures : {}

  const mergedLimits: PlanLimits = {
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
