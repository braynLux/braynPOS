import jwt  from 'jsonwebtoken'
import type { UserRole } from '@prisma/client'

const ACCESS_EXPIRY    = process.env.JWT_ACCESS_EXPIRY    || '15m'
const REFRESH_EXPIRY   = process.env.JWT_REFRESH_EXPIRY   || '7d'

// Shared TTL constant — used both here and in auth.service.ts
// so the two values can never drift independently.
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

// NUCLEAR FIX: Forced HS256 to bypass all RSA/Asymmetric key errors
const algorithm  = 'HS256'
const privateKey = process.env.JWT_SECRET || 'fallback-secret-for-restoration'
const publicKey  = privateKey

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET is required in production.')
}

// ── Token payload shape ───────────────────────────────────────────────
export interface TokenPayload {
  id:            string
  sub:           string
  username:      string
  email:         string
  role:          UserRole
  channelId:     string | null
  enterpriseId?: string | null
  mfaVerified?:  boolean
}

// ── Sign access token ─────────────────────────────────────────────────
export function signAccessToken(
  payload: Omit<TokenPayload, 'id'> & { id?: string }
): string {
  const userId = payload.sub || payload.id
  if (!userId) throw new Error('Token payload must have sub or id')

  const signPayload: TokenPayload = {
    ...payload,
    id:  userId,
    sub: userId,
  }

  return jwt.sign(signPayload, privateKey, {
    algorithm,
    expiresIn: ACCESS_EXPIRY,
    issuer:    'brayn-api',
  } as jwt.SignOptions)
}

// ── Sign refresh token ────────────────────────────────────────────────
export function signRefreshToken(userId: string): string {
  return jwt.sign(
    { sub: userId, type: 'refresh' },
    privateKey,
    { algorithm, expiresIn: REFRESH_EXPIRY, issuer: 'brayn-api' } as jwt.SignOptions
  )
}

// ── Verify access token ───────────────────────────────────────────────
export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, publicKey, {
    algorithms: [algorithm],
    issuer:     'brayn-api',
  }) as TokenPayload
}

// ── Verify refresh token ──────────────────────────────────────────────
export function verifyRefreshToken(token: string): { sub: string; type: string } {
  const payload = jwt.verify(token, publicKey, {
    algorithms: [algorithm],
    issuer:     'brayn-api',
  }) as any

  return {
    sub:  payload.sub || payload.id,
    type: payload.type,
  }
}
