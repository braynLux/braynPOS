import { prisma } from '../../lib/prisma.js'
import { Prisma } from '@prisma/client'
import { eventBus } from '../../lib/event-bus.js'
import { buildSaleJournalEntry, buildCreditNoteJournalEntry } from '../../lib/ledger.js'
import { hasRole } from '../../middleware/authorize.js'
import { 
  checkIdempotency, 
  storeIdempotencyResult, 
  acquireIdempotencyLock, 
  releaseIdempotencyLock 
} from '../../lib/idempotency.js'
import { validateApprovalToken } from '../auth/manager-approve.routes.js'
import { logAction, AUDIT } from '../../lib/audit.js'
import type { TokenPayload } from '../../lib/jwt.js'
import { verifyPassword } from '../../lib/password.js'
import { randomBytes } from 'crypto'

const inFlightCommits = new Map<string, number>()
const IN_FLIGHT_TTL_MS = 10_000

async function generateReceiptNo(
  channelId: string,
  tx: Prisma.TransactionClient
): Promise<string> {
  if (!channelId) {
    return `RCP-GEN-${Date.now()}-${randomBytes(2).toString('hex')}`
  }
  const now     = new Date()
  const eatDate = new Date(now.getTime() + 3 * 60 * 60 * 1000)
  const dateStr = eatDate.toISOString().slice(0, 10).replace(/-/g, '')
  const suffix  = randomBytes(2).toString('hex')

  try {
    const seqKey = `sales_${channelId}_${dateStr}`
    await tx.$executeRaw`
      INSERT INTO receipt_sequences (seq_key, last_seq)
      VALUES (${seqKey}::text, 0)
      ON CONFLICT (seq_key) DO NOTHING
    `
    const rows = await tx.$queryRaw<Array<{ last_seq: number }>>`
      UPDATE receipt_sequences
      SET    last_seq = last_seq + 1
      WHERE  seq_key  = ${seqKey}::text
      RETURNING last_seq
    `
    if (rows && rows.length > 0) {
      const seq = String(rows[0]?.last_seq || 0).padStart(4, '0')
      return `RCP-${dateStr}-${seq}-${suffix}`
    }
  } catch { }
  const ts = process.hrtime.bigint().toString().slice(-8)
  return `RCP-${dateStr}-${ts}-${suffix}`
}

