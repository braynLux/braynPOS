import { prisma }           from '../../lib/prisma.js'
import { settingsService }  from '../dashboard/settings.service.js'
import { commissionLogger } from '../../lib/logger.js'
import { Prisma }           from '@prisma/client'
import type { TransactionClient } from '../../lib/prisma.js'
import type { TokenPayload }      from '../../lib/jwt.js'

export interface CommissionSummary {
  saleId:           string
  userId:           string
  grossMargin:      number
  marginPercent:    number
  commissionAmount: number
  rateApplied:      number
  ruleId:           string | null
}

export interface PayoutResult {
  payoutId:        string
  userId:          string
  totalCommission: number
  entryCount:      number
  periodStart:     Date
  periodEnd:     Date
}

// ── Rule Resolution ───────────────────────────────────────────────────
async function resolveRule(userId: string, channelId: string, saleType: string) {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { role: true },
  })

  if (!user) {
    commissionLogger.warn({ userId }, 'rule resolution failed — user record missing')
    return null
  }

  // FIX: Was fetching ALL active rules with no channel filter — on a
  // multi-channel deployment this loads every rule for every channel into
  // memory on every sale commit. Beyond the performance cost, it bypasses
  // the multi-tenant extension's channel isolation for this query.
  // Now filters at the DB level to only channel-specific + global rules.
  const rules = await prisma.commissionRule.findMany({
    where: {
      isActive: true,
      OR: [
        { channelId },        // rules specific to this channel
        { channelId: null },  // global rules (apply to all channels)
      ],
    },
    orderBy: { createdAt: 'asc' },
  })

  commissionLogger.info(
    { rulesCount: rules.length, userId, role: user.role, channelId },
    'resolveRule check'
  )

  if (rules.length === 0) return null

  const applicable = rules.filter(
    r => r.appliesTo.length === 0 || r.appliesTo.includes(saleType as any)
  )

  // Priority: user-specific > role > channel > global
  const rule = (
    applicable.find(r => r.userId    === userId)      ??
    applicable.find(r => r.role      === user.role)   ??
    applicable.find(r => r.channelId === channelId && !r.userId && !r.role) ??
    applicable.find(r => !r.channelId && !r.userId && !r.role) ??
    null
  )

  if (!rule) {
    commissionLogger.warn({
      userId, role: user.role, channelId, saleType,
      applicableCount: applicable.length,
    }, 'no rule found after search')
  }

  return rule
}

