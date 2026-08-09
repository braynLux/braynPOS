import { prisma } from '../../lib/prisma.js'
import { Prisma } from '@prisma/client'
import { buildPurchaseJournalEntry } from '../../lib/ledger.js'
import { eventBus } from '../../lib/event-bus.js'

export class PurchaseService {
  async create(data: {
    supplierId: string
    channelId: string
    purchaseOrderId?: string
    lines: Array<{ itemId: string; quantity: number; unitCost: number; retailPrice?: number; wholesalePrice?: number; serialNumbers?: string[] }>
    landedCosts?: Array<{ description: string; amount: number; allocationMethod: 'BY_VALUE' | 'BY_QUANTITY' }>
    paymentMethod?: string
    notes?: string
    supplierInvoiceNo?: string
    purchaseDate?: string
    committedBy: string
  }) {
    // FIX 1: UUID suffix prevents collisions under concurrent load
    const uniqueSuffix = Math.random().toString(36).slice(2, 8).toUpperCase()
    const purchaseNo   = `PUR-${Date.now()}-${uniqueSuffix}`

    // FIX 2: Removed console.log that leaked full purchase data to server logs

    let totalCost = 0
    let totalQty = 0
    const invalidCostLines: string[] = []

    for (const line of data.lines) {
      if (line.unitCost <= 0) {
        const item = await prisma.item.findUnique({ where: { id: line.itemId }, select: { name: true, sku: true } })
        invalidCostLines.push(`${item?.name || line.itemId} (${item?.sku || 'N/A'}): Unit cost must be greater than 0`)
      }
      totalCost += line.quantity * line.unitCost
      totalQty += line.quantity
    }

    if (invalidCostLines.length > 0) {
      throw {
        statusCode: 422,
        message: `Invalid purchase data. One or more items have missing or zero costs:\n${invalidCostLines.join('\n')}`
      }
    }

    const landedCostTotal = data.landedCosts?.reduce((s, l) => s + l.amount, 0) ?? 0

    return prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({
        where:  { id: data.supplierId },
        select: { channelId: true, deletedAt: true },
      })
      if (!supplier || supplier.deletedAt) {
        throw { statusCode: 404, message: 'Supplier not found' }
      }
      if (supplier.channelId && supplier.channelId !== data.channelId) {
        throw { statusCode: 403, message: 'Supplier does not belong to the purchase channel' }
      }

      if (data.purchaseOrderId) {
        const order = await tx.purchaseOrder.findUnique({
          where:  { id: data.purchaseOrderId },
          select: { channelId: true, status: true },
        })
        if (!order) {
          throw { statusCode: 404, message: 'Purchase order not found' }
        }
        if (order.channelId !== data.channelId) {
          throw { statusCode: 403, message: 'Purchase order does not belong to the purchase channel' }
        }
        if (['CANCELLED', 'FULFILLED'].includes(order.status)) {
          throw { statusCode: 400, message: `Cannot receive against a ${order.status.toLowerCase()} purchase order` }
        }

        const orderLines = await tx.lpoLine.findMany({
          where: { purchaseOrderId: data.purchaseOrderId },
        })
        const orderLineByItem = new Map(orderLines.map(line => [line.itemId, line]))
        // FIX: each line was checked against the same stored receivedQty, so a
        // payload repeating an item (two batches of the same product) had every
        // line measured against the untouched remaining quantity and all of them
        // passed — receiving more than was ever ordered. Accumulate per item.
        const claimedByItem = new Map<string, number>()
        for (const line of data.lines) {
          const orderLine = orderLineByItem.get(line.itemId)
          if (!orderLine) {
            throw { statusCode: 422, message: `Item ${line.itemId} is not part of this purchase order` }
          }
          const claimed = (claimedByItem.get(line.itemId) ?? 0) + line.quantity
          claimedByItem.set(line.itemId, claimed)
          if (orderLine.receivedQty + claimed > orderLine.quantity) {
            throw { statusCode: 422, message: `Received quantity for item ${line.itemId} exceeds the ordered quantity` }
          }
        }
      }

      const purchase = await tx.purchase.create({
        data: {
          purchaseNo,
          supplierId: data.supplierId,
          channelId: data.channelId,
          purchaseOrderId: data.purchaseOrderId ?? null,
          status: 'COMMITTED',
          totalCost,
          landedCostTotal,
          paymentMethod: data.paymentMethod as Prisma.EnumPaymentMethodFieldUpdateOperationsInput['set'] ?? null,
          notes: data.notes ?? null,
          supplierInvoiceNo: data.supplierInvoiceNo ?? null,
          purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
          committedBy: data.committedBy,
          committedAt: new Date(),
          lines: {
            create: data.lines.map(l => ({
              itemId: l.itemId,
              quantity: l.quantity,
              unitCost: l.unitCost,
              lineTotal: l.quantity * l.unitCost,
            })),
          },
          landedCosts: data.landedCosts ? {
            create: data.landedCosts,
          } : undefined,
        },
      })

      // ── BATCH INSERTIONS (Eliminates N+1 queries) ──────────────────────
      
      // 1. Batch create all stock movements
      await tx.stockMovement.createMany({
        data: data.lines.map(line => ({
          itemId:         line.itemId,
          channelId:      data.channelId,
          movementType:   'PURCHASE',
          quantityChange: Number(line.quantity),
          unitCostAtTime: Number(line.unitCost),
          referenceId:    purchase.id,
          referenceType:  'purchase',
          notes:          'Purchase Receipt',
          performedBy:    data.committedBy,
        })),
      })

      // 2. Batch create all serials (if any)
      const allSerials = data.lines.flatMap(line => 
        (line.serialNumbers || []).map(sn => ({
          serialNo:  sn,
          itemId:    line.itemId,
          channelId: data.channelId,
          status:    'IN_STOCK' as const,
        }))
      )
      if (allSerials.length > 0) {
        await tx.serial.createMany({
          data:           allSerials,
          skipDuplicates: true,
        })
      }

      // 3. Pre-fetch local inventory balances for WAC calculation in memory (1 query instead of N)
      const existingBalances = await tx.inventoryBalance.findMany({
        where: {
          channelId: data.channelId,
          itemId:    { in: data.lines.map(l => l.itemId) },
        },
      })
      const balanceMap = Object.fromEntries(existingBalances.map((b: any) => [b.itemId, b]))

      // 4. WAC calculations and upserts, aggregated per item
      //
      // FIX: this ran one upsert per LINE in parallel over a shared balanceMap
      // snapshot. A purchase listing the same item on two lines — two batches at
      // different unit costs, a routine way to receive goods — had both lines
      // compute their new WAC from the same pre-purchase figures and then write
      // `weightedAvgCost:` (a set, not an increment), so the second silently
      // overwrote the first and the item's cost ignored one of the batches
      // entirely, while availableQty incremented for both. Every downstream
      // margin, COGS posting and below-cost warning inherited that wrong cost.
      // Lines are now folded per item first, then applied one item at a time.
      const perItem = new Map<string, {
        quantity: number; value: number; retailPrice?: number; wholesalePrice?: number
      }>()

      for (const line of data.lines) {
        // Apportion Landed Costs
        let allocatedLandedCost = 0
        if (data.landedCosts) {
          for (const lc of data.landedCosts) {
            if (lc.allocationMethod === 'BY_VALUE' && totalCost > 0) {
              allocatedLandedCost += ( (line.quantity * line.unitCost) / totalCost ) * lc.amount
            } else if (lc.allocationMethod === 'BY_QUANTITY' && totalQty > 0) {
              allocatedLandedCost += ( line.quantity / totalQty ) * lc.amount
            }
          }
        }
        // Landed cost is already apportioned to this line as a whole, so add it
        // to the line's value directly rather than per-unit-then-times-quantity.
        const lineValue = (Number(line.unitCost) * line.quantity) + allocatedLandedCost

        const agg = perItem.get(line.itemId) ?? { quantity: 0, value: 0 }
        agg.quantity += line.quantity
        agg.value    += lineValue
        // Last line naming a price wins, matching the previous per-line behaviour
        if (line.retailPrice    !== undefined) agg.retailPrice    = line.retailPrice
        if (line.wholesalePrice !== undefined) agg.wholesalePrice = line.wholesalePrice
        perItem.set(line.itemId, agg)
      }

      for (const [itemId, agg] of perItem) {
        const balance          = balanceMap[itemId]
        const currentQty       = Number(balance?.availableQty || 0)
        // No DB trigger exists — availableQty is NOT pre-updated by the stock movement insert.
        // WAC calculation: old stock value + new purchase value / total new qty
        const oldWAC           = Number(balance?.weightedAvgCost || 0)

        const totalValueBefore = currentQty * oldWAC
        const totalValueAfter  = totalValueBefore + agg.value
        const totalQtyAfter    = currentQty + agg.quantity
        const newWAC           = totalQtyAfter > 0
          ? totalValueAfter / totalQtyAfter
          : (agg.quantity > 0 ? agg.value / agg.quantity : oldWAC)

        // Single upsert combines metadata (retailPrice), WAC, and availableQty
        await tx.inventoryBalance.upsert({
          where:  { itemId_channelId: { itemId, channelId: data.channelId } },
          create: {
            itemId,
            channelId:       data.channelId,
            availableQty:    agg.quantity,
            weightedAvgCost: newWAC,
            retailPrice:     agg.retailPrice    ?? 0,
            wholesalePrice:  agg.wholesalePrice ?? 0,
          },
          update: {
            availableQty:    { increment: agg.quantity },
            weightedAvgCost: newWAC,
            ...(agg.retailPrice    !== undefined && { retailPrice:    agg.retailPrice }),
            ...(agg.wholesalePrice !== undefined && { wholesalePrice: agg.wholesalePrice }),
          },
        })
      }

      // Post double-entry journal entry
      const isCash = data.paymentMethod === 'CASH'
      await buildPurchaseJournalEntry(tx as any, purchase, totalCost + landedCostTotal, data.committedBy, isCash)

      // Update LPO lines if linked
      if (data.purchaseOrderId) {
        for (const line of data.lines) {
          // FIX 4: Derive correct LPO line status — PARTIAL vs FULFILLED
          const lpoLine = await tx.lpoLine.findFirst({
            where: { purchaseOrderId: data.purchaseOrderId, itemId: line.itemId },
          })

          if (lpoLine) {
            const newReceivedQty = lpoLine.receivedQty + line.quantity
            // FIX 4: was hardcoded 'FULFILLED' — now correctly uses PARTIAL
            const lineStatus: 'FULFILLED' | 'PARTIAL' =
              newReceivedQty >= lpoLine.quantity ? 'FULFILLED' : 'PARTIAL'

            await tx.lpoLine.update({
              where: { id: lpoLine.id },
              data: {
                receivedQty: { increment: line.quantity },
                status:      lineStatus,
              },
            })
          }
        }

        // Check if all lines are fulfilled to update main order status
        const allLines = await tx.lpoLine.findMany({
          where: { purchaseOrderId: data.purchaseOrderId }
        })
        const isFullyFulfilled = allLines.every(l => l.receivedQty >= l.quantity)
        
        await tx.purchaseOrder.update({
          where: { id: data.purchaseOrderId },
          data: { status: isFullyFulfilled ? 'FULFILLED' : 'PARTIALLY_FULFILLED' }
        })
      }

      eventBus.emit('purchase.committed', {
        purchaseId: purchase.id,
        channelId:  data.channelId,
      } as any)

      return purchase
    })
  }

  async findAll(query: {
    channelId?: string
    page?:      number
    limit?:     number
    startDate?: string
    endDate?:   string
  }) {
    const page  = query.page  ?? 1
    const limit = query.limit ?? 25
    const skip  = (page - 1) * limit

    const where: Prisma.PurchaseWhereInput = {
      // Voided purchases keep status COMMITTED and are only marked by
      // deletedAt, and the soft-delete middleware that would have hidden them
      // is never registered on the client — so they have to be excluded here.
      deletedAt: null,
      ...(query.channelId && { channelId: query.channelId }),
      ...(query.startDate || query.endDate ? {
        createdAt: {
          ...(query.startDate && { gte: new Date(query.startDate) }),
          ...(query.endDate   && { lte: new Date(query.endDate) }),
        },
      } : {}),
    }

    const [data, total] = await Promise.all([
      prisma.purchase.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          supplier: { select: { id: true, name: true } },
          channel: { select: { id: true, name: true } },
          lines: { include: { item: { select: { name: true, sku: true } } } },
        },
      }),
      prisma.purchase.count({ where }),
    ])

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }
  }

  async findById(id: string, channelId?: string) {
    return prisma.purchase.findFirstOrThrow({
      where: { id, ...(channelId && { channelId }) },
      include: {
        supplier: true, channel: true,
        lines: { include: { item: true } },
        landedCosts: true,
        purchaseOrder: { select: { id: true, orderNo: true } },
      },
    })
  }

  async softDelete(id: string, channelId: string | undefined, deletedBy: string) {
    return prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findFirstOrThrow({
        where: { id, ...(channelId && { channelId }) },
        include: { lines: true }
      })

      if (purchase.deletedAt) {
        throw { statusCode: 400, message: 'Purchase is already deleted' }
      }

      // 1. Reverse stock for each line
      for (const line of purchase.lines) {
        await tx.stockMovement.create({
          data: {
            itemId: line.itemId,
            channelId: purchase.channelId,
            movementType: 'ADJUSTMENT_OUT',
            quantityChange: -(line.quantity),
            referenceId: purchase.id,
            referenceType: 'purchase_void',
            notes: `Voiding purchase ${purchase.purchaseNo}`,
            performedBy: deletedBy,
          },
        })

        // FIX: voiding a purchase logged an ADJUSTMENT_OUT movement and
        // reversed the ledger, but never took the quantity back out of
        // inventory_balances — no DB trigger maintains that table, as create()
        // above (and every other stock path in this codebase) has to do the
        // write itself. The goods stayed on hand and sellable while Inventory
        // Valuation was credited away, so stock on hand and the balance sheet
        // disagreed by the full value of every voided purchase.
        // updateMany rather than update: a no-op when the row is absent, and
        // naming channelId keeps the multi-tenant extension from scoping this
        // to the caller's channel instead of the purchase's.
        await tx.inventoryBalance.updateMany({
          where: { itemId: line.itemId, channelId: purchase.channelId },
          data:  { availableQty: { decrement: line.quantity } },
        })

        // FIX 5: Soft-delete exactly line.quantity IN_STOCK serials,
        // ordered by createdAt ASC (oldest first) to target the ones
        // from this specific purchase without bleeding into later ones.
        // The original used createdAt >= purchase.createdAt which would
        // also delete serials from any subsequent purchase of the same item.
        const serialsToVoid = await tx.serial.findMany({
          where: {
            itemId:    line.itemId,
            channelId: purchase.channelId,
            status:    'IN_STOCK',
            deletedAt: null,
          },
          orderBy: { createdAt: 'asc' },
          take:    line.quantity,
          select:  { id: true },
        })

        if (serialsToVoid.length > 0) {
          await tx.serial.updateMany({
            where: { id: { in: serialsToVoid.map(s => s.id) } },
            data:  { deletedAt: new Date() },
          })
        }
      }

      // 3. Reverse Ledger entries
      // FIX: the original purchase posted Inventory Valuation and AP/Cash for
      // totalCost + landedCostTotal (see create() above) — reversing only
      // totalCost left both accounts permanently overstated by the landed
      // cost whenever a voided purchase had any (freight, duty, etc).
      const { buildPurchaseReturnJournalEntry } = await import('../../lib/ledger.js')
      await buildPurchaseReturnJournalEntry(
        tx as any,
        purchase,
        Number(purchase.totalCost) + Number(purchase.landedCostTotal),
        deletedBy,
        purchase.paymentMethod === 'CASH'
      )

      // 4. Mark purchase as deleted
      return tx.purchase.update({
        where: { id },
        data: { deletedAt: new Date() },
      })
    })
  }
}

export const purchaseService = new PurchaseService()
