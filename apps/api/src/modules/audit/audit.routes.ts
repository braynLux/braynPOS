import type { FastifyPluginAsync } from 'fastify'
import { prisma }    from '../../lib/prisma.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize }    from '../../middleware/authorize.js'
import { RATE }         from '../../lib/rate-limit.plugin.js'
import { z }            from 'zod'

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // GET /audit
  // Returns audit logs with pagination and filtering. 
  // Restricted to high-level roles only.
  app.get('/', {
    config:     RATE.READ,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const query = z.object({
      page:       z.coerce.number().min(1).optional().default(1),
      limit:      z.coerce.number().min(1).max(100).optional().default(50),
      channelId:  z.string().optional(),
      actorId:    z.string().optional(),
      action:     z.string().optional(),
      targetType: z.string().optional(),
      startDate:  z.string().optional(),
      endDate:    z.string().optional(),
    }).parse(request.query)

    const skip = (query.page - 1) * query.limit

    // ── RBAC Scoping ───────────────────────────────────────────────
    // MANAGER role is restricted to seeing only logs for their own channel.
    let effectiveChannelId = query.channelId
    if (!['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN'].includes(request.user.role)) {
      effectiveChannelId = request.user.channelId || 'NONE' 
    }

    const isPlatformOwner = request.user.role === 'PLATFORM_OWNER'
    const enterpriseId    = request.user.enterpriseId

    const where: any = {
      ...(enterpriseId && !isPlatformOwner && { enterpriseId }),
      ...(effectiveChannelId && { channelId: effectiveChannelId }),
      ...(query.actorId      && { actorId:   query.actorId }),
      ...(query.action       && { action:    query.action }),
      ...(query.targetType   && { targetType: query.targetType }),
      ...((query.startDate || query.endDate) && {
        createdAt: {
          ...(query.startDate && { gte: new Date(query.startDate) }),
          ...(query.endDate   && { lte: new Date(query.endDate) }),
        }
      })
    }

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        take:    query.limit,
        skip,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count({ where })
    ])

    // Enrich logs with actor names where possible
    // (This is a simplified enrichment, in production we might use a join or map)
    const actorIds = [...new Set(data.map(l => l.actorId))]
    const actors   = await prisma.user.findMany({
      where:  { id: { in: actorIds } },
      select: { id: true, username: true, role: true }
    })
    const actorMap = Object.fromEntries(actors.map(u => [u.id, u]))

    const enriched = data.map(log => ({
      ...log,
      actorDetail: actorMap[log.actorId] || { username: 'Unknown User' }
    }))

    return {
      data: enriched,
      meta: {
        total,
        page:       query.page,
        limit:      query.limit,
        totalPages: Math.ceil(total / query.limit)
      }
    }
  })

  // POST /audit/serial-swap
  // Forensic tool to correct serial numbers post-sale.
  app.post('/serial-swap', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN')],
  }, async (request) => {
    const schema = z.object({
      saleId:      z.string().uuid(),
      itemId:      z.string().uuid(),
      oldSerialId: z.string().uuid().nullable(),
      newSerialNo: z.string().min(1),
      reason:      z.string().min(4)
    })

    const body = schema.parse(request.body)
    const { auditService } = await import('./audit.service.js')
    
    return auditService.swapSerialNumber({
      ...body,
      actorId: request.user.sub
    })
  })

  // GET /audit/serial-history
  app.get('/serial-history', {
    config:     RATE.READ,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN')],
  }, async (request) => {
    const { auditService } = await import('./audit.service.js')
    return auditService.getSerialAudits()
  })
}
