import { prisma } from '../../lib/prisma.js'
import { hashPassword, verifyPassword } from '../../lib/password.js'
import { signAccessToken, signRefreshToken, verifyRefreshToken, REFRESH_TOKEN_TTL_MS } from '../../lib/jwt.js'
import { redis } from '../../lib/redis.js'
import { revokeAccessToken } from '../../middleware/authenticate.js'
import { authLogger } from '../../lib/logger.js'
import type { LoginInput, RegisterInput, ChangePasswordInput } from './auth.schema.js'

const MAX_FAILED_ATTEMPTS = 10

export class AuthService {

  // ── Login ────────────────────────────────────────────────────────────
  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({
      where:   { username: input.username },
      include: { channel: true },
    })

    if (!user) {
      authLogger.warn({ username: input.username }, 'login failed — user not found')
      throw { statusCode: 401, message: 'Invalid username or password' }
    }

    if (user.status === 'INACTIVE') {
      authLogger.warn({ userId: user.id }, 'login rejected — account inactive or locked')
      throw { statusCode: 403, message: 'Account is inactive. Contact your administrator.' }
    }

    let valid = false
    try {
      valid = await verifyPassword(user.passwordHash, input.password)
    } catch {
      throw { statusCode: 401, message: 'Invalid username or password' }
    }

    if (!valid) {
      const failKey = `login_failures:${user.id}`
      const failures = await redis.incr(failKey)
      await redis.expire(failKey, 900)  // 15-minute window

      if (failures >= MAX_FAILED_ATTEMPTS) {
        await prisma.user.update({
          where: { id: user.id },
          data:  { status: 'INACTIVE' },
        })
        authLogger.error({ userId: user.id, failures }, 'account locked — too many failed login attempts')
        throw { statusCode: 403, message: 'Account locked after too many failed attempts. Contact your administrator.' }
      }

      authLogger.warn({ userId: user.id, username: input.username, failures }, 'login failed — wrong password')
      throw { statusCode: 401, message: 'Invalid username or password' }
    }