async function commitSaleOnce(
  input:     CommitSaleInput,
  actor:     TokenPayload,
  receiptNo: string,
  options?:  { 
    skipStockCheck?: boolean; 
    offlineReceiptNo?: string; 
    approvalToken?: string;
    deviceDate?: string;
  }
) {
  return prisma.$transaction(async (tx) => {
    if (!input.channelId) {
      throw { statusCode: 400, message: 'channelId is required for sale commit' }
    }

    if (input.customerId) {
      const customer = await tx.customer.findUnique({
        where:  { id: input.customerId },
        select: { channelId: true },
      })
      if (!customer) {
        throw { statusCode: 404, message: 'Customer not found' }
      }
      if (customer.channelId && customer.channelId !== input.channelId) {
        throw { statusCode: 403, message: 'Customer does not belong to the sale channel' }
      }
    }

    if (input.sessionId) {
      const session = await tx.salesSession.findUnique({
        where:  { id: input.sessionId },
        select: { channelId: true, status: true },
      })
      if (!session) {
        throw { statusCode: 404, message: 'Sales session not found' }
      }
      if (session.channelId !== input.channelId) {
        throw { statusCode: 403, message: 'Sales session does not belong to the sale channel' }
      }
      if (session.status !== 'OPEN') {
        throw { statusCode: 400, message: 'Sales session is not open' }
      }
    }

    const itemIds       = [...new Set(input.items.map(l => l.itemId))]
    const sortedItemIds = itemIds.sort()
    const requestedQtyByItem = input.items.reduce((map, line) => {
      map.set(line.itemId, (map.get(line.itemId) ?? 0) + line.quantity)
      return map
    }, new Map<string, number>())
    await tx.$executeRaw`SET LOCAL lock_timeout = '3000ms'`

    const lockedBalances = await tx.$queryRaw<
      Array<{ itemId: string; availableQty: number }>
    >`
      SELECT "itemId", "availableQty"
      FROM   inventory_balances
      WHERE  "itemId"    = ANY(${sortedItemIds}::text[])
        AND  "channelId" = ${input.channelId}::text
      ORDER BY "itemId"
      FOR UPDATE
    `
    const stockMap = Object.fromEntries(
      lockedBalances.map(r => [r.itemId, r.availableQty])
    )

    // FIX: sale-level VAT was never computed — Item.taxClass, the Tax Payable
    // ledger account, and buildSaleJournalEntry's tax-splitting logic all
    // already existed for exactly this, and the Settings UI already lets an
    // admin configure it (key 'taxSettings': vatEnabled/vatRate/inclusivePricing)
    // — but nothing here ever read it, so taxAmount was hardcoded to 0.
    // Tax-inclusive pricing only (the default, and the Kenyan retail-display
    // norm): the price charged never changes, so this is a pure ledger-side
    // split with zero risk to payment validation or receipts. Tax-exclusive
    // pricing would need the price charged to increase by the tax amount,
    // which requires POS-terminal changes (fetching tax settings client-side,
    // adding tax to the collected total) beyond this fix's scope — that
    // configuration intentionally still computes 0 tax, same as before.
    const taxSettingRows = await tx.setting.findMany({
      where: { key: 'taxSettings', OR: [{ channelId: null }, { channelId: input.channelId }] },
    })
    const globalTaxSetting  = taxSettingRows.find(s => s.channelId === null)?.value as any
    const channelTaxSetting = taxSettingRows.find(s => s.channelId === input.channelId)?.value as any
    const taxSettings = { vatEnabled: false, vatRate: 16, inclusivePricing: true, ...(globalTaxSetting || {}), ...(channelTaxSetting || {}) }

    let totalCost     = 0
    let totalAmount   = 0
    let totalLineDiscount = 0
    let vatableNet    = 0
    const itemDetails: Record<string, any> = {}

    for (const line of input.items) {
      const item = await tx.item.findUniqueOrThrow({ where: { id: line.itemId } })
      const balance = await (tx as any).inventoryBalance.findUnique({
        where:  { itemId_channelId: { itemId: line.itemId, channelId: input.channelId } },
        select: { weightedAvgCost: true },
      })
      const effectiveCost = Number(balance?.weightedAvgCost ?? item.weightedAvgCost ?? 0)
      itemDetails[line.itemId] = { ...item, effectiveCost }

      const currentQty   = stockMap[line.itemId] ?? 0
      const requestedQty = requestedQtyByItem.get(line.itemId) ?? line.quantity
      const isProduct = itemDetails[line.itemId].type === 'PRODUCT'

      if (!options?.skipStockCheck && isProduct && currentQty < requestedQty) {
        throw { statusCode: 422, message: `Insufficient stock for ${item.name}. Requested: ${requestedQty}, available: ${currentQty}` }
      }

      if (Number(line.unitPrice) < Number(item.minRetailPrice)) {
        if (!hasRole(actor, 'MANAGER')) {
          if (!options?.approvalToken) {
            throw { statusCode: 403, message: `Price below minimum for ${item.name} requires manager approval` }
          }
          const approval = await validateApprovalToken(options.approvalToken, 'price_below_min', line.itemId)
          if (!approval) throw { statusCode: 403, message: `Invalid or expired approval token for ${item.name}` }
        }
        logAction({
          action:     AUDIT.PRICE_BELOW_MIN,
          actorId:    actor.sub,
          actorRole:  actor.role,
          channelId:  input.channelId,
          targetType: 'Item',
          targetId:   line.itemId,
          oldValues:  { minRetailPrice: item.minRetailPrice },
          })
      }

      // ── Audit Finding: Margin Guard (Prevent Sales Below Cost) ──
      const margin = Number(line.unitPrice) - effectiveCost
      const marginPercent = effectiveCost > 0 ? (margin / effectiveCost) * 100 : 0

      if (margin < 0) {
        // Fetch setting directly for transactional integrity
        const setting = await tx.setting.findUnique({
          where: { key_channelId: { key: 'PREVENT_SALES_BELOW_COST', channelId: input.channelId } }
        })
        const isEnforced = setting?.value === true

        if (isEnforced) {
          if (!options?.approvalToken) {
            throw { 
              statusCode: 403, 
              code: 'NEGATIVE_MARGIN_REQUIRED',
              message: `Sale of ${item.name} at a loss (${marginPercent.toFixed(1)}%) requires manager authorization`,
              data: { marginPercent, itemName: item.name, itemId: item.id }
            }
          }
          const approval = await validateApprovalToken(options.approvalToken, 'negative_margin', line.itemId, input.channelId)
          if (!approval) {
            throw { statusCode: 403, message: `Invalid or expired authorization for negative margin on ${item.name}` }
          }
        }
      }

      const lineTotal     = line.quantity * Number(line.unitPrice)
      const lineDiscount  = line.discountAmount ?? 0
      if (lineDiscount > lineTotal) {
        throw { statusCode: 422, message: `Discount for ${item.name} cannot exceed the line total` }
      }
      totalAmount       += lineTotal
      totalLineDiscount += lineDiscount
      totalCost         += effectiveCost * line.quantity
      if (item.taxClass === 'STANDARD') {
        vatableNet += (lineTotal - lineDiscount)
      }
    }

    const saleDiscount  = input.discountAmount ?? 0
    const totalDiscount = saleDiscount + totalLineDiscount
    const netAmount      = totalAmount - totalDiscount
    if (netAmount < 0) {
      throw { statusCode: 422, message: 'Discount cannot exceed the sale total' }
    }

    // Prorate the overall (non-per-line) discount across the vatable base
    // before splitting out tax, so a blanket discount doesn't overstate tax.
    const netBeforeSaleDiscount = totalAmount - totalLineDiscount
    const vatableShare = netBeforeSaleDiscount > 0 ? vatableNet / netBeforeSaleDiscount : 0
    const vatableNetFinal = Math.max(0, vatableNet - saleDiscount * vatableShare)

    let taxAmount = 0
    if (taxSettings.vatEnabled && taxSettings.inclusivePricing !== false) {
      const vatRate = Number(taxSettings.vatRate ?? 16)
      taxAmount = vatableNetFinal - (vatableNetFinal / (1 + vatRate / 100))
    }

    const paymentTotal = input.payments.reduce((sum, pmt) => sum + Number(pmt.amount), 0)
    if (Math.abs(paymentTotal - netAmount) > 0.0001) {
      throw {
        statusCode: 422,
        message: `Payment total (${paymentTotal.toFixed(2)}) must match sale net amount (${netAmount.toFixed(2)})`,
      }
    }

    const newSale = await tx.sale.create({
      data: {
        receiptNo,
        channelId:        input.channelId,
        sessionId:        input.sessionId,
        customerId:       input.customerId ?? null,
        saleType:         input.saleType as any,
        totalAmount:      new Prisma.Decimal(totalAmount.toFixed(4)),
        discountAmount:   new Prisma.Decimal(totalDiscount.toFixed(4)),
        taxAmount:        new Prisma.Decimal(taxAmount.toFixed(4)),
        netAmount:        new Prisma.Decimal(netAmount.toFixed(4)),
        performedBy:      actor.sub,
        offlineReceiptNo: options?.offlineReceiptNo ?? null,
        notes:            input.notes ?? null,
        deviceDate:       options?.deviceDate ? new Date(options.deviceDate) : null,
        dueDate:          input.dueDate ? new Date(input.dueDate) : null,
      },
    })

    await Promise.all([
      tx.saleItem.createMany({
        data: input.items.map(line => {
          const item = itemDetails[line.itemId]
          return {
            saleId:                 newSale.id,
            itemId:                 line.itemId,
            serialId:               line.serialId ?? null,
            quantity:               line.quantity,
            unitPrice:              new Prisma.Decimal(Number(line.unitPrice).toFixed(4)),
            minRetailPriceSnapshot: item.minRetailPrice,
            costPriceSnapshot:      new Prisma.Decimal(item.effectiveCost.toFixed(4)),
            markup:                 new Prisma.Decimal((Number(line.unitPrice) - item.effectiveCost).toFixed(4)),
            lineTotal:              new Prisma.Decimal((line.quantity * Number(line.unitPrice)).toFixed(4)),
            discountAmount:         new Prisma.Decimal((line.discountAmount ?? 0).toFixed(4)),
          }
        }),
      }),
      tx.stockMovement.createMany({
        data: input.items
          .filter(line => itemDetails[line.itemId].type === 'PRODUCT')
          .map(line => ({
            itemId:         line.itemId,
            channelId:      input.channelId,
            movementType:   'SALE',
            quantityChange: -(line.quantity),
            referenceId:    newSale.id,
            referenceType:  'sale',
            unitCostAtTime: itemDetails[line.itemId].effectiveCost,
            performedBy:    actor.sub,
          })),
      }),
      ...input.items
        .filter(line => itemDetails[line.itemId].type === 'PRODUCT')
        .map(line =>
          tx.inventoryBalance.update({
            where:  { itemId_channelId: { itemId: line.itemId, channelId: input.channelId } },
            data:   { availableQty: { decrement: line.quantity } }
          })
        )
    ])

    await tx.payment.createMany({
      data: input.payments.map(pmt => ({
        saleId:    newSale.id,
        method:    pmt.method as any,
        amount:    new Prisma.Decimal(pmt.amount.toFixed(4)),
        reference: pmt.reference ?? null,
      })),
    })

    if (input.saleType === 'CREDIT' && input.customerId) {
      await tx.customer.update({
        where: { id: input.customerId },
        data:  { outstandingCredit: { increment: new Prisma.Decimal(netAmount.toFixed(4)) } },
      })
    }

    // ── LOYALTY INTEGRITY ──
    // FIX: this whole block was gated behind `options?.skipStockCheck`, which
    // is only ever true for offline-sync commits (syncOfflineSale / a
    // conflict's FORCE_SYNC). A customer paying with LOYALTY_POINTS on a
    // normal live sale never had their balance decremented at all — the
    // payment-total check just sums payment amounts regardless of method, so
    // the sale went through as if paid, for free, every time. Voiding such a
    // sale then INCREMENTED points back (reverseSale, unconditional) on top
    // of points that were never actually spent.
    const loyaltyPayment = input.payments.find(p => p.method === 'LOYALTY_POINTS')
    if (loyaltyPayment && input.customerId) {
      const customer = await tx.customer.findUnique({ where: { id: input.customerId } })
      const currentPoints = Number(customer?.loyaltyPoints ?? 0)
      if (currentPoints < loyaltyPayment.amount) {
        if (options?.skipStockCheck) {
          // Offline device already accepted the payment without live
          // validation — can't reject retroactively. Convert the deficit
          // to a debt instead of silently losing the difference.
          const deficit = loyaltyPayment.amount - currentPoints
          await tx.customer.update({
            where: { id: input.customerId },
            data: {
              loyaltyPoints: 0,
              outstandingCredit: { increment: new Prisma.Decimal(deficit.toFixed(4)) }
            }
          })
          // FIX: the stored Payment.amount must reflect the points actually
          // deducted (currentPoints), not the full requested amount — reverseSale
          // increments loyaltyPoints back by Payment.amount, so leaving it at the
          // requested amount over-refunds points on void. The deficit itself is
          // stashed in `reference` so reverseSale can undo the matching credit debt.
          await tx.payment.updateMany({
            where:  { saleId: newSale.id, method: 'LOYALTY_POINTS' },
            data:   { amount: new Prisma.Decimal(currentPoints.toFixed(4)), reference: `LOYALTY_DEFICIT:${deficit.toFixed(4)}` },
          })
          logAction({
            action:    AUDIT.OFFLINE_OVERRIDE,
            actorId:   actor.sub,
            channelId: input.channelId,
            targetType: 'Customer',
            targetId:  input.customerId,
            notes:     `Loyalty deficit of ${deficit} converted to Debt during offline sync.`
          } as any)
        } else {
          // Live sale — reject before committing rather than giving away
          // points the customer doesn't have.
          throw {
            statusCode: 422,
            message: `Insufficient loyalty points. Available: ${currentPoints}, requested: ${loyaltyPayment.amount}`,
          }
        }
      } else {
        await tx.customer.update({
          where: { id: input.customerId },
          data: { loyaltyPoints: { decrement: loyaltyPayment.amount } }
        })
      }
    }

    const isCredit = newSale.saleType === 'CREDIT'
    await buildSaleJournalEntry(tx as any, newSale as any, totalCost, actor.sub, isCredit, input.payments)
    return { sale: newSale, totalCost }
  })
}

