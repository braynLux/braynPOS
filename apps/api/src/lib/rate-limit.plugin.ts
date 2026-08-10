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

export const RATE = {
  SALE_COMMIT: {
    rateLimit: {
      max:        10,
      timeWindow: '30 seconds',
      keyGenerator: (request: any) => `sale-commit-${request.user?.id ?? request.ip}`,
    },
  },

  OFFLINE_SYNC: {
    rateLimit: {
      max:        30,
      timeWindow: '1 minute',
      keyGenerator: (request: any) => `offline-${request.user?.id ?? request.ip}`,
    },
  },

  AUTH_LOGIN: {
    rateLimit: {
      max:        5,
      timeWindow: '1 minute',
      // Keyed on IP for pre-auth endpoints — no user identity yet
      keyGenerator: (request: any) => `auth-${request.ip}`,
    },
  },

  APPROVAL: {
    rateLimit: {
      max:        5,
      timeWindow: '1 minute',
      // FIX: Was missing keyGenerator — fell back to global IP-based key.
      // Key by channelId + action so each specific approval type is
      // independently rate-limited per channel, not shared across all
      // approval types from the same IP.
      keyGenerator: (request: any) => {
        const body = request.body as any
        return `approval-${body?.channelId ?? 'unknown'}-${body?.action ?? 'unknown'}-${request.ip}`
      },
    },
  },

  READ: {
    rateLimit: {
      max:        120,
      timeWindow: '1 minute',
      // FIX: Was missing keyGenerator — fell back to IP.
      // Behind NAT/proxies, all users share one IP and exhaust each
      // other's quotas. Key by authenticated user ID when available.
      keyGenerator: (request: any) => `read-${request.user?.id ?? request.ip}`,
    },
  },

  // Rate limit config for stock endpoints (previously had none)
  STOCK_READ: {
    rateLimit: {
      max:        100,
      timeWindow: '1 minute',
      keyGenerator: (request: any) => `stock-${request.user?.id ?? request.ip}`,
    },
  },
  // AI support chat. Every request spends a Gemini embedding call plus a
  // streaming generation against a paid quota, and fans out into per-word
  // item lookups and a seven-day sales aggregate, so this is far more
  // expensive than an ordinary read and is limited well below READ.
  // Keyed per user: one person looping the endpoint must not exhaust the
  // shared quota for everyone else on the same NAT or proxy.
  AI_CHAT: {
    rateLimit: {
      max:        10,
      timeWindow: '1 minute',
      keyGenerator: (request: any) => `ai-chat-${request.user?.id ?? request.ip}`,
    },
  },

  // Anti-Scraping for Digital Catalog
  PUBLIC_CATALOG: {
    rateLimit: {
      max:        20,
      timeWindow: '1 minute',
      // Strict IP-based limit for public access
      keyGenerator: (request: any) => `catalog-public-${request.ip}`,
    },
  },
} as const
