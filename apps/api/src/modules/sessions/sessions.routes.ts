import type { FastifyPluginAsync } from 'fastify'
import { sessionsService } from './sessions.service.js'
import { authenticate }    from '../../middleware/authenticate.js'
import { authorize }       from '../../middleware/authorize.js'
import { RATE }            from '../../lib/rate-limit.plugin.js'
import { z }               from 'zod'

const HQ_SESSION_ROLES = ['PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export const sessionsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // POST /sessions/open
  app.post('/open', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER')],
  }, async (request, reply) => {
    const body = z.object({
      channelId:    z.string().uuid(),
      openingFloat: z.coerce.number().min(0),
    }).parse(request.body)

    if (!HQ_SESSION_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      if (body.channelId !== request.user.channelId) {
        throw { statusCode: 403, message: 'You can only open sessions for your assigned channel' }
      }
    }

    const session = await sessionsService.open(request.user.sub, body.channelId, body.openingFloat, request.user.role)
    reply.status(201).send(session)
  })

  // POST /sessions/:id/close
  app.post('/:id/close', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER')],
  }, async (request) => {
    const { id } = request.params as { id: string }
    const body   = z.object({
      closingFloat: z.coerce.number().min(0),
      notes:        z.string().optional(),
    }).parse(request.body)

    const session = await sessionsService.findById(id)
    if (!HQ_SESSION_ROLES.includes(request.user.role)) {
      if (session.channelId !== request.user.channelId) {
        throw { statusCode: 403, message: 'You do not have access to close this session' }
      }
    }

    // FIX 5: Pass actorId and actorRole — previously these were omitted,
    // meaning the ownership check inside service.close() never fired.
    // Any CASHIER could close any session just by knowing the session ID.
    return sessionsService.close(id, body.closingFloat, request.user.sub, request.user.role, body.notes)
  })

  // GET /sessions/active
  // FIX 4: Added authorize() — was open to any authenticated user including
  // PROMOTER and STOREKEEPER who have no need to view session float data.
  app.get('/active', {
    config:     RATE.READ,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER')],
  }, async (request) => {
    return sessionsService.getActiveSession(request.user.sub)
  })

  // GET /sessions/:id
  // FIX 4: Added authorize() and channel scope check.
  app.get('/:id', {
    config:     RATE.READ,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER')],
  }, async (request, reply) => {
    const { id }  = request.params as { id: string }
    const session = await (sessionsService as any).findById(id)

    if (!HQ_SESSION_ROLES.includes(request.user.role)) {
      if (session.channelId !== request.user.channelId) {
        return reply.status(403).send({ error: 'Forbidden', message: 'You do not have access to this session' })
      }
    }

    return session
  })

  // GET /sessions
  app.get('/', {
    config:     RATE.READ,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const query = z.object({
      channelId: z.string().uuid().optional(),
      page:      z.coerce.number().min(1).optional(),
      limit:     z.coerce.number().min(1).max(100).optional(),
    }).parse(request.query)

    let cid = query.channelId
    if (!HQ_SESSION_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      cid = request.user.channelId
    }

    return sessionsService.findAll(cid, query.page, query.limit)
  })
}
