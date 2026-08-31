import { prisma } from '../../lib/prisma.js'
import { buildCreditNoteJournalEntry } from '../../lib/ledger.js'

const RETURN_REFERENCE_TYPE = 'sale_return'
const NON_ADMIN_RETURN_WINDOW_MS = 3 * 60 * 60 * 1000
const HQ_ROLES = ['PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export async function findReturns(query: {
  channelId?: string; startDate?: string; endDate?: string
  page?: number; limit?: number
}) {
  const page  = query.page  ?? 1
  const limit = query.limit ?? 25
  const skip  = (page - 1) * limit

  const where = {
    movementType:  'RETURN' as const,
    referenceType: RETURN_REFERENCE_TYPE,
    ...(query.channelId && { channelId: query.channelId }),
    ...(query.startDate || query.endDate ? {
      createdAt: {
        ...(query.startDate && { gte: new Date(query.startDate) }),
        ...(query.endDate   && { lte: new Date(query.endDate) }),
      },
    } : {}),
  }

  const [data, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where, skip, take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        item:    { select: { id: true, name: true, sku: true } },
        channel: { select: { id: true, name: true } },
      },
    }),
    prisma.stockMovement.count({ where }),
  ])

  const saleIds = [...new Set(data.map(m => m.referenceId))]
  const sales = await prisma.sale.findMany({
    where:  { id: { in: saleIds } },
    select: { id: true, receiptNo: true },
  })
  const receiptBySaleId = new Map(sales.map(s => [s.id, s.receiptNo]))

  return {
    data: data.map(m => ({
      ...m,
      receiptNo: receiptBySaleId.get(m.referenceId) ?? null,
    })),
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  }
}

export async function processReturn(
  saleId: string,
  lines: Array<{ saleItemId: string; quantity: number; reason?: string }>,
  actorId: string,
  actorRole: string,
  channelId?: string,
) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirstOrThrow({
      where:   { id: saleId, ...(channelId && { channelId }) },
      // payments: the refund must be credited back to the same accounts the
      // sale debited, pro-rata for a partial return
      include: { items: true, payments: true },
    })
    if (sale.deletedAt) {
      throw { statusCode: 400, message: 'Cannot return items from a voided sale' }
    }

    if (!HQ_ROLES.includes(actorRole)) {
      const elapsed = Date.now() - new Date(sale.createdAt).getTime()
      if (elapsed > NON_ADMIN_RETURN_WINDOW_MS) {
        throw { statusCode: 403, message: 'Only an admin can return items sold more than 3 hours ago' }
      }
    }

    // Already-returned quantity per saleItem, derived from prior RETURN movements
    const priorReturns = await tx.stockMovement.findMany({
      where: { referenceId: saleId, referenceType: RETURN_REFERENCE_TYPE },
    })
    const alreadyReturnedByItem = new Map<string, number>()
    for (const m of priorReturns) {
      alreadyReturnedByItem.set(m.itemId, (alreadyReturnedByItem.get(m.itemId) ?? 0) + m.quantityChange)
    }

    const saleItemById = new Map(sale.items.map(si => [si.id, si]))

    // FIX: prior returns are tracked per itemId (StockMovement has no
    // saleItemId), but the cap was a single sale line's quantity. The same
    // itemId can span several SaleItem rows — one per serial — so a legitimate
    // second-line return was rejected as if the first line had used up the
    // allowance. Cap against the total quantity sold for that item instead.
    const soldByItem = new Map<string, number>()
    for (const si of sale.items) {
      soldByItem.set(si.itemId, (soldByItem.get(si.itemId) ?? 0) + si.quantity)
    }

    const created = []
    let refundAmount = 0
    let costAmount   = 0

    for (const line of lines) {
      const saleItem = saleItemById.get(line.saleItemId)
      if (!saleItem) {
        throw { statusCode: 422, message: `Line item ${line.saleItemId} does not belong to this sale` }
      }
      const alreadyReturned = alreadyReturnedByItem.get(saleItem.itemId) ?? 0
      const soldQty         = soldByItem.get(saleItem.itemId) ?? saleItem.quantity
      if (line.quantity <= 0 || alreadyReturned + line.quantity > soldQty) {
        throw {
          statusCode: 422,
          message: `Cannot return ${line.quantity} of item ${saleItem.itemId} — only ${soldQty - alreadyReturned} remaining returnable`,
        }
      }
      // FIX: running total must include lines processed earlier in THIS request.
      // Without it, a payload repeating the same saleItemId (e.g. two lines of 5
      // against a qty-5 line) had every line validated against the same stale
      // pre-request figure, so all of them passed and stock/refunds were
      // credited for more units than were ever sold.
      alreadyReturnedByItem.set(saleItem.itemId, alreadyReturned + line.quantity)

      const movement = await tx.stockMovement.create({
        data: {
          itemId:         saleItem.itemId,
          channelId:      sale.channelId,
          movementType:   'RETURN',
          quantityChange: line.quantity,
          referenceId:    sale.id,
          referenceType:  RETURN_REFERENCE_TYPE,
          unitCostAtTime: saleItem.costPriceSnapshot,
          performedBy:    actorId,
          notes:          line.reason,
        },
      })

      await tx.inventoryBalance.update({
        where: { itemId_channelId: { itemId: saleItem.itemId, channelId: sale.channelId } },
        data:  { availableQty: { increment: line.quantity } },
      })

      // Refund is the net (post-discount) per-unit price actually charged,
      // not the gross unit price — mirrors how the original sale was posted.
      const netUnitPrice = (Number(saleItem.lineTotal) - Number(saleItem.discountAmount)) / saleItem.quantity
      refundAmount += netUnitPrice * line.quantity
      costAmount   += Number(saleItem.costPriceSnapshot) * line.quantity

      created.push(movement)
    }

    // FIX: physical stock was being restored on every return, but nothing
    // reversed the accounting side — Inventory Valuation, Sales Revenue, and
    // (for credit sales) the customer's outstanding balance never moved,
    // silently corrupting the P&L and Balance Sheet on every partial return.
    if (refundAmount > 0) {
      const saleTaxAmount = Number(sale.taxAmount)
      const saleNetAmount = Number(sale.netAmount)
      const proportionalTax = saleNetAmount > 0 ? saleTaxAmount * (refundAmount / saleNetAmount) : 0

      await buildCreditNoteJournalEntry(
        tx as any, sale.id, refundAmount, proportionalTax, costAmount,
        sale.channelId, actorId, sale.saleType === 'CREDIT',
        sale.payments, saleNetAmount
      )

      if (sale.saleType === 'CREDIT' && sale.customerId) {
        await tx.customer.update({
          where: { id: sale.customerId },
          data:  { outstandingCredit: { decrement: refundAmount } },
        })
      }
    }

    return created
  })
}