// ── Calculate Commission for a Sale ──────────────────────────────────
export async function calculateCommission(saleId: string, tx?: any): Promise<CommissionSummary | null> {
  const db = tx || prisma
  const sale = await db.sale.findUnique({
    where:   { id: saleId },
    include: { items: true },
  })

  if (!sale) {
    commissionLogger.warn({ saleId }, 'commission calc skipped — sale not found')
    return null
  }

  const settings = await settingsService.getAll(sale.channelId)
  // FIX: settingsService.getAll() only returns keys that have a Setting row —
  // on a fresh deployment (nothing seeds 'payrollSettings') this key is
  // simply absent, not {}. Every unguarded payrollSettings.<field> read below
  // then throws, and since no CommissionRule is seeded by default either,
  // this path is hit on literally every sale until an admin configures
  // payroll settings — silently killing commission calculation each time
  // (caught by the sale.committed listener's try/catch, so sales still
  // succeed, but no commission is ever recorded).
  const payrollSettings = (settings.payrollSettings as any) ?? {}
  if (payrollSettings?.commissionsEnabled === false) {
    commissionLogger.info({ saleId, channelId: sale.channelId }, 'commission calc skipped — disabled in settings')
    return null
  }

  let grossMargin = 0
  for (const item of sale.items) {
    const cost = Number(item.costPriceSnapshot)
    if (cost <= 0) {
      commissionLogger.warn({
        saleId, itemId: item.itemId, userId: sale.performedBy
      }, 'commission skipped — one or more items have zero/missing cost price')
      return null // Hard-block commission for the entire sale if any cost is missing
    }
    grossMargin += (Number(item.unitPrice) - cost) * item.quantity
  }
  // FIX: line discounts were subtracted twice. Sale.discountAmount is stored by
  // commitSaleOnce as `saleDiscount + totalLineDiscount` — it already contains
  // every line's discount — but the loop above also subtracted each
  // SaleItem.discountAmount before this ran. Margin came out short by the whole
  // line-discount total, so commission was underpaid, and a discounted sale
  // could be pushed under minMarginPercent, or to a margin of zero or less,
  // and have its commission refused outright.
  grossMargin -= Number(sale.discountAmount ?? 0)

  if (grossMargin <= 0) {
    commissionLogger.info({ saleId, grossMargin, userId: sale.performedBy }, 'commission skipped — no positive margin')
    return null
  }

  const totalAmount   = Number(sale.totalAmount)
  const marginPercent = totalAmount > 0 ? (grossMargin / totalAmount) * 100 : 0

  const rule = await resolveRule(sale.performedBy, sale.channelId, sale.saleType)

  const minMargin = rule?.minMarginPercent 
    ? Number(rule.minMarginPercent) 
    : Number(payrollSettings.minMarginPercent ?? 0)

  if (marginPercent < minMargin) {
    commissionLogger.info({
      saleId, userId: sale.performedBy, marginPercent: Number(marginPercent.toFixed(2)), minMargin, ruleId: rule?.id,
    }, 'commission skipped — margin below minimum threshold')
    return null
  }
  // ── 3. Determine Rate ──────────────────────────────────────────────
  let rateApplied = 0
  if (rule) {
    rateApplied = Number(rule.ratePercent)
  } else {
    // Fallback: Check specialized defaults from settings
    const userRole = (await db.user.findUnique({
      where:  { id: sale.performedBy },
      select: { role: true },
    }))?.role

    if (userRole === 'PROMOTER') {
      rateApplied = Number(payrollSettings.promoterDefaultRate ?? 15)
    } else if (sale.saleType === 'WHOLESALE') {
      rateApplied = Number(payrollSettings.wholesaleDefaultRate ?? 8)
    } else {
      rateApplied = Number(payrollSettings.defaultRate ?? 12)
    }
  }

  const commissionAmount = (grossMargin * rateApplied) / 100

  await db.commissionEntry.upsert({
    where:  { saleId },
    create: {
      saleId,
      userId:           sale.performedBy,
      channelId:        sale.channelId,
      ruleId:           rule?.id ?? null,
      grossMargin:      new Prisma.Decimal(grossMargin.toFixed(4)),
      marginPercent:    new Prisma.Decimal(marginPercent.toFixed(4)),
      commissionAmount: new Prisma.Decimal(commissionAmount.toFixed(4)),
      rateApplied:      new Prisma.Decimal(rateApplied.toFixed(4)),
      status:           'PENDING',
    },
    update: {
      grossMargin:      new Prisma.Decimal(grossMargin.toFixed(4)),
      marginPercent:    new Prisma.Decimal(marginPercent.toFixed(4)),
      commissionAmount: new Prisma.Decimal(commissionAmount.toFixed(4)),
      rateApplied:      new Prisma.Decimal(rateApplied.toFixed(4)),
    },
  })

  commissionLogger.info({
    saleId, userId: sale.performedBy, channelId: sale.channelId,
    grossMargin: Number(grossMargin.toFixed(2)),
    commissionAmount: Number(commissionAmount.toFixed(2)),
    rateApplied, ruleId: rule?.id ?? null,
  }, 'commission entry recorded')

  return { 
    saleId, 
    userId:           sale.performedBy, 
    grossMargin, 
    marginPercent, 
    commissionAmount, 
    rateApplied, 
    ruleId: rule?.id ?? null 
  }
}

// ── Void Commission ───────────────────────────────────────────────────
export async function voidCommission(saleId: string): Promise<void> {
  const result = await prisma.commissionEntry.updateMany({
    where: { saleId, status: { in: ['PENDING', 'APPROVED'] } },
    data:  { status: 'VOIDED' },
  })
  commissionLogger.info({ saleId, entriesVoided: result.count }, 'commission entries voided')
}

