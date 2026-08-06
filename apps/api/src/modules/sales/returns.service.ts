import { prisma } from '../../lib/prisma.js'

const RETURN_REFERENCE_TYPE = 'sale_return'
const NON_ADMIN_RETURN_WINDOW_MS = 3 * 60 * 60 * 1000
const HQ_ROLES = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

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
      include: { items: true },
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
    const created = []

    for (const line of lines) {
      const saleItem = saleItemById.get(line.saleItemId)
      if (!saleItem) {
        throw { statusCode: 422, message: `Line item ${line.saleItemId} does not belong to this sale` }
      }
      const alreadyReturned = alreadyReturnedByItem.get(saleItem.itemId) ?? 0
      if (line.quantity <= 0 || alreadyReturned + line.quantity > saleItem.quantity) {
        throw {
          statusCode: 422,
          message: `Cannot return ${line.quantity} of item ${saleItem.itemId} — only ${saleItem.quantity - alreadyReturned} remaining returnable`,
        }
      }

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

      created.push(movement)
    }

    return created
  })
}