export interface CommitSaleInput {
  channelId:       string
  saleType:        string
  customerId:      string | null
  sessionId:       string | null
  items:           { 
    itemId: string; 
    serialId?: string; 
    quantity: number; 
    unitPrice: number; 
    discountAmount: number;
  }[]
  payments:        { method: string; amount: number; reference?: string }[]
  notes?:          string
  discountAmount?: number
  dueDate?:        string | Date | null
}

export async function commitSale(
  input:    CommitSaleInput,
  actor:    TokenPayload,
  options?: { skipStockCheck?: boolean; offlineReceiptNo?: string | null; approvalToken?: string | null; deviceDate?: string | Date | null }
) {
  const MAX_RECEIPT_RETRIES = 5
  for (let attempt = 0; attempt < MAX_RECEIPT_RETRIES; attempt++) {
    let receiptNo: string
    try {
      receiptNo = await prisma.$transaction(async (tx) => generateReceiptNo(input.channelId, tx as any))
    } catch {
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      receiptNo = `RCP-${dateStr}-${process.hrtime.bigint().toString().slice(-8)}`
    }
    try {
      const result = await commitSaleOnce(input, actor, receiptNo, options as any)
      return result.sale
    } catch (err: any) {
      if (err?.code === 'P2002' && attempt < MAX_RECEIPT_RETRIES - 1) continue
      throw err
    }
  }
  throw { statusCode: 500, message: 'Failed to generate a unique receipt number after several attempts' }
}