// ── Build Payout ──────────────────────────────────────────────────────
// FIX: tx parameter now properly typed as TransactionClient instead of any.
// This ensures callers pass a valid Prisma transaction client and all
// tx.model.operation() calls inside are fully type-checked.
export async function buildCommissionPayout(
  userId:      string,
  periodStart: Date,
  periodEnd:   Date,
  channelId?:  string,
  tx?:         TransactionClient
): Promise<PayoutResult | null> {
  const db = tx || prisma

  const entries = await db.commissionEntry.findMany({
    where: {
      userId,
      status:    'APPROVED',
      payoutId:  null,
      createdAt: { gte: periodStart, lte: periodEnd },
      ...(channelId ? { channelId } : {}),
    },
  })

  if (entries.length === 0) {
    commissionLogger.info({ userId, periodStart, periodEnd, channelId }, 'payout skipped — no approved entries')
    return null
  }

  const totalCommission = entries.reduce((sum: number, e: any) => sum + Number(e.commissionAmount), 0)

  const execute = async (client: any) => {
    const created = await client.commissionPayout.create({
      data: {
        userId,
        channelId:       channelId ?? null,
        periodStart,
        periodEnd,
        totalCommission: new Prisma.Decimal(totalCommission.toFixed(4)),
        entryCount:      entries.length,
        status:          'APPROVED',
      },
    })

    await client.commissionEntry.updateMany({
      where: { id: { in: entries.map((e: any) => e.id) } },
      data:  { status: 'PAID', payoutId: created.id },
    })

    return created
  }

  const payout = tx ? await execute(tx) : await prisma.$transaction(execute)

  commissionLogger.info({
    payoutId:        payout.id,
    userId,
    channelId,
    totalCommission: Number(totalCommission.toFixed(2)),
    entryCount:      entries.length,
  }, 'commission payout created')

  return { payoutId: payout.id, userId, totalCommission, entryCount: entries.length, periodStart, periodEnd }
}

// ── Summary Queries ───────────────────────────────────────────────────
export async function getCommissionSummary(
  query: {
    userId?: string; channelId?: string; status?: string
    startDate?: string; endDate?: string; page?: number; limit?: number
  },
  actor: TokenPayload
) {
  const page  = query.page  ?? 1
  const limit = Math.min(query.limit ?? 25, 100)
  const skip  = (page - 1) * limit

  const where: Prisma.CommissionEntryWhereInput = {
    ...(query.status    && { status:    query.status as any }),
    ...(query.userId    && { userId:    query.userId }),
    ...(query.channelId && { channelId: query.channelId }),
    ...(query.startDate || query.endDate ? {
      createdAt: {
        ...(query.startDate && { gte: new Date(query.startDate) }),
        ...(query.endDate   && { lte: new Date(query.endDate) }),
      },
    } : {}),
  }

  // Non-managers can only see their own commission entries
  if (!['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER'].includes(actor.role)) {
    where.userId = actor.sub   // FIX: was actor.id — should be actor.sub
  }

  const [data, total] = await Promise.all([
    prisma.commissionEntry.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.commissionEntry.count({ where }),
  ])

  const saleIds = data.map(e => e.saleId)
  const sales   = await prisma.sale.findMany({
    where:  { id: { in: saleIds } },
    select: { id: true, receiptNo: true, createdAt: true, netAmount: true },
  })
  const saleMap = Object.fromEntries(sales.map(s => [s.id, s]))

  return {
    data: data.map(entry => ({ ...entry, sale: saleMap[entry.saleId] ?? null })),
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  }
}

export async function getCommissionStats(
  channelId?: string, userId?: string, startDate?: string, endDate?: string
) {
  const where: Prisma.CommissionEntryWhereInput = {
    ...(channelId && { channelId }),
    ...(userId    && { userId }),
    ...(startDate || endDate ? {
      createdAt: {
        ...(startDate && { gte: new Date(startDate) }),
        ...(endDate   && { lte: new Date(endDate) }),
      },
    } : {}),
  }

  const [pending, approved, paid, voided, totals] = await Promise.all([
    prisma.commissionEntry.count({ where: { ...where, status: 'PENDING'  } }),
    prisma.commissionEntry.count({ where: { ...where, status: 'APPROVED' } }),
    prisma.commissionEntry.count({ where: { ...where, status: 'PAID'     } }),
    prisma.commissionEntry.count({ where: { ...where, status: 'VOIDED'   } }),
    prisma.commissionEntry.aggregate({
      where,
      _sum: { commissionAmount: true, grossMargin: true },
      _avg: { marginPercent: true, rateApplied: true },
    }),
  ])

  return {
    counts: { pending, approved, paid, voided },
    totals: {
      totalCommission:  Number(totals._sum.commissionAmount ?? 0),
      totalMargin:      Number(totals._sum.grossMargin ?? 0),
      avgMarginPercent: Number(totals._avg.marginPercent ?? 0),
      avgRate:          Number(totals._avg.rateApplied ?? 0),
    },
  }
}
