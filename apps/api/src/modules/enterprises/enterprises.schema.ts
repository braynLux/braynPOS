import { z } from 'zod'

export const OnboardEnterpriseSchema = z.object({
  inviteCode:    z.string().min(4).max(50),
  name:          z.string().min(2).max(100),
  slug:          z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Slug must only contain lowercase letters, numbers, and hyphens'),
  email:         z.string().email(),
  phone:         z.string().optional(),
  ownerUsername: z.string().min(3).max(50),
  ownerPassword: z.string().min(8).max(100),
  ownerEmail:    z.string().email().optional(),
})

export const UpdateEnterpriseSchema = z.object({
  name:         z.string().min(2).max(100).optional(),
  phone:        z.string().optional(),
  logoUrl:      z.string().url().optional(),
  plan:         z.enum(['STARTER', 'PRO', 'ENTERPRISE']).optional(),
  isActive:     z.boolean().optional(),
  planFeatures: z.record(z.any()).optional(),
})

export const CreateInviteSchema = z.object({
  businessName:  z.string().min(2).max(100).optional(),
  plan:          z.enum(['STARTER', 'PRO', 'ENTERPRISE']).default('STARTER'),
  expiresInDays: z.number().int().min(1).max(90).default(7),
})

export const UpdatePlanSchema = z.object({
  plan:         z.enum(['STARTER', 'PRO', 'ENTERPRISE']),
  planFeatures: z.record(z.any()).optional(),
})

export type OnboardEnterpriseInput = z.infer<typeof OnboardEnterpriseSchema>
export type UpdateEnterpriseInput  = z.infer<typeof UpdateEnterpriseSchema>
export type CreateInviteInput      = z.infer<typeof CreateInviteSchema>
export type UpdatePlanInput        = z.infer<typeof UpdatePlanSchema>

