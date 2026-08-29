import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { AsyncLocalStorage } from 'async_hooks'

interface RequestContext {
  requestId:     string
  userId?:       string
  role?:         string
  channelId?:    string
  enterpriseId?: string
}

export const requestContext = new AsyncLocalStorage<RequestContext>()

// ══════════════════════════════════════════════════════════════════════
// REQUEST CONTEXT PLUGIN
// apps/api/src/lib/request-context.plugin.ts
// ══════════════════════════════════════════════════════════════════════

export const requestContextPlugin = fp(async (app: FastifyInstance) => {

  app.addHook('onRequest', (request, reply, done) => {
    requestContext.run({ requestId: request.id as string }, done)
  })

  // Population is now handled by authenticate() middleware for earlier availability

  app.addHook('onResponse', async (request, reply) => {
    request.log.info({
      method:     request.method,
      url:        request.url,
      statusCode: reply.statusCode,
      duration:   reply.elapsedTime.toFixed(2) + 'ms',
    }, 'request completed')
  })

  app.addHook('onError', async (request, _reply, error) => {
    request.log.error({
      err: error,
      method:  request.method,
      url:     request.url,
      body:    request.method !== 'GET' ? '[redacted]' : undefined,
    }, 'request error')
  })

  app.log.info('[request-context] Request context plugin registered')
})
