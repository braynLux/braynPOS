import type { FastifyPluginAsync } from 'fastify'
import net from 'node:net'
import { Prisma }           from '@prisma/client'
import { prisma }           from '../../lib/prisma.js'
import { settingsService }  from './settings.service.js'
import { authenticate }     from '../../middleware/authenticate.js'
import { authorize }        from '../../middleware/authorize.js'
import { RATE }             from '../../lib/rate-limit.plugin.js'
import { diagnosticsService } from '../support/diagnostics.service.js'
import { z }                from 'zod'

const CRITICAL_STOCK_THRESHOLD = 0
const GLOBAL_SETTINGS_ROLES = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

const printerTestSchema = z.object({
  host: z.string()
    .trim()
    .min(1, 'Printer host/IP is required')
    .max(253, 'Printer host/IP is too long')
    .regex(/^[a-zA-Z0-9.-]+$/, 'Printer host/IP must be a hostname or IPv4 address'),
  port: z.coerce.number().int().min(1).max(65535).default(9100),
})

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // GET /dashboard/settings
  // FIX 2: Added authorize() — was open to any authenticated user
  app.get('/settings', {
    config:     RATE.READ,
    preHandler: [authorize(
      'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER',
      'CASHIER', 'SALES_PERSON', 'STOREKEEPER',
    )],
  }, async (request) => {
    if (!GLOBAL_SETTINGS_ROLES.includes(request.user.role) && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    return settingsService.getAll(request.user.channelId ?? null)
  })

  // GET /dashboard/summary
  // FIX 2: Added authorize() — was open to any authenticated user exposing
  // revenue, expenses, stock counts, and recent sale details.
  app.get('/summary', {
    config:     RATE.READ,
    preHandler: [authorize(
      'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER',
      'CASHIER', 'SALES_PERSON', 'STOREKEEPER',
    )],
  }, async (request) => {
    const isHQ               = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN'].includes(request.user.role)
    if (!isHQ && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    const effectiveChannelId = isHQ ? undefined : (request.user.channelId || undefined)

    // FIX: Use EAT (UTC+3) start-of-day to ensure sales made after midnight show up correctly
    const now     = new Date()
    const eatNow  = new Date(now.getTime() + 3 * 60 * 60 * 1000)
    const today   = new Date(eatNow.toISOString().slice(0, 10) + 'T00:00:00+03:00')

    const [
      todaySalesRaw,
      todayExpenses,
      activeChannelsCount,
      criticalStock,
      suggestedReorder,
      pendingTransfersRaw,
      recentSales,
      todayCogsRaw,
      lowStockList,
    ] = await Promise.all([
      // Sales Summary
      prisma.$queryRaw<Array<{ count: number; revenue: string | number | null }>>`
        SELECT
          COUNT(*)::int                 AS count,
          COALESCE(SUM("netAmount"), 0) AS revenue
        FROM sales
        WHERE "deletedAt" IS NULL
          AND "createdAt" >= ${today}
          ${effectiveChannelId
            ? Prisma.sql`AND "channelId" = ${effectiveChannelId}`
            : Prisma.empty}
      `,
      // Expenses
      // deletedAt filtered explicitly, matching the raw sales query above —
      // the soft-delete middleware that would do this automatically is never
      // registered, so a voided expense otherwise still counts against today.
      prisma.expense.aggregate({
        where: {
          deletedAt: null,
          createdAt: { gte: today },
          ...(effectiveChannelId && { channelId: effectiveChannelId }),
        },
        _sum: { amount: true },
      }),
      // Active Channels
      prisma.channel.count({ where: { deletedAt: null } }),

      prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT i.id
          FROM items i
          LEFT JOIN inventory_balances ib ON ib."itemId" = i.id
          WHERE i."deletedAt" IS NULL AND i."isActive" = true
          ${effectiveChannelId 
            ? Prisma.sql`AND ib."channelId" = ${effectiveChannelId}` 
            : Prisma.empty}
          GROUP BY i.id, i."reorderLevel"
          HAVING COALESCE(SUM(ib."availableQty"), 0) <= ${CRITICAL_STOCK_THRESHOLD}
        ) as sub
      `,

      prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT i.id
          FROM items i
          LEFT JOIN inventory_balances ib ON ib."itemId" = i.id
          WHERE i."deletedAt" IS NULL AND i."isActive" = true
          ${effectiveChannelId 
            ? Prisma.sql`AND ib."channelId" = ${effectiveChannelId}` 
            : Prisma.empty}
          GROUP BY i.id, i."reorderLevel"
          HAVING COALESCE(SUM(ib."availableQty"), 0) > ${CRITICAL_STOCK_THRESHOLD}
             AND COALESCE(SUM(ib."availableQty"), 0) <= i."reorderLevel"
        ) as sub
      `,

      prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM transfers
        WHERE status IN ('SENT', 'AWAITING_RECEIVER')
          ${effectiveChannelId
            ? Prisma.sql`AND ("fromChannelId" = ${effectiveChannelId} OR "toChannelId" = ${effectiveChannelId})`
            : Prisma.empty}
      `,

      prisma.$queryRaw<Array<{
        id: string; receiptNo: string; netAmount: string
        channelId: string; customerId: string | null
        createdAt: Date; channelName: string | null; customerName: string | null
      }>>`
        SELECT
          s.id,
          s."receiptNo",
          s."netAmount",
          s."channelId",
          s."customerId",
          s."createdAt",
          ch.name  AS "channelName",
          cu.name  AS "customerName"
        FROM   sales s
        LEFT   JOIN channels  ch ON ch.id = s."channelId"
        LEFT   JOIN customers cu ON cu.id = s."customerId"
        WHERE  s."deletedAt" IS NULL
          AND  s."createdAt" >= ${today}
          ${effectiveChannelId
            ? Prisma.sql`AND s."channelId" = ${effectiveChannelId}`
            : Prisma.empty}
        ORDER  BY s."createdAt" DESC
        LIMIT  5
      `,
      // Profit / Markup
      prisma.$queryRaw<Array<{ cogs: number }>>`
        SELECT COALESCE(SUM(si."costPriceSnapshot" * si.quantity), 0) AS cogs
        FROM   sale_items si
        JOIN   sales s ON s.id = si."saleId"
        WHERE  s."deletedAt" IS NULL
          AND  s."createdAt" >= ${today}
          ${effectiveChannelId
            ? Prisma.sql`AND s."channelId" = ${effectiveChannelId}`
            : Prisma.empty}
      `,
      // Itemized low-stock alert (worst-first, capped)
      prisma.$queryRaw<Array<{
        id: string; name: string; sku: string
        availableQty: string | number; reorderLevel: number
      }>>`
        SELECT i.id, i.name, i.sku, i."reorderLevel",
               COALESCE(SUM(ib."availableQty"), 0) AS "availableQty"
        FROM   items i
        LEFT   JOIN inventory_balances ib ON ib."itemId" = i.id
        WHERE  i."deletedAt" IS NULL AND i."isActive" = true
          ${effectiveChannelId
            ? Prisma.sql`AND ib."channelId" = ${effectiveChannelId}`
            : Prisma.empty}
        GROUP  BY i.id, i."reorderLevel"
        HAVING COALESCE(SUM(ib."availableQty"), 0) <= i."reorderLevel"
        ORDER  BY (i."reorderLevel" - COALESCE(SUM(ib."availableQty"), 0)) DESC
        LIMIT  10
      `,
    ])
    // ── Safe Data Mapping ──────────────────────────────────────────
    const salesRow      = todaySalesRaw[0] || { count: 0, revenue: 0 }
    const salesCount    = Number(salesRow.count)
    const salesRevenue  = Number(salesRow.revenue)
    const totalExpenses = Number(todayExpenses._sum.amount ?? 0)
    const cogs          = Number(todayCogsRaw[0]?.cogs ?? 0)
    const todayProfit   = salesRevenue - cogs

    return {
      todaySales:            salesCount,
      todayRevenue:          salesRevenue,
      todayProfit:           todayProfit,
      markupPercent:         salesRevenue > 0 ? (todayProfit / salesRevenue) * 100 : 0,
      todayExpenses:         totalExpenses,
      activeChannels:        isHQ ? activeChannelsCount : 1,
      lowStockItems:         (criticalStock[0]?.count    ?? 0)
                           + (suggestedReorder[0]?.count ?? 0),
      criticalItemsCount:    criticalStock[0]?.count    ?? 0,
      suggestedReorderCount: suggestedReorder[0]?.count ?? 0,
      pendingTransfers:      pendingTransfersRaw[0]?.count ?? 0,
      lowStockList: lowStockList.map(i => ({
        id:           i.id,
        name:         i.name,
        sku:          i.sku,
        availableQty: Number(i.availableQty),
        reorderLevel: i.reorderLevel,
        severity:     Number(i.availableQty) <= CRITICAL_STOCK_THRESHOLD ? 'critical' : 'low',
      })),
      recentSales: recentSales.map(s => ({
        id:         s.id,
        receiptNo:  s.receiptNo,
        netAmount:  Number(s.netAmount),
        channelId:  s.channelId,
        customerId: s.customerId,
        createdAt:  s.createdAt,
        channel:    s.channelName  ? { name: s.channelName  } : null,
        customer:   s.customerName ? { name: s.customerName } : null,
      })),
    }
  })

  // PATCH /dashboard/settings
  app.patch('/settings', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
    schema:     { body: { type: 'object' } },
  }, async (request) => {
    const body = request.body as Record<string, any>
    const isGlobalSettingsRole = GLOBAL_SETTINGS_ROLES.includes(request.user.role)
    const channelId = isGlobalSettingsRole ? (request.user.channelId ?? null) : request.user.channelId

    if (!isGlobalSettingsRole && !channelId) {
      throw app.httpErrors.badRequest('Your account has no channel assigned')
    }

    // FIX 3: Use .sub not .id — consistent with the rest of the codebase
    return settingsService.bulkUpdate(body, request.user.sub, channelId ?? null)
  })

  // GET /dashboard/health
  app.get('/health', {
    config:     RATE.READ,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN')],
  }, async (request) => {
    return diagnosticsService.runFullDiagnostic(request.user.channelId ?? undefined)
  })

  // POST /dashboard/settings/printers/test
  app.post('/settings/printers/test', {
    config: RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request) => {
    const { host, port } = printerTestSchema.parse(request.body)

    return new Promise((resolve) => {
      const socket = new net.Socket()
      let status = 'error'

      socket.setTimeout(3000)
      socket.on('connect', () => { status = 'online'; socket.destroy() })
      socket.on('timeout', () => { status = 'timeout'; socket.destroy() })
      socket.on('error', ()   => { status = 'offline'; })
      socket.on('close', ()   => { resolve({ status }) })

      socket.connect(port, host)
    })
  })
}
