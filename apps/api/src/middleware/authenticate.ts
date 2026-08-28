import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyToken, type TokenPayload } from '../lib/jwt.js'
import { requestContext } from '../lib/request-context.plugin.js'
import { isTokenRevoked, revokeToken } from '../lib/pg-store.js'

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

    // ── Check token revocation in Postgres ───────────────────────────
    // Access tokens are stateless JWTs — once issued they remain
    // cryptographically valid until expiry regardless of logout.
    // We maintain a Postgres blocklist (revoked_tokens) so that logout,
    // password change, and MFA disable immediately invalidate outstanding
    // access tokens rather than leaving a window of unauthorized access.
    const revoked = await isTokenRevoked(token)
    if (revoked) {
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
      store.userId       = payload.sub
      store.role         = payload.role
      store.channelId    = payload.channelId ?? undefined
      store.enterpriseId = payload.enterpriseId ?? undefined
    }
  } catch {
    reply.status(401).send({ error: 'Invalid or expired token' })
  }
}

// ── Revoke an access token in Postgres ───────────────────────────────
// Call this from logout, password change, MFA disable, and role change.
// The row is stored in revoked_tokens with the token's actual expiry so
// a nightly cleanup job can purge stale rows automatically.
export async function revokeAccessToken(token: string): Promise<void> {
  try {
    const payload = verifyToken(token)
    const exp     = (payload as any).exp as number | undefined
    const expiresAt = exp ? new Date(exp * 1000) : new Date(Date.now() + 900_000)
    await revokeToken(token, expiresAt)
  } catch {
    // Token already expired — no need to revoke
  }
}