    await redis.del(`login_failures:${user.id}`)
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    // MFA is disabled — always issue a fully verified token
    const accessToken  = signAccessToken({
      sub: user.id, username: user.username, email: user.email, role: user.role,
      channelId: user.channelId, mfaVerified: true,
    })
    const refreshToken = signRefreshToken(user.id)

    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) },
    })

    authLogger.info({ userId: user.id, role: user.role, channelId: user.channelId }, 'login successful')
    return { requiresMfa: false, accessToken, refreshToken, user: this.sanitizeUser(user) }
  }

  // ── Register ──────────────────────────────────────────────────────────
  async register(input: RegisterInput) {
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM users WHERE email = ${input.email} OR username = ${input.username} LIMIT 1
    `
    if (existing.length > 0) {
      authLogger.warn({ email: input.email, username: input.username }, 'register failed — already exists')
      throw { statusCode: 409, message: 'User with this email or username already exists' }
    }

    const passwordHash = await hashPassword(input.password)
    const user = await prisma.user.create({
      data: { username: input.username, email: input.email, passwordHash, role: input.role, channelId: input.channelId ?? null },
    })

    authLogger.info({ userId: user.id, email: user.email, role: user.role }, 'user registered')
    return this.sanitizeUser(user)
  }

  // ── Refresh token ──────────────────────────────────────────────────────
  async refreshToken(refreshTokenStr: string) {
    const payload = verifyRefreshToken(refreshTokenStr)
    if (payload.type !== 'refresh') throw { statusCode: 401, message: 'Invalid refresh token type' }

    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshTokenStr }, include: { user: true },
    })

    if (!storedToken || storedToken.revokedAt || storedToken.expiresAt < new Date()) {
      if (storedToken?.revokedAt) {
        authLogger.error({ userId: payload.sub, tokenId: storedToken.id }, 'refresh token reuse detected — revoking all sessions')
        await prisma.refreshToken.updateMany({
          where: { userId: payload.sub, revokedAt: null }, data: { revokedAt: new Date() },
        })
      } else {
        authLogger.warn({ userId: payload.sub }, 'refresh token invalid or expired')
      }
      throw { statusCode: 401, message: 'Invalid or expired refresh token' }
    }

    const user = storedToken.user
    if (user.status !== 'ACTIVE' || user.deletedAt) {
      authLogger.warn({ userId: user.id }, 'refresh rejected — user inactive or deleted')
      throw { statusCode: 401, message: 'User is no longer active' }
    }

    await prisma.refreshToken.update({ where: { id: storedToken.id }, data: { revokedAt: new Date() } })

    const accessToken     = signAccessToken({
      sub: user.id, username: user.username, email: user.email, role: user.role, channelId: user.channelId, mfaVerified: true,
    })
    const newRefreshToken = signRefreshToken(user.id)

    await prisma.refreshToken.create({
      data: { token: newRefreshToken, userId: user.id, expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) },
    })

    authLogger.info({ userId: user.id }, 'refresh token rotated successfully')
    return { accessToken, refreshToken: newRefreshToken }
  }

  // ── Logout ────────────────────────────────────────────────────────────
  // FIX: Also revokes the access token in Redis so it cannot be reused
  // during its remaining 15-minute lifetime after the client logs out.
  async logout(refreshTokenStr: string, accessToken?: string) {
    const result = await prisma.refreshToken.updateMany({
      where: { token: refreshTokenStr, revokedAt: null },
      data:  { revokedAt: new Date() },
    })

    // Revoke the access token immediately if provided by the client
    if (accessToken) {
      await revokeAccessToken(accessToken)
    }

    authLogger.info({ tokensRevoked: result.count }, 'logout — tokens revoked')
    return { message: 'Logged out successfully' }
  }

  // ── Change password ────────────────────────────────────────────────────
  // FIX: Revoke all refresh tokens + the current access token
  async changePassword(userId: string, input: ChangePasswordInput, currentAccessToken?: string) {
    const user  = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    const valid = await verifyPassword(user.passwordHash, input.currentPassword)
    if (!valid) {
      authLogger.warn({ userId }, 'change password failed — wrong current password')
      throw { statusCode: 401, message: 'Current password is incorrect' }
    }

    const newHash = await hashPassword(input.newPassword)

    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } }),
      prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ])

    // Reset login failures on password change
    await redis.del(`login_failures:${userId}`)

    // Revoke the current access token so the session ends immediately
    if (currentAccessToken) {
      await revokeAccessToken(currentAccessToken)
    }

    authLogger.info({ userId }, 'password changed — all tokens revoked')
    return { message: 'Password changed successfully. Please log in again.' }
  }

  // ── Disable MFA ────────────────────────────────────────────────────────
  // FIX: Revoke current access token so elevated-trust session ends now
  async disableMfaWithPassword(userId: string, password: string, currentAccessToken?: string) {
    const user  = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    const valid = await verifyPassword(user.passwordHash, password)
    if (!valid) {
      authLogger.warn({ userId }, 'MFA disable rejected — wrong password')
      throw { statusCode: 401, message: 'Incorrect password. Cannot disable MFA.' }
    }
    if (!user.mfaEnabled) {
      throw { statusCode: 400, message: 'MFA is not enabled on this account' }
    }

    await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecret: null } })
    await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })

    if (currentAccessToken) {
      await revokeAccessToken(currentAccessToken)
    }

    authLogger.info({ userId }, 'MFA disabled — all sessions revoked')
    return { message: 'MFA disabled. Please log in again.' }
  }

  // ── Get profile ────────────────────────────────────────────────────────
  async getProfile(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId }, include: { channel: true, staffProfile: true },
    })
    return this.sanitizeUser(user)
  }

  // ── Session Management ─────────────────────────────────────────────────
  async listSessions(userId: string) {
    return prisma.refreshToken.findMany({
      where:   { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { issuedAt: 'desc' },
      select:  { id: true, issuedAt: true, expiresAt: true },
    })
  }

  async revokeSession(userId: string, sessionId: string) {
    const result = await prisma.refreshToken.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data:  { revokedAt: new Date() },
    })
    
    if (result.count === 0) {
      throw { statusCode: 404, message: 'Session not found or already revoked' }
    }

    authLogger.info({ userId, sessionId }, 'session revoked remotely')
    return { message: 'Session revoked successfully' }
  }

  private sanitizeUser(user: Record<string, unknown>) {
    const { passwordHash, mfaSecret, ...safe } = user
    return safe
  }
}

export const authService = new AuthService()
