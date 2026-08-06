import type { FastifyPluginAsync } from 'fastify'
import { stockService } from './stock.service.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize }    from '../../middleware/authorize.js'
import { RATE }         from '../../lib/rate-limit.plugin.js'
import { z }            from 'zod'

const HQ_STOCK_ROLES = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export const stockOverviewRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // GET /stock/balances — live balances from inventory_balances
  // FIX: Added config: RATE.STOCK_READ — was using global 200/min limit
  // shared across all endpoints, making stock scraping trivially easy.
  app.get('/balances', {
    config:     RATE.STOCK_READ,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'STOREKEEPER', 'CASHIER')],
  }, async (request) => {
    const { channelId, categoryId } = z.object({
      channelId:  z.string().uuid().optional(),
      categoryId: z.string().uuid().optional(),
    }).parse(request.query)

    let effectiveChannelId = channelId
    if (!HQ_STOCK_ROLES.includes(request.user.role)) {
      effectiveChannelId = request.user.channelId || undefined
    }

    if (!effectiveChannelId && !HQ_STOCK_ROLES.includes(request.user.role)) {
      throw { statusCode: 400, message: 'channelId required' }
    }
    return stockService.getChannelBalances(effectiveChannelId, categoryId)
  })

  // GET /stock/balance — single item balance
  app.get('/balance', {
    config:     RATE.STOCK_READ,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'STOREKEEPER', 'CASHIER')],
  }, async (request) => {
    const { itemId, channelId } = z.object({
      itemId:    z.string().uuid(),
      channelId: z.string().uuid().optional(),
    }).parse(request.query)

    let effectiveChannelId = channelId
    if (!HQ_STOCK_ROLES.includes(request.user.role)) {
      effectiveChannelId = request.user.channelId || undefined
    }

    if (!effectiveChannelId) {
      throw { statusCode: 400, message: 'channelId required' }
    }
    const qty = await stockService.getBalance(itemId, effectiveChannelId)
    return { itemId, channelId: effectiveChannelId, availableQty: qty }
  })

  // GET /stock/item/:itemId/all-channels — item stock across all channels
  app.get('/item/:itemId/all-channels', {
    config:     RATE.STOCK_READ,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN')],
  }, async (request) => {
    const { itemId } = request.params as { itemId: string }
    return stockService.getItemBalancesAllChannels(itemId)
  })

  // GET /stock/low-stock — items below reorder level
  app.get('/low-stock', {
    config:     RATE.STOCK_READ,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'STOREKEEPER')],
  }, async (request) => {
    const { channelId, categoryId } = z.object({
      channelId:  z.string().uuid().optional(),
      categoryId: z.string().uuid().optional(),
    }).parse(request.query)

    let effectiveChannelId = channelId
    if (!HQ_STOCK_ROLES.includes(request.user.role)) {
      effectiveChannelId = request.user.channelId || undefined
    }

    if (!effectiveChannelId && !HQ_STOCK_ROLES.includes(request.user.role)) {
      throw { statusCode: 400, message: 'channelId required' }
    }
    return stockService.getLowStockItems(effectiveChannelId, categoryId)
  })

  // GET /stock/movements — movement history
  app.get('/movements', {
    config:     RATE.STOCK_READ,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'STOREKEEPER')],
  }, async (request) => {
    const query = z.object({
      itemId:    z.string().uuid(),
      channelId: z.string().uuid().optional(),
      page:      z.coerce.number().min(1).optional(),
      limit:     z.coerce.number().min(1).max(100).optional(),
    }).parse(request.query)

    let effectiveChannelId = query.channelId
    if (!HQ_STOCK_ROLES.includes(request.user.role)) {
      effectiveChannelId = request.user.channelId || undefined
    }

    if (!effectiveChannelId) {
      throw { statusCode: 400, message: 'channelId required' }
    }
    return stockService.getMovementHistory(query.itemId, effectiveChannelId, query.page, query.limit)
  })
}
