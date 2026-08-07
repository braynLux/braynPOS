import { prisma } from '../../lib/prisma.js'
import { calculateCommission } from '../commission/commission.service.js'
import { buildMarginCorrectionJournalEntry } from '../../lib/ledger.js'
import { logAction, AUDIT } from '../../lib/audit.js'

export class MarginCorrectionService {
  /**
   * Lists all items that have a zero cost price in any channel.
   * These are the "Ghost Items" that break margin reporting.
   */
  async listGhostItems(channelId?: string) {
    return prisma.inventoryBalance.findMany({
      where: {
        weightedAvgCost: 0,
        ...(channelId && { channelId })
      },
      include: {
        item: {
          select: { name: true, sku: true, barcode: true }
        },
        channel: {
          select: { name: true }
        }
      },
      orderBy: { item: { name: 'asc' } }
    })
  }

  /**
   * Bulk repairs an item's cost across one or all channels.
   * Optionally repairs historical sales that occurred with 0 cost.
   */
  async repairMargin(data: {
    itemId:      string
    channelId:   string
    newCost:     number
    newRetail?:  number
    repairRecentSales?: boolean
    actorId:     string
    actorRole:   string
  }) {
    const { itemId, channelId, newCost, newRetail, repairRecentSales, actorId, actorRole } = data

    return prisma.$transaction(async (tx) => {
      // 1. Update the Inventory Balance (The source of truth for future sales)
      const balance = await tx.inventoryBalance.update({
        where: { itemId_channelId: { itemId, channelId } },
        data: {
          weightedAvgCost: newCost,
          ...(newRetail && { retailPrice: newRetail })
        }
      })

      // 2. Sync to global item if needed (optional based on business rule)
      await tx.item.update({
        where: { id: itemId },
        data: {
          weightedAvgCost: newCost,
          ...(newRetail && { retailPrice: newRetail })
        }
      })

      let repairedSaleCount = 0
      let unlockedCommissionCount = 0

      // 3. Retroactive Repair (The "Historical Repair" step)
      if (repairRecentSales) {
        // Find sales for this item in this channel that were recorded with 0 cost
        const zeroCostItems = await tx.saleItem.findMany({
          where: {
            itemId,
            costPriceSnapshot: 0,
            sale: { channelId, deletedAt: null }
          },
          include: { sale: true }
        })

        for (const si of zeroCostItems) {
          // Update the snapshot
          await tx.saleItem.update({
            where: { id: si.id },
            data: { costPriceSnapshot: newCost }
          })
          repairedSaleCount++

          // FIX: the original sale's journal entry posted COGS/Inventory
          // Valuation using the old (zero) cost and is never revisited —
          // without this, the ledger stays permanently wrong even after
          // the snapshot is "repaired". Post the missed COGS now.
          const correction = newCost * si.quantity
          if (correction > 0) {
            await buildMarginCorrectionJournalEntry(tx as any, si.saleId, correction, channelId, actorId)
          }

          // Attempt to unlock commission (re-calculate)
          const commission = await calculateCommission(si.saleId, tx as any)
          if (commission) unlockedCommissionCount++
        }
      }

      logAction({
        action:     AUDIT.MARGIN_REPAIR,
        actorId:    actorId,
        actorRole,
        channelId:  channelId,
        targetType: 'Item',
        targetId:   itemId,
        newValues:  { newCost, repairedSaleCount, unlockedCommissionCount }
      })

      return {
        success: true,
        repairedSaleCount,
        unlockedCommissionCount,
        newCost: balance.weightedAvgCost
      }
    })
  }
}

export const marginCorrectionService = new MarginCorrectionService()
