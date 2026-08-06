import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email('Valid email required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

export const registerSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER', 'CASHIER', 'STOREKEEPER', 'PROMOTER', 'SALES_PERSON']),
  channelId: z.union([z.string().uuid(), z.null()]).optional(),
})

export const mfaVerifySchema = z.object({
  code: z.string().length(6, 'TOTP code must be 6 digits'),
  tempToken: z.string(),
})

export const refreshTokenSchema = z.object({
  refreshToken: z.string(),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8).max(100),
})

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
