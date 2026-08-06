import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyToken, type TokenPayload } from '../lib/jwt.js'
import { requestContext } from '../lib/request-context.plugin.js'
import { redis } from '../lib/redis.js'

// ── Augment FastifyRequest so request.user is typed everywhere ───────
declare module 'fastify' {
  interface FastifyRequest {
    user: TokenPayload
  }
}

// ── Routes that a temp (mfaVerified: false) token may access ─────────
// All other authenticated routes require a fully verified token.
const MFA_EXEMPT_PATHS = new Set([
  '/v1/auth/mfa/verify',
  '/v1/auth/mfa/setup',
  '/v1/auth/mfa/enable',
  '/v1/auth/profile',
])

export async function authenticate(
  request: FastifyRequest,
  reply:   FastifyReply
) {
  const authHeader = request.headers.authorization
  let token: string | undefined

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else if ((request.query as { token?: string })?.token) {
    token = (request.query as { token?: string }).token
  }

  if (!token) {
    reply.status(401).send({ error: 'Missing or invalid authorization header/token' })
    return
  }

  try {
    const payload = verifyToken(token)

    // ── FIX 1: Check token revocation in Redis ────────────────────────
    // Access tokens are stateless JWTs — once issued they remain
    // cryptographically valid until expiry regardless of logout.
    // We maintain a Redis blocklist so that logout, password change,
    // and MFA disable immediately invalidate outstanding access tokens
    // rather than leaving a 15-minute window of unauthorized access.
    //
    // Key format: revoked:<token>
    // TTL mirrors the token's remaining lifetime so Redis self-cleans.
    const isRevoked = await redis.get(`revoked:${token}`)
    if (isRevoked) {
      reply.status(401).send({ error: 'Token has been revoked' })
      return
    }

    request.user = payload

    // ── FIX 2: Block temp MFA tokens from all routes except /mfa/verify
    // Without this, mfaVerified: false tokens can call any endpoint.
    if (payload.mfaVerified === false) {
      const path = request.routeOptions.url ?? request.raw.url ?? ''
      if (!MFA_EXEMPT_PATHS.has(path)) {
        reply.status(403).send({
          error:   'MFA verification required',
          message: 'Complete MFA verification before accessing this resource',
        })
        return
      }
    }

    // ── Populate the request context after auth ──────────────────────
    const store = requestContext.getStore()
    if (store) {
      store.userId    = payload.sub
      store.role      = payload.role
      store.channelId = payload.channelId ?? undefined
    }
  } catch {
    reply.status(401).send({ error: 'Invalid or expired token' })
  }
}

// ── Revoke an access token in Redis ──────────────────────────────────
// Call this from logout, password change, MFA disable, and role change.
// TTL is set to the token's remaining lifetime so Redis self-cleans.
export async function revokeAccessToken(token: string): Promise<void> {
  try {
    const payload = verifyToken(token)
    const exp     = (payload as any).exp as number | undefined
    const ttl     = exp ? Math.max(exp - Math.floor(Date.now() / 1000), 1) : 900 // 15m fallback
    await redis.setex(`revoked:${token}`, ttl, '1')
  } catch {
    // Token already expired — no need to revoke
  }
}