/**
 * ── QUERIES ──────────────────────────────────────────────────────────
 */
export async function findSales(query: any, actor?: TokenPayload) {
  const page  = query.page  ?? 1
  const limit = Math.min(query.limit ?? 25, 100)
  const skip  = (page - 1) * limit
  const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN'].includes(actor?.role || '')
  if (!isAdmin && !actor?.channelId) {
    throw { statusCode: 400, message: 'Your account has no channel assigned' }
  }

  const where: Prisma.SaleWhereInput = {
    deletedAt: null,
    ...(isAdmin
      ? (query.channelId ? { channelId: query.channelId } : {})
      : { channelId: actor!.channelId! }),
    ...(query.saleType    && { saleType:    query.saleType }),
    ...(query.customerId  && { customerId:  query.customerId }),
    ...(query.sessionId   && { sessionId:   query.sessionId }),
    ...(query.performedBy && { performedBy: query.performedBy }),
    ...(query.paymentMethod && {
      payments: {
        some: {
          method: query.paymentMethod
        }
      }
    }),
    ...(query.startDate || query.endDate ? {
      createdAt: {
        ...(query.startDate && { gte: new Date(`${query.startDate.split('T')[0]}T00:00:00+03:00`) }),
        ...(query.endDate   && { lte: new Date(`${query.endDate.split('T')[0]}T23:59:59+03:00`) }),
      },
    } : {}),
  }

  const [data, total, aggStats] = await Promise.all([
    prisma.sale.findMany({
      where, skip, take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        items:    { include: { item: { select: { name: true, sku: true } } } },
        payments: true,
        customer: { select: { id: true, name: true, phone: true } },
      },
    }),
    prisma.sale.count({ where }),
    prisma.sale.aggregate({ where, _sum: { totalAmount: true } }),
  ])

  // Margin reporting
  const marginRes = await prisma.$queryRaw<any[]>`
    SELECT COALESCE(SUM("lineTotal" - ("costPriceSnapshot" * "quantity")), 0) as "margin"
    FROM   "sale_items" si
    JOIN   "sales" s ON si."saleId" = s.id
    WHERE  s."deletedAt" IS NULL
    ${where.channelId ? Prisma.sql`AND s."channelId" = ${where.channelId}` : Prisma.sql``}
    ${query.performedBy ? Prisma.sql`AND s."performedBy" = ${query.performedBy}` : Prisma.sql``}
    ${query.paymentMethod ? Prisma.sql`AND EXISTS (
      SELECT 1 FROM "sale_payments" sp 
      WHERE sp."saleId" = s.id 
      AND sp."method"::text = ${query.paymentMethod}
    )` : Prisma.sql``}
    ${(where.createdAt as any)?.gte ? Prisma.sql`AND s."createdAt" >= ${(where.createdAt as any).gte}` : Prisma.sql``}
    ${(where.createdAt as any)?.lte ? Prisma.sql`AND s."createdAt" <= ${(where.createdAt as any).lte}` : Prisma.sql``}
  `
  const totalMargin = Number(marginRes[0]?.margin || 0)

  return {
    data,
    meta:  { total, page, limit, totalPages: Math.ceil(total / limit) },
    stats: { totalRevenue: Number(aggStats._sum.totalAmount || 0), totalMargin },
  }
}

