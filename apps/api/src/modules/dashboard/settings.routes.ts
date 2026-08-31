import type { FastifyPluginAsync } from 'fastify'
import { settingsService } from './settings.service.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { z } from 'zod'

const GLOBAL_SETTINGS_ROLES = ['PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // GET /settings - Fetch all settings for the channel (with global fallbacks)
  app.get('/settings', async (request) => {
    return settingsService.getAll(request.user.channelId)
  })

  // PATCH /settings - Bulk update settings for the channel
  app.patch('/settings', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const body = z.record(z.any()).parse(request.body)
    const isGlobalSettingsRole = GLOBAL_SETTINGS_ROLES.includes(request.user.role)
    const channelId = isGlobalSettingsRole ? (request.user.channelId ?? null) : request.user.channelId

    if (!isGlobalSettingsRole && !channelId) {
      throw app.httpErrors.badRequest('Your account has no channel assigned')
    }

    return settingsService.bulkUpdate(body, request.user.sub, channelId ?? null)
  })

  // GET /settings/:key - Fetch specific setting
  app.get('/settings/:key', async (request) => {
    const { key } = request.params as { key: string }
    return settingsService.getByKey(key, request.user.channelId)
  })

  // PUT /settings/:key - Update specific setting
  app.put('/settings/:key', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const { key } = request.params as { key: string }
    const { value } = z.object({ value: z.any() }).parse(request.body)
    const isGlobalSettingsRole = GLOBAL_SETTINGS_ROLES.includes(request.user.role)
    const channelId = isGlobalSettingsRole ? (request.user.channelId ?? null) : request.user.channelId

    if (!isGlobalSettingsRole && !channelId) {
      throw app.httpErrors.badRequest('Your account has no channel assigned')
    }

    return settingsService.update(key, value, request.user.sub, channelId ?? null)
  })
}
