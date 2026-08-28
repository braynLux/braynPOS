import { prisma } from '../../lib/prisma.js'

// FIX 5: Validate and parse date strings safely with Kenya Time (EAT, UTC+3) Awareness
function parseDate(dateStr: string, endOfDay = false): Date {
  // If we receive just a date "YYYY-MM-DD", treat it as start of day in Kenya (+3)
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
  let d: Date
  
  if (isDateOnly) {
    d = new Date(dateStr + 'T00:00:00+03:00')
  } else {
    d = new Date(dateStr)
  }

  if (isNaN(d.getTime())) {
    throw { statusCode: 400, message: `Invalid date: "${dateStr}"` }
  }

  if (endOfDay) {
    // If it's a date only, set it to the very end of that day in Kenya time
    if (isDateOnly) {
       d = new Date(dateStr + 'T23:59:59.999+03:00')
    } else {
       // Otherwise, cap the provided UTC timestamp to the end of its UTC day (legacy behavior)
       d.setUTCHours(23, 59, 59, 999)
    }
  }
  return d
}

export class ReportsService {
  async salesSummary(channelId: string, startDate: string, endDate: string) {
    const start = parseDate(startDate)
    const end   = parseDate(endDate, true)

    const sales = await prisma.sale.aggregate({
      where: {
        channelId,
        createdAt: { gte: start, lte: end },
        deletedAt: null,
      },
      _sum:   { totalAmount: true, discountAmount: true, netAmount: true },
      _count: true,
    })

    // FIX 3 + 4: Compute COGS in the DB with aggregate(), not by loading
    // all rows. Also excludes voided sales via deletedAt: null.
    // COGS = sum(costPriceSnapshot * quantity) — use a raw aggregation
    // since Prisma aggregate doesn't support computed fields
    // AUDIT FIX: We now explicitly track "unreliable" items where cost is 0.
    const cogsRaw = await prisma.$queryRaw<Array<{ cogs: number, unreliableCount: number }>>`
      SELECT 
        COALESCE(SUM(si."costPriceSnapshot" * si.quantity), 0) AS cogs,
        COUNT(*) FILTER (WHERE si."costPriceSnapshot" <= 0) AS "unreliableCount"
      FROM   sale_items si
      JOIN   sales s ON s.id = si."saleId"
      WHERE  s."channelId" = ${channelId}
        AND  s."createdAt" >= ${start}
        AND  s."createdAt" <= ${end}
        AND  s."deletedAt" IS NULL
    `
    const cogs = Number(cogsRaw[0]?.cogs ?? 0)
    const unreliableCount = Number(cogsRaw[0]?.unreliableCount ?? 0)

    const expenses = await prisma.expense.aggregate({
      where: {
        channelId,
        createdAt: { gte: start, lte: end },
      },
      _sum:   { amount: true },
      _count: true,
    })

    const netSales    = Number(sales._sum.netAmount ?? 0)
    const grossMargin = netSales - cogs

    const topItemsRaw = await this.topSellingItems(channelId, startDate, endDate, 5)
    const topItems    = topItemsRaw.map(i => ({
      itemId:   i.itemId,
      itemName: i.name || 'Unknown',
      qty:      i.totalQtySold,
      revenue:  i.totalRevenue,
    }))

    const topCustomers = await this.topCustomers(channelId, startDate, endDate, 5)

    const purchases = await prisma.purchase.aggregate({
      where: {
        channelId,
        createdAt: { gte: start, lte: end },
        status:    'COMMITTED',
      },
      _sum:   { totalCost: true, landedCostTotal: true },
      _count: true,
    })

    const totalPurchases = Number(purchases._sum?.totalCost ?? 0) + Number(purchases._sum?.landedCostTotal ?? 0)
    const totalExpenses  = Number(expenses._sum.amount ?? 0)

    return {
      period:    { startDate, endDate },
      sales: {
        count:          sales._count,
        totalAmount:    Number(sales._sum.totalAmount    ?? 0),
        grossAmount:    Number(sales._sum.totalAmount    ?? 0),
        discountAmount: Number(sales._sum.discountAmount ?? 0),
        netAmount:      netSales,
        cogs,
        unreliableCount,
      },
      expenses:  { count: expenses._count,  totalAmount: totalExpenses  },
      purchases: { count: purchases._count, totalAmount: totalPurchases },
      topItems,
      topCustomers,
      grossMargin,
      profit: grossMargin - totalExpenses,
      marginStatus: unreliableCount > 0 ? 'UNCERTAIN' : 'VERIFIED',
    }
  }

