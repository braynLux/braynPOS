import type { FastifyPluginAsync } from 'fastify'
import { authService }   from './auth.service.js'
import { mfaService }    from './mfa.service.js'
import {
  loginSchema,
  mfaVerifySchema,
  refreshTokenSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordWithCodeSchema,
} from './auth.schema.js'
import { authenticate }  from '../../middleware/authenticate.js'
import { RATE }          from '../../lib/rate-limit.plugin.js'
import { z }             from 'zod'

export const authRoutes: FastifyPluginAsync = async (app) => {

  // POST /auth/login
  app.post('/login', {
    config: RATE.AUTH_LOGIN,
  }, async (request, reply) => {
    const body   = loginSchema.parse(request.body)
    const result = await authService.login(body)
    reply.send(result)
  })

  // POST /auth/refresh
  app.post('/refresh', {
    config: {
      rateLimit: {
        max:          20,
        timeWindow:   '1 minute',
        keyGenerator: (request: any) => `refresh-${request.ip}`,
      },
    },
  }, async (request, reply) => {
    const body   = refreshTokenSchema.parse(request.body)
    const result = await authService.refreshToken(body.refreshToken)
    reply.send(result)
  })

  // POST /auth/logout
  // FIX: Extract the access token from the Authorization header and pass
  // it to authService.logout() so it gets added to the Redis revocation
  // blocklist. Without this the security-phase revocation system is a no-op
  // — the blocklist stays empty and logged-out tokens remain valid for 15m.
  app.post('/logout', {
    config: RATE.AUTH_LOGIN,
  }, async (request, reply) => {
    const body        = refreshTokenSchema.parse(request.body)
    const accessToken = request.headers.authorization?.slice(7)  // strip 'Bearer '
    const result      = await authService.logout(body.refreshToken, accessToken)
    reply.send(result)
  })

  // POST /auth/mfa/verify
  app.post('/mfa/verify', {
    config: RATE.AUTH_LOGIN,
  }, async (request, reply) => {
    const body   = mfaVerifySchema.parse(request.body)
    const result = await mfaService.verifyMfaLogin(body.tempToken, body.code)
    reply.send(result)
  })

  // POST /auth/mfa/recovery
  app.post('/mfa/recovery', {
    config: RATE.AUTH_LOGIN,
  }, async (request, reply) => {
    const { tempToken, recoveryCode } = z.object({
      tempToken:    z.string().min(1),
      recoveryCode: z.string().min(8).max(8),
    }).parse(request.body)

    const { verifyToken } = await import('../../lib/jwt.js')
    const payload = verifyToken(tempToken)
    
    const result = await mfaService.verifyRecoveryCode(payload.sub, recoveryCode)
    reply.send(result)
  })

  // POST /auth/forgot-password
  app.post('/forgot-password', {
    config: RATE.AUTH_LOGIN,
  }, async (request, reply) => {
    const { identifier } = forgotPasswordSchema.parse(request.body)
    const result = await authService.requestPasswordReset(identifier)
    reply.send(result)
  })

  // POST /auth/reset-password
  app.post('/reset-password', {
    config: RATE.AUTH_LOGIN,
  }, async (request, reply) => {
    const { identifier, code, newPassword } = resetPasswordWithCodeSchema.parse(request.body)
    const result = await authService.resetPasswordWithCode(identifier, code, newPassword)
    reply.send(result)
  })

  // ── Authenticated routes ────────────────────────────────────────────
  app.register(async (protectedApp) => {
    protectedApp.addHook('preHandler', authenticate)

    // GET /auth/profile
    protectedApp.get('/profile', async (request) => {
      return authService.getProfile(request.user.sub)
    })

    // POST /auth/change-password
    // FIX: Pass the current access token so it gets revoked immediately.
    // Previously the token was never passed — a user who changed password
    // could continue using the old access token for up to 15 minutes.
    protectedApp.post('/change-password', async (request, reply) => {
      const body        = changePasswordSchema.parse(request.body)
      const accessToken = request.headers.authorization?.slice(7)
      const result      = await authService.changePassword(request.user.sub, body, accessToken)
      reply.send(result)
    })

    // POST /auth/mfa/setup
    protectedApp.post('/mfa/setup', async (request) => {
      return mfaService.setupMfa(request.user.sub)
    })

    // POST /auth/mfa/enable
    protectedApp.post('/mfa/enable', {
      config: RATE.AUTH_LOGIN,
    }, async (request, reply) => {
      const { code } = z.object({
        code: z.string().min(6).max(8).regex(/^\d+$/, 'TOTP code must be numeric'),
      }).parse(request.body)
      const result = await mfaService.enableMfa(request.user.sub, code)
      reply.send(result)
    })

    // POST /auth/mfa/disable
    // FIX: Pass the current access token so it gets revoked immediately
    // when MFA is disabled — active session trust level drops instantly.
    protectedApp.post('/mfa/disable', {
      config: RATE.AUTH_LOGIN,
    }, async (request, reply) => {
      const { password } = z.object({
        password: z.string().min(1, 'Password is required to disable MFA'),
      }).parse(request.body)
      const accessToken = request.headers.authorization?.slice(7)
      const result      = await authService.disableMfaWithPassword(
        request.user.sub, password, accessToken
      )
      reply.send(result)
    })

    // GET /auth/sessions — List active sessions
    protectedApp.get('/sessions', async (request) => {
      return authService.listSessions(request.user.sub)
    })

    // DELETE /auth/sessions/:id — Revoke a session remotely
    protectedApp.delete('/sessions/:id', async (request) => {
      const { id } = request.params as { id: string }
      return authService.revokeSession(request.user.sub, id)
    })
  })
}
