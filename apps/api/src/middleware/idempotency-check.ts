import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { checkIdempotency, isValidIdempotencyKey } from '../lib/idempotency.js'

/**
 * Idempotency check middleware for Fastify.
 * Apply to: POST /sales/sync-offline, POST /payments/webhook
 *
 * If an Idempotency-Key header is present, checks PostgreSQL for a cached response.
 * If found, returns the cached response immediately without processing the request.
 */
export const idempotencyCheckMiddleware: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (request, reply) => {
    // Only apply to POST/PUT/PATCH methods
    if (!['POST', 'PUT', 'PATCH'].includes(request.method)) return

    const key = request.headers['idempotency-key'] as string | undefined
    if (!key) return // Not required on all routes

    // Validate UUID format
    if (!isValidIdempotencyKey(key)) {
      reply.status(400).send({
        error: 'Invalid Idempotency-Key format. Must be UUIDv4.',
      })
      return
    }

    // Check DB for existing response
    try {
      const stored = await checkIdempotency(key)
      if (stored) {
        reply.status(stored.statusCode).send(stored.responseBody)
        return
      }
    } catch (err) {
      request.log.warn({ err }, "idempotency lookup error — continuing request")
    }

    // Attach key to request for downstream use
    ;(request as FastifyRequest & { idempotencyKey?: string }).idempotencyKey = key
  })
}

// Extend FastifyRequest to include idempotencyKey
declare module 'fastify' {
  interface FastifyRequest {
    idempotencyKey?: string
  }
}