export async function findSaleById(id: string) {
  return prisma.sale.findUniqueOrThrow({
    where:   { id },
    include: {
      items:    { include: { item: true } },
      payments: true,
      customer: true,
      channel:  { select: { id: true, name: true, code: true } },
    },
  })
}

export async function findSaleItems(saleId: string) {
  return prisma.saleItem.findMany({
    where:   { saleId },
    include: { item: true },
    orderBy: { createdAt: 'asc' },
  })
}

export async function reverseSale(saleId: string, actorId: string, managerPassword?: string) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUniqueOrThrow({
      where:   { id: saleId },
      include: { items: true, payments: true },
    })

    if (sale.deletedAt) throw { statusCode: 400, message: 'Sale already reversed' }

    const actor = await tx.user.findUniqueOrThrow({
      where:  { id: actorId },
      select: { passwordHash: true, role: true, channelId: true },
    })

    const bypassPassword = ['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN'].includes(actor.role)
    if (!bypassPassword) {
      if (!actor.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      if (sale.channelId !== actor.channelId) {
        throw { statusCode: 403, message: 'You can only reverse sales for your assigned channel' }
      }
    }
    if (!bypassPassword) {
      const isValid = managerPassword ? await verifyPassword(actor.passwordHash, managerPassword) : false
      if (!isValid) throw { statusCode: 403, message: 'Invalid manager password' }
    }

    for (const item of sale.items) {
      await tx.stockMovement.create({
        data: {
          itemId: item.itemId, channelId: sale.channelId, movementType: 'RETURN',
          quantityChange: item.quantity, referenceId: sale.id, referenceType: 'sale_reversal',
          unitCostAtTime: item.costPriceSnapshot, performedBy: actorId,
        },
      })
      await tx.inventoryBalance.update({
        where: { itemId_channelId: { itemId: item.itemId, channelId: sale.channelId } },
        data: { availableQty: { increment: item.quantity } }
      })
    }

    if (sale.saleType === 'CREDIT' && sale.customerId) {
      await tx.customer.update({ where: { id: sale.customerId }, data: { outstandingCredit: { decrement: sale.netAmount } } })
    }

    const loyaltyPayment = sale.payments.find(p => p.method === 'LOYALTY_POINTS')
    if (loyaltyPayment && sale.customerId) {
      // Payment.amount here is the points actually deducted at commit time (see
      // commitSaleOnce), not necessarily what was originally requested — refunding
      // it is correct. If a deficit was converted to credit debt, undo that too.
      const deficitMatch = loyaltyPayment.reference?.match(/^LOYALTY_DEFICIT:(-?\d+(\.\d+)?)$/)
      await tx.customer.update({
        where: { id: sale.customerId },
        data: {
          loyaltyPoints: { increment: Math.round(Number(loyaltyPayment.amount)) },
          ...(deficitMatch ? { outstandingCredit: { decrement: new Prisma.Decimal(deficitMatch[1]) } } : {}),
        },
      })
    }

    const totalCost = sale.items.reduce((sum, item) => sum + (Number(item.costPriceSnapshot) * item.quantity), 0)
    // FIX: was reversing totalAmount (pre-discount gross) — must reverse
    // netAmount, the actual figure the original sale posted to Cash/AR,
    // split by taxAmount, or a discounted/taxed sale leaves an unbalanced
    // ledger and a permanent phantom Tax Payable balance on void.
    await buildCreditNoteJournalEntry(tx as any, sale.id, Number(sale.netAmount), Number(sale.taxAmount), totalCost, sale.channelId, actorId, sale.saleType === 'CREDIT', sale.payments, Number(sale.netAmount))

    await tx.commissionEntry.updateMany({
      where: { saleId: sale.id, status: { in: ['PENDING', 'APPROVED'] } },
      data:  { status: 'VOIDED' },
    })

    await tx.sale.update({ where: { id: saleId }, data: { deletedAt: new Date() } })

    logAction({ action: AUDIT.SALE_VOID, actorId, actorRole: actor.role, channelId: sale.channelId, targetType: 'Sale', targetId: sale.id })
    return { message: 'Sale reversed successfully' }
  })
}

