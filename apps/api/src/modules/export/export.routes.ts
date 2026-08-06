import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { exportService } from '../reports/export.service.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { RATE } from '../../lib/rate-limit.plugin.js'

const exportCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const exportPayloadSchema = z.object({
  title: z.string().trim().min(1).max(120),
  headers: z.array(z.string().trim().min(1).max(120)).min(1).max(100),
  data: z.array(z.array(exportCellSchema).max(100)).max(10000),
}).refine((payload) => payload.data.every(row => row.length === payload.headers.length), {
  message: 'Each data row must have the same number of cells as headers',
})

export const exportRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', authenticate)

  fastify.post('/sheets', {
    config: RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { title, headers, data } = exportPayloadSchema.parse(request.body)

    try {
      const result = await exportService.exportToSheets(request.user.sub, title, data, headers)
      return reply.send(result)
    } catch (error: any) {
      if (error?.message?.includes('Google account not connected') || error?.statusCode === 400) {
        return reply.status(400).send({ error: 'Google account not connected. Please connect your Google account in settings.' })
      }
      request.log.error({ err: error }, 'Failed to export to Google Sheets')
      return reply.status(500).send({ error: 'Failed to export to Google Sheets.' })
    }
  })

  fastify.post('/docs', {
    config: RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { title, headers, data } = exportPayloadSchema.parse(request.body)

    try {
      const result = await exportService.exportToDocs(request.user.sub, title, data, headers)
      return reply.send(result)
    } catch (error: any) {
      if (error?.message?.includes('Google account not connected') || error?.statusCode === 400) {
        return reply.status(400).send({ error: 'Google account not connected. Please connect your Google account in settings.' })
      }
      request.log.error({ err: error }, 'Failed to export to Google Docs')
      return reply.status(500).send({ error: 'Failed to export to Google Docs.' })
    }
  })
}
