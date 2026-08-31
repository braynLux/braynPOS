import fp from 'fastify-plugin'
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance } from 'fastify'

export const rateLimitPlugin = fp(async (app: FastifyInstance) => {
  await app.register(rateLimit, {
    global:     true,
    max:        200,
    timeWindow: '1 minute',
    nameSpace:  'brayn-global-',
    keyGenerator: (request: any) => {
      const user = request.user
      if (user?.id) return `user-${user.id}`
      return request.ip
    },
    errorResponseBuilder: (_request: any, context: any) => ({
      statusCode: 429,
      error:      'Too Many Requests',
      message:    `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      retryAfter: Math.ceil(context.ttl / 1000),
    }),
    allowList: (request: any) =>
      request.routeOptions?.url === '/health' || request.routeOptions?.url === '/ready',
  })
})

function extractClientKey(request: any, prefix: string): string {
  const auth = request.headers?.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    // The last 32 characters represent the cryptographic signature, unique per token/user
    return `${prefix}-token-${auth.slice(-32)}`
  }
  const user = request.user
  if (user?.sub || user?.id) {
    return `${prefix}-user-${user.sub || user.id}`
  }
  return `${prefix}-ip-${request.ip}`
}

export const RATE = {
  SALE_COMMIT: {
    rateLimit: {
      max:        60,
      timeWindow: '1 minute',
      keyGenerator: (request: any) => extractClientKey(request, 'sale-commit'),
    },
  },

  OFFLINE_SYNC: {
    rateLimit: {
      max:        60,
      timeWindow: '1 minute',
      keyGenerator: (request: any) => extractClientKey(request, 'offline-sync'),
    },
  },

  AUTH_LOGIN: {
    rateLimit: {
      max:        10,
      timeWindow: '1 minute',
      keyGenerator: (request: any) => `auth-${request.ip}`,
    },
  },

  APPROVAL: {
    rateLimit: {
      max:        10,
      timeWindow: '1 minute',
      keyGenerator: (request: any) => {
        const body = request.body as any
        const clientKey = extractClientKey(request, 'approval')
        return `${clientKey}-${body?.channelId ?? 'unknown'}-${body?.action ?? 'unknown'}`
      },
    },
  },

  READ: {
    rateLimit: {
      max:        200,
      timeWindow: '1 minute',
      keyGenerator: (request: any) => extractClientKey(request, 'read'),
    },
  },

  STOCK_READ: {
    rateLimit: {
      max:        150,
      timeWindow: '1 minute',
      keyGenerator: (request: any) => extractClientKey(request, 'stock'),
    },
  },

  PUBLIC_CATALOG: {
    rateLimit: {
      max:        30,
      timeWindow: '1 minute',
      keyGenerator: (request: any) => `catalog-public-${request.ip}`,
    },
  },
} as const