/**
 * ── OFFLINE SYNC ─────────────────────────────────────────────────────
 * Processes a sale that was already made offline.
 * Key difference: skipStockCheck is TRUE because the items are already
 * physically gone. We just need to record the financial/ledger impact.
 */
export async function syncOfflineSale(payload: any, actor: TokenPayload, idempotencyKey: string) {
  const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN'].includes(actor.role)
  if (!payload?.saleData?.channelId) {
    throw { statusCode: 400, message: 'channelId is required for offline sale sync' }
  }
  if (!isAdmin) {
    if (!actor.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    if (payload.saleData.channelId !== actor.channelId) {
      throw { statusCode: 403, message: 'You can only sync sales for your assigned channel' }
    }
  }

  // 1. Check if we already processed this
  const cached = await checkIdempotency(idempotencyKey)
  if (cached) return cached.responseBody

  // 2. Lock to prevent concurrent retries from creating duplicates
  const lockAcquired = await acquireIdempotencyLock(idempotencyKey)
  if (!lockAcquired) {
    throw { statusCode: 409, message: 'Sync in progress for this sale...' }
  }

  try {
    // 3. Commit the sale (skipping stock check)
    const sale = await commitSale(payload.saleData, actor, { 
      offlineReceiptNo: payload.offlineReceiptNo,
      deviceDate: payload.deviceDate,
      skipStockCheck: true 
    })

    const result = { status: 'synced', receiptNo: (sale as any).receiptNo, id: (sale as any).id }
    await storeIdempotencyResult(idempotencyKey, result, 201)
    return result

  } catch (err: any) {
    // 4. Handle CONFLICTS (e.g. Serial # Collision or Inventory exhausted elsewhere)
    // P2002 = Unique constraint violation (likely Serial Number or Receipt No)
    if (err.code === 'P2002' || err.statusCode === 422) {
      console.warn('[SyncConflict Detected]:', err.message)
      
      const totalAmount = (payload.saleData.items || []).reduce((sum: number, i: any) => sum + (i.quantity * i.unitPrice), 0)
      
      const conflict = await prisma.syncConflict.create({
        data: {
          type:         err.code === 'P2002' ? 'SERIAL_COLLISION' : 'INVENTORY_MISMATCH',
          errorMessage: err.message || 'Data integrity conflict during sync',
          salePayload:  payload as any,
          totalAmount:  new Prisma.Decimal(totalAmount.toFixed(4)),
          status:       'PENDING',
          channelId:    payload.saleData.channelId,
        }
      })

      const result = { status: 'conflict', conflictId: conflict.id, message: 'Manager Review Required' }
      await storeIdempotencyResult(idempotencyKey, result, 202) // 202 Accepted (but not committed yet)
      return result
    }

    // Release the lock on hard failure (500 etc) so the user can try again
    await releaseIdempotencyLock(idempotencyKey)
    throw err
  }
}

export class SalesService {
  // FIX: commitSale() opens and commits its OWN independent prisma.$transaction
  // (see commitSaleOnce above) — wrapping it inside this method's own outer
  // transaction did NOT make the two atomic together. If commitSale succeeded
  // but the outer transaction later failed (e.g. the status-update write),
  // the sale stayed durably committed while the conflict rolled back to
  // PENDING — and with no status guard, retrying (or two admins clicking
  // resolve at once) would call commitSale a second time on the same
  // payload, creating a duplicate sale. Fixed by atomically claiming the
  // conflict (PENDING -> PROCESSING) before touching commitSale, and by
  // not relying on transactional rollback to undo an already-committed sale.
  async resolveConflict(
    conflictId: string,
    action: 'FORCE_SYNC' | 'VOID',
    actor: TokenPayload,
    notes?: string
  ) {
    const conflictFiltered = await prisma.syncConflict.findUniqueOrThrow({
      where: { id: conflictId }
    })
    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN'].includes(actor.role)
    if (!isAdmin) {
      if (!actor.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      if (conflictFiltered.channelId !== actor.channelId) {
        throw { statusCode: 403, message: 'You can only resolve conflicts for your assigned channel' }
      }
    }

    // Atomically claim the conflict — prevents double-processing (concurrent
    // clicks or a retry after partial failure) from committing two sales.
    const claimed = await prisma.syncConflict.updateMany({
      where: { id: conflictId, status: 'PENDING' },
      data:  { status: 'PROCESSING' },
    })
    if (claimed.count === 0) {
      throw { statusCode: 400, message: 'Conflict has already been resolved or is being processed' }
    }

    // Tracks whether commitSale actually succeeded, so the catch block below
    // knows whether it's safe to release the claim back to PENDING (no sale
    // exists yet, retry is safe) or whether a sale now durably exists and
    // re-claiming would risk creating a duplicate on the next attempt.
    let committedSale: any = null

    try {
      const conflictPayload = conflictFiltered.salePayload as any
      if (conflictPayload?.saleData) {
        conflictPayload.saleData = {
          ...conflictPayload.saleData,
          channelId: conflictFiltered.channelId,
        }
      }

      if (action === 'FORCE_SYNC') {
        committedSale = await commitSale(conflictPayload.saleData, actor, {
          offlineReceiptNo: conflictPayload.offlineReceiptNo,
          deviceDate:       conflictPayload.deviceDate,
          skipStockCheck:   true
        })

        await prisma.syncConflict.update({
          where: { id: conflictId },
          data: {
            status: 'RESOLVED',
            resolutionNotes: notes || 'Manager Override',
            resolvedBy: actor.sub,
            saleId: committedSale.id
          }
        })

        logAction({
          action:    AUDIT.OFFLINE_SYNC,
          actorId:   actor.sub,
          actorRole: actor.role,
          channelId: conflictFiltered.channelId,
          targetType: 'Sale',
          targetId: committedSale.id,
          newValues: { notes: notes || 'Force-synced from Conflict Resolver' }
        })

        return { status: 'resolved', saleId: committedSale.id }
      }

      if (action === 'VOID') {
        await prisma.syncConflict.update({
          where: { id: conflictId },
          data: {
            status: 'VOIDED',
            resolutionNotes: notes || 'Voided by Manager',
            resolvedBy: actor.sub
          }
        })
        return { status: 'voided' }
      }

      // Unknown action — release the claim so it can be retried
      await prisma.syncConflict.update({ where: { id: conflictId }, data: { status: 'PENDING' } })
      return { status: 'failed', message: 'Unknown action' }
    } catch (err) {
      if (committedSale) {
        // The sale is already durably committed — reverting to PENDING here
        // would let a retry call commitSale again on the same payload and
        // create a duplicate. Leave it claimed (PROCESSING) and surface a
        // loud error demanding manual reconciliation instead.
        console.error(
          `[resolveConflict] Sale ${committedSale.id} (${committedSale.receiptNo}) committed but marking conflict ${conflictId} resolved failed. ` +
          `Left as PROCESSING to block auto-retry — needs manual reconciliation.`, err
        )
        throw { statusCode: 500, message: `Sale ${committedSale.receiptNo} was created but finalizing the conflict record failed. Do not retry — contact support for manual reconciliation.` }
      }
      // No sale was created — safe to release the claim for retry.
      await prisma.syncConflict.update({ where: { id: conflictId }, data: { status: 'PENDING' } }).catch(() => {})
      throw err
    }
  }

  async findConflicts(channelId: string) {
    return (prisma as any).syncConflict.findMany({
      where: { channelId, status: 'PENDING' },
      orderBy: { totalAmount: 'desc' }
    })
  }

  async findSales(query: any, actor?: TokenPayload) {
    const page  = query.page  ?? 1
    const limit = query.limit ?? 25
    const skip  = (page - 1) * limit
    const where: Prisma.SaleWhereInput = { 
      deletedAt: null, 
      channelId: actor?.channelId as string 
    }
    const [data, total] = await Promise.all([
      prisma.sale.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, include: { items: true, payments: true } }),
      prisma.sale.count({ where })
    ])
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }
  }

  async findSaleById(id: string) {
    return prisma.sale.findUniqueOrThrow({ where: { id }, include: { items: true, payments: true, customer: true } })
  }

  async suspendSale(channelId: string, userId: string, data: { customerData?: any, cartData: any, notes?: string }) {
    return (prisma as any).suspendedSale.create({
      data: { channelId, userId, customerData: data.customerData || null, cartData: data.cartData, notes: data.notes || null }
    })
  }

  async findSuspendedSales(channelId: string, userId?: string) {
    return (prisma as any).suspendedSale.findMany({ where: { channelId, ...(userId && { userId }) }, orderBy: { createdAt: 'desc' } })
  }

  async resumeSale(suspendedId: string, channelId: string) {
    return prisma.$transaction(async (tx) => {
      const suspended = await (tx as any).suspendedSale.findUniqueOrThrow({ where: { id: suspendedId, channelId } })
      await (tx as any).suspendedSale.delete({ where: { id: suspendedId } })
      return suspended
    })
  }
}

export const salesService = new SalesService()
