import type { FastifyPluginAsync } from 'fastify'
import { ledgerService } from './ledger.service.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { z } from 'zod'

const HQ_LEDGER_ROLES = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export const ledgerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // GET /accounting/journal-entries
  app.get('/journal-entries', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const query = z.object({
      channelId: z.string().uuid().optional(),
      referenceType: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      page: z.coerce.number().min(1).optional(),
      limit: z.coerce.number().min(1).max(100).optional(),
    }).parse(request.query)

    if (!HQ_LEDGER_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
      query.channelId = request.user.channelId
    }

    return ledgerService.getJournalEntries(query)
  })

  // GET /accounting/journal-entries/:id
  app.get('/journal-entries/:id', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id } = request.params as { id: string }
    const isHQ = HQ_LEDGER_ROLES.includes(request.user.role)
    if (!isHQ && !request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
    return ledgerService.getJournalEntry(id, isHQ ? undefined : (request.user.channelId || undefined))
  })

  // GET /accounting/trial-balance
  app.get('/trial-balance', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const query = z.object({
      asOfDate: z.string().optional(),
      channelId: z.string().uuid().optional(),
    }).parse(request.query)

    let cid = query.channelId
    if (!HQ_LEDGER_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
      cid = request.user.channelId
    }

    return ledgerService.getTrialBalance(query.asOfDate, cid)
  })

  // GET /accounting/ledger/:accountId
  app.get('/ledger/:accountId', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const { accountId } = request.params as { accountId: string }
    const query = z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      page: z.coerce.number().min(1).optional(),
      limit: z.coerce.number().min(1).max(100).optional(),
      channelId: z.string().uuid().optional(),
    }).parse(request.query)

    if (!HQ_LEDGER_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
      query.channelId = request.user.channelId
    }

    return ledgerService.getAccountLedger(accountId, query)
  })

  // GET /accounting/profit-loss
  app.get('/profit-loss', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const query = z.object({
      startDate: z.string(),
      endDate: z.string(),
      channelId: z.string().uuid().optional(),
    }).parse(request.query)

    let cid = query.channelId
    if (!HQ_LEDGER_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
      cid = request.user.channelId
    }

    return ledgerService.getProfitLoss(query.startDate, query.endDate, cid)
  })

  // GET /accounting/balance-sheet
  app.get('/balance-sheet', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const query = z.object({
      asOfDate: z.string().optional(),
      channelId: z.string().uuid().optional(),
    }).parse(request.query)

    let cid = query.channelId
    if (!HQ_LEDGER_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
      cid = request.user.channelId
    }

    return ledgerService.getBalanceSheet(query.asOfDate, cid)
  })

  // GET /accounting/inventory-balances — live stock from inventory_balances
  app.get('/inventory-balances', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'STOREKEEPER', 'CASHIER', 'SALES_PERSON')],
  }, async (request) => {
    let { channelId } = z.object({
      channelId: z.string().uuid().optional(),
    }).parse(request.query)

    // Secure channelId: Non-admins (and branch admins) can only view their own channel
    if (!HQ_LEDGER_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
      channelId = request.user.channelId
    }

    const { stockService } = await import('../stock/stock.service.js')
    if (channelId && channelId !== 'NONE') {
      return stockService.getChannelBalances(channelId)
    }
    
    // Safety check for Branch Admins/Managers/Storekeepers who somehow got here without a channelId
    if (!HQ_LEDGER_ROLES.includes(request.user.role)) {
      return []
    }
    // Return all balances across all channels (Admin only)
    const { prisma } = await import('../../lib/prisma.js')
    return prisma.$queryRaw`
      SELECT ib."itemId", ib."channelId", ib."availableQty", ib."lastMovementAt"
      FROM inventory_balances ib
      ORDER BY ib."lastMovementAt" DESC
    `
  })
}

