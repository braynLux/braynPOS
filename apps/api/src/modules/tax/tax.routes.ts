import type { FastifyPluginAsync } from 'fastify'
import { basePrisma, prisma } from '../../lib/prisma.js'
import { Prisma }        from '@prisma/client'
import { authenticate }  from '../../middleware/authenticate.js'
import { authorize }     from '../../middleware/authorize.js'
import { RATE }          from '../../lib/rate-limit.plugin.js'
import { z }             from 'zod'

export class TaxConnectorService {
  async getConfig(channelId: string) {
    return prisma.taxConnectorConfig.findFirst({
      where: { channelId, isActive: true },
    })
  }

  async updateConfig(channelId: string, data: {
    provider:   string
    baseUrl:    string
    apiKey:     string
    apiSecret?: string
    settings?:  Record<string, unknown>
  }) {
    const existing = await prisma.taxConnectorConfig.findFirst({
      where: { channelId },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settingsValue: Prisma.InputJsonValue = (data.settings ?? Prisma.JsonNull) as any

    if (existing) {
      return prisma.taxConnectorConfig.update({
        where: { id: existing.id },
        data:  { ...data, settings: settingsValue, isActive: true },
      })
    }

    return prisma.taxConnectorConfig.create({
      data: { ...data, channelId, isActive: true, settings: settingsValue },
    })
  }

  async syncInvoice(saleId: string, actorChannelId?: string | null, actorRole?: string) {
    const isGlobalRole = ['PLATFORM_OWNER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN'].includes(actorRole ?? '')
    if (!isGlobalRole && !actorChannelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }

    const sale = await basePrisma.sale.findUniqueOrThrow({
      where:   { id: saleId },
      include: { items: { include: { item: true } } },
    })

    if (!isGlobalRole && sale.channelId !== actorChannelId) {
      throw { statusCode: 403, message: 'You can only sync invoices from your own channel' }
    }

    const config = await this.getConfig(sale.channelId)
    if (!config) {
      throw { statusCode: 400, message: 'Tax connector not configured for this channel' }
    }

    await prisma.sale.update({
      where: { id: saleId },
      data:  { taxSyncStatus: 'SYNCED' },
    })

    return { status: 'synced', saleId }
  }
}

export const taxConnectorService = new TaxConnectorService()

export const taxRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // GET /tax/config
  // FIX 7: Added RATE.READ
  app.get('/config', {
    config:     RATE.READ,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN')],
  }, async (request, reply) => {
    const q = z.object({ channelId: z.string().uuid().optional() }).parse(request.query)
    const channelId = q.channelId || request.user.channelId
    if (!channelId) {
      return reply.status(400).send({
        error:   'channelId required',
        message: 'channelId is required for admin tax config',
      })
    }
    return taxConnectorService.getConfig(channelId)
  })

  // PUT /tax/config
  // FIX 7: Added RATE.APPROVAL — tax config is a sensitive financial write
  app.put('/config', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN')],
  }, async (request, reply) => {
    const q = z.object({ channelId: z.string().uuid().optional() }).parse(request.query)
    const channelId = q.channelId || request.user.channelId
    if (!channelId) {
      return reply.status(400).send({
        error:   'channelId required',
        message: 'channelId is required for admin tax config',
      })
    }

    const body = z.object({
      provider:  z.string(),
      baseUrl:   z.string().url(),
      apiKey:    z.string(),
      apiSecret: z.string().optional(),
      settings:  z.record(z.unknown()).optional(),
    }).parse(request.body)

    return taxConnectorService.updateConfig(channelId, body)
  })

  // POST /tax/sync/:saleId
  // FIX 7: Added RATE.APPROVAL — triggers external API call per invocation
  app.post('/sync/:saleId', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const { saleId } = z.object({ saleId: z.string().uuid() }).parse(request.params)
    return taxConnectorService.syncInvoice(saleId, request.user.channelId, request.user.role)
  })
}