  async topSellingItems(channelId: string, startDate: string, endDate: string, limit = 10) {
    const start = parseDate(startDate)
    const end   = parseDate(endDate, true)

    const rows = await prisma.saleItem.groupBy({
      by:    ['itemId'],
      where: {
        sale: {
          channelId,
          createdAt: { gte: start, lte: end },
          deletedAt: null,    // FIX 4
        },
      },
      _sum:     { quantity: true, lineTotal: true },
      orderBy:  { _sum: { quantity: 'desc' } },
      take:     limit,
    })

    // FIX 1: Single findMany instead of one findUnique per row (N+1)
    const itemIds  = rows.map(r => r.itemId)
    const items    = await prisma.item.findMany({
      where:  { id: { in: itemIds } },
      select: { id: true, name: true, sku: true },
    })
    const itemMap  = Object.fromEntries(items.map(i => [i.id, i]))

    return rows.map(row => ({
      itemId:       row.itemId,
      name:         itemMap[row.itemId]?.name,
      sku:          itemMap[row.itemId]?.sku,
      totalQtySold: row._sum.quantity,
      totalRevenue: Number(row._sum.lineTotal ?? 0),
    }))
  }

  async topCustomers(channelId: string, startDate: string, endDate: string, limit = 10) {
    const start = parseDate(startDate)
    const end   = parseDate(endDate, true)

    const sales = await prisma.sale.groupBy({
      by: ['customerId'],
      where: {
        channelId,
        createdAt: { gte: start, lte: end },
        deletedAt: null,
        customerId: { not: null }
      },
      _sum: { netAmount: true },
      _count: true,
      orderBy: { _sum: { netAmount: 'desc' } },
      take: limit,
    })

    const customerIds = sales.map(s => s.customerId).filter(Boolean) as string[]
    if (customerIds.length === 0) return []

    const customers = await prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true, phone: true }
    })
    const customerMap = Object.fromEntries(customers.map(c => [c.id, c]))

    return sales.map(s => ({
      customerId: s.customerId as string,
      name: customerMap[s.customerId as string]?.name || 'Unknown',
      phone: customerMap[s.customerId as string]?.phone || '',
      totalSpent: Number(s._sum.netAmount ?? 0),
      visitCount: s._count
    }))
  }

  async stockFlowReport(channelId: string, startDate: string, endDate: string) {
    const start = parseDate(startDate)
    const end   = parseDate(endDate, true)

    const movements = await prisma.stockMovement.groupBy({
      by:    ['movementType'],
      where: { channelId, createdAt: { gte: start, lte: end } },
      _sum:   { quantityChange: true },
      _count: true,
    })

    return movements.map(m => ({
      movementType:     m.movementType,
      totalQuantity:    m._sum.quantityChange ?? 0,
      transactionCount: m._count,
    }))
  }

  async dailySalesTrend(channelId: string, startDate: string, endDate: string) {
    const start = parseDate(startDate)
    const end   = parseDate(endDate, true)

    return prisma.$queryRaw<Array<{ date: string; totalSales: number; saleCount: number; profit: number }>>`
      WITH daily_sales AS (
        SELECT
          DATE("createdAt") AS date,
          COALESCE(SUM("netAmount"), 0) AS "totalSales",
          COUNT(*)::int AS "saleCount"
        FROM sales
        WHERE "channelId" = ${channelId}
          AND "deletedAt" IS NULL
          AND "createdAt" >= ${start}
          AND "createdAt" <= ${end}
        GROUP BY DATE("createdAt")
      ),
      daily_cogs AS (
        SELECT
          DATE(s."createdAt") AS date,
          COALESCE(SUM(si."costPriceSnapshot" * si.quantity), 0) AS cogs
        FROM sale_items si
        JOIN sales s ON s.id = si."saleId"
        WHERE s."channelId" = ${channelId}
          AND s."deletedAt" IS NULL
          AND s."createdAt" >= ${start}
          AND s."createdAt" <= ${end}
        GROUP BY DATE(s."createdAt")
      )
      SELECT
        ds.date,
        ds."totalSales",
        ds."saleCount",
        (ds."totalSales" - COALESCE(dc.cogs, 0)) AS profit
      FROM daily_sales ds
      LEFT JOIN daily_cogs dc ON ds.date = dc.date
      ORDER BY ds.date
    `
  }

  async adminDashboardAnalytics(startDate: string, endDate: string, enterpriseId?: string | null) {
    const start = parseDate(startDate)
    const end   = parseDate(endDate, true)

    const channels = await prisma.channel.findMany({
      where:  {
        deletedAt: null,
        ...(enterpriseId ? { enterpriseId } : {}),
      },
      select: { id: true, name: true, code: true },
    })

    const channelIds = channels.map(c => c.id)
    if (channelIds.length === 0) {
      return {
        period:          { startDate, endDate },
        aggregateRevenue: 0,
        aggregateMargin:  0,
        totalSalesCount:  0,
        channelStats:     [],
      }
    }

    const totalSales = await prisma.sale.aggregate({
      where:  { channelId: { in: channelIds }, createdAt: { gte: start, lte: end }, deletedAt: null },
      _sum:   { netAmount: true },
      _count: true,
    })

    // FIX 2: Single COGS aggregation scoped to channels in this enterprise
    const cogsPerChannel = await prisma.$queryRaw<
      Array<{ channelId: string; cogs: number }>
    >`
      SELECT s."channelId",
             COALESCE(SUM(si."costPriceSnapshot" * si.quantity), 0) AS cogs
      FROM   sale_items si
      JOIN   sales s ON s.id = si."saleId"
      WHERE  s."channelId" = ANY(${channelIds})
        AND  s."createdAt" >= ${start}
        AND  s."createdAt" <= ${end}
        AND  s."deletedAt"  IS NULL
      GROUP BY s."channelId"
    `
    const cogsMap = Object.fromEntries(cogsPerChannel.map(r => [r.channelId, Number(r.cogs)]))

    const salesPerChannel = await prisma.sale.groupBy({
      by:    ['channelId'],
      where: { channelId: { in: channelIds }, createdAt: { gte: start, lte: end }, deletedAt: null },
      _sum:  { netAmount: true },
      _count: true,
    })
    const salesMap = Object.fromEntries(
      salesPerChannel.map(r => [r.channelId, { count: r._count, net: Number(r._sum.netAmount ?? 0) }])
    )

    const channelStats = channels.map(c => {
      const s        = salesMap[c.id]  ?? { count: 0, net: 0 }
      const cogs     = cogsMap[c.id]   ?? 0
      const netSales = s.net
      return {
        channelId:   c.id,
        channelName: c.name,
        salesCount:  s.count,
        revenue:     netSales,
        margin:      netSales - cogs,
      }
    })

    return {
      period:          { startDate, endDate },
      aggregateRevenue: channelStats.reduce((sum, c) => sum + c.revenue, 0),
      aggregateMargin:  channelStats.reduce((sum, c) => sum + c.margin,  0),
      totalSalesCount:  totalSales._count ?? 0,
      channelStats,
    }
  }

  async staffSalesPerformance(channelId: string, startDate: string, endDate: string) {
    const start = parseDate(startDate)
    const end   = parseDate(endDate, true)

    const revenueStats = await prisma.sale.groupBy({
      by:    ['performedBy'],
      where: { channelId, createdAt: { gte: start, lte: end }, deletedAt: null },
      _sum:  { netAmount: true },
      _count: true,
    })

    // FIX 3 + 4: Compute COGS per staff in the DB — no unbounded row fetch
    const cogsRaw = await prisma.$queryRaw<
      Array<{ performedBy: string; cogs: number }>
    >`
      SELECT s."performedBy",
             COALESCE(SUM(si."costPriceSnapshot" * si.quantity), 0) AS cogs
      FROM   sale_items si
      JOIN   sales s ON s.id = si."saleId"
      WHERE  s."channelId" = ${channelId}
        AND  s."createdAt"  >= ${start}
        AND  s."createdAt"  <= ${end}
        AND  s."deletedAt"  IS NULL
      GROUP BY s."performedBy"
    `
    const cogsMap = Object.fromEntries(cogsRaw.map(r => [r.performedBy, Number(r.cogs)]))

    const performance = revenueStats.map(stat => {
      const revenue       = Number(stat._sum.netAmount ?? 0)
      const cogs          = cogsMap[stat.performedBy]  ?? 0
      const margin        = revenue - cogs
      const marginPercent = revenue > 0 ? (margin / revenue) * 100 : 0

      return {
        userId:        stat.performedBy,
        revenue,
        salesCount:    stat._count,
        margin,
        marginPercent: Math.round(marginPercent * 100) / 100,
      }
    })

    return { period: { startDate, endDate }, performance }
  }

  async salesForecast(channelId: string) {
    const today = new Date()
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(today.getDate() - 30)

    const trends = await this.dailySalesTrend(channelId, thirtyDaysAgo.toISOString().split('T')[0]!, today.toISOString().split('T')[0]!)
    
    // Simple linear regression to predict next 7 days
    if (trends.length < 3) return { forecast: [], status: 'INSUFFICIENT_DATA' }

    const x = trends.map((_, i) => i)
    const y = trends.map(t => Number(t.totalSales || 0))

    const n = x.length
    const sumX = x.reduce((a, b) => a + b, 0)
    const sumY = y.reduce((a, b) => a + b, 0)
    
    let sumXY = 0
    let sumX2 = 0
    for (let i = 0; i < n; i++) {
      sumXY += x[i]! * (y[i] ?? 0)
      sumX2 += x[i]! * x[i]!
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
    const intercept = (sumY - slope * sumX) / n

    const forecast = []
    for (let i = 1; i <= 7; i++) {
      const nextX = n + i - 1
      const predictedValue = Math.max(0, slope * nextX + intercept)
      const date = new Date()
      date.setDate(today.getDate() + i)
      forecast.push({
        date: date.toISOString().split('T')[0],
        predictedRevenue: Math.round(predictedValue * 100) / 100
      })
    }

    return { 
      history: trends,
      forecast, 
      confidence: trends.length > 20 ? 'HIGH' : 'MEDIUM',
      status: 'SUCCESS'
    }
  }

  async agingAnalysis(channelId: string) {
    const today = new Date()
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(today.getDate() - 30)
    const sixtyDaysAgo = new Date()
    sixtyDaysAgo.setDate(today.getDate() - 60)

    const sales = await prisma.sale.findMany({
      where: {
        channelId,
        saleType: 'CREDIT',
        deletedAt: null,
      },
      include: {
        customer: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    const bucketing = {
      p1: { label: '0-30 Days', amount: 0, customers: new Set<string>() },
      p2: { label: '31-60 Days', amount: 0, customers: new Set<string>() },
      p3: { label: '61+ Days', amount: 0, customers: new Set<string>() },
    }

    // FIX: repayments are a lump-sum reduction of Customer.outstandingCredit
    // (credit.service.ts recordRepayment) — never allocated to a specific
    // sale, since a credit sale's own Payment row (method: 'CREDIT') is
    // created once at commit and never touched again. Summing that row
    // always produced balance === netAmount, so every repayment ever made
    // was silently ignored here, permanently overstating this report.
    // outstandingCredit is the one number that reflects repayments; we
    // allocate it across each customer's credit sales oldest-first
    // (standard FIFO aging convention) so the bucketed total always
    // reconciles exactly to what's really still owed.
    const salesByCustomer = new Map<string, typeof sales>()
    for (const sale of sales) {
      if (!sale.customerId) continue
      const list = salesByCustomer.get(sale.customerId) ?? []
      list.push(sale)
      salesByCustomer.set(sale.customerId, list)
    }

    for (const customerSales of salesByCustomer.values()) {
      const customer = customerSales[0]!.customer
      if (!customer) continue

      const totalOriginal = customerSales.reduce((sum, s) => sum + Number(s.netAmount), 0)
      let repaidPool = Math.max(0, totalOriginal - Number(customer.outstandingCredit))

      for (const sale of customerSales) {
        const saleAmount = Number(sale.netAmount)
        const payoff = Math.min(saleAmount, repaidPool)
        repaidPool -= payoff
        const balance = saleAmount - payoff
        if (balance <= 0) continue

        const diffDays = Math.ceil((today.getTime() - sale.createdAt.getTime()) / (1000 * 60 * 60 * 24))

        if (diffDays <= 30) {
          bucketing.p1.amount += balance
          bucketing.p1.customers.add(customer.name)
        } else if (diffDays <= 60) {
          bucketing.p2.amount += balance
          bucketing.p2.customers.add(customer.name)
        } else {
          bucketing.p3.amount += balance
          bucketing.p3.customers.add(customer.name)
        }
      }
    }

    return {
      buckets: [
        { ...bucketing.p1, customers: Array.from(bucketing.p1.customers) },
        { ...bucketing.p2, customers: Array.from(bucketing.p2.customers) },
        { ...bucketing.p3, customers: Array.from(bucketing.p3.customers) }
      ],
      totalOutstanding: bucketing.p1.amount + bucketing.p2.amount + bucketing.p3.amount
    }
  }

  async salesPerformance(channelId: string) {
    // Audit finding: Markup Visibility / Today's Profit
    const today = new Date()
    today.setHours(0,0,0,0)
    
    // We pass today's date both as start and end (summary handles end-of-day)
    const summary = await this.salesSummary(channelId, today.toISOString(), today.toISOString())
    return {
      todayProfit: summary.profit,
      todayRevenue: summary.sales.netAmount,
      todayMargin: summary.sales.netAmount > 0 ? (summary.profit / summary.sales.netAmount) * 100 : 0,
      verified: summary.marginStatus === 'VERIFIED'
    }
  }

  async dayOfWeekTrends(channelId: string) {
    // Audit finding: DOW Analysis (Busiest Days)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const sales = await prisma.$queryRaw<Array<{ dow: number; totalRevenue: number; saleCount: number }>>`
      SELECT 
        EXTRACT(DOW FROM "createdAt") as dow,
        SUM("netAmount") as "totalRevenue",
        COUNT(*)::int as "saleCount"
      FROM sales
      WHERE "channelId" = ${channelId}
        AND "createdAt" >= ${thirtyDaysAgo}
        AND "deletedAt" IS NULL
      GROUP BY dow
      ORDER BY dow
    `

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    return sales.map(s => ({
      day: days[Number(s.dow)],
      revenue: Number(s.totalRevenue),
      count: s.saleCount
    }))
  }

  async getForensicMarginAudit(channelId: string, startDate: string, endDate: string) {
    const start = parseDate(startDate)
    const end   = parseDate(endDate, true)

    // Audit finding: The "Loss-Leader" Audit Report
    return prisma.$queryRaw<any[]>`
      SELECT 
        s.id,
        s."receiptNo",
        s."createdAt",
        s."saleType",
        s."netAmount",
        s."totalAmount",
        s."discountAmount",
        s.notes,
        u.username as "performedBy",
        COALESCE(SUM(si."costPriceSnapshot" * si.quantity), 0) as "totalCost",
        (s."netAmount" - COALESCE(SUM(si."costPriceSnapshot" * si.quantity), 0)) as "margin"
      FROM sales s
      LEFT JOIN users u ON u.id::text = s."performedBy"
      JOIN sale_items si ON s.id = si."saleId"
      WHERE s."channelId" = ${channelId}
        AND s."createdAt" >= ${start}
        AND s."createdAt" <= ${end}
        AND s."deletedAt" IS NULL
      GROUP BY s.id, s."receiptNo", s."createdAt", s."saleType", s."netAmount", s."totalAmount", s."discountAmount", s.notes, u.username
      HAVING (s."netAmount" - COALESCE(SUM(si."costPriceSnapshot" * si.quantity), 0)) < 0
      ORDER BY s."createdAt" DESC
    `
  }
}

export const reportsService = new ReportsService()
