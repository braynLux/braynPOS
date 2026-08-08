import { basePrisma, prisma } from '../../lib/prisma.js'
import { buildStockAdjustmentShrinkageJournalEntry } from '../../lib/ledger.js'

export class StockTakeService {
  async start(channelId: string, startedBy: string) {
    return prisma.$transaction(async (tx) => {
      // FIX: nothing stopped a channel from having several OPEN stock takes at
      // once. Each one snapshots its own expectedQty and each completion
      // applies its own correction to the same balances, so the second
      // completion re-applies a variance the first already settled. Serialize
      // per channel and reject a second concurrent take outright.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('stock-take:' || ${channelId}))`

      const existing = await tx.stockTake.findFirst({
        where: { channelId, status: 'OPEN' },
      })
      if (existing) {
        throw { statusCode: 409, message: 'This channel already has an open stock take' }
      }

      // Read balances inside the transaction so the snapshot matches the take
      const balances = await tx.inventoryBalance.findMany({ where: { channelId } })

      const stockTake = await tx.stockTake.create({
        data: {
          channelId,
          startedBy,
          status: 'OPEN',
        }
      })

      if (balances.length > 0) {
        await tx.stockTakeItem.createMany({
          data: balances.map(b => ({
            stockTakeId: stockTake.id,
            itemId: b.itemId,
            expectedQty: b.availableQty,
            recordedQty: null,
            discrepancy: null,
          }))
        })
      }

      return stockTake
    })
  }

  async recordCount(stockTakeId: string, itemId: string, recordedQty: number) {
    // Guard: recordedQty must be a safe integer, never NaN or negative
    if (!Number.isInteger(recordedQty) || recordedQty < 0) {
      throw { statusCode: 400, message: 'recordedQty must be a non-negative integer' }
    }

    const item = await prisma.stockTakeItem.findFirst({
      where: { stockTakeId, itemId },
      include: { stockTake: { select: { status: true, channelId: true } } },
    })

    if (!item) throw { statusCode: 404, message: 'Item not found in this stock take' }
    if (item.stockTake.status !== 'OPEN') {
      throw { statusCode: 400, message: 'Cannot record counts on a closed stock take' }
    }

    // ── FIX: rebase the expectation on the CURRENT system quantity ──────
    // expectedQty was snapshotted when the take was opened, but complete()
    // applies `increment: discrepancy` to whatever the balance is at
    // completion. Every sale, transfer or receipt that happened while the
    // take was open therefore got subtracted a second time and booked as
    // shrinkage: open at 100, sell 10 (balance 90), physically count 90 —
    // nothing actually lost — and completion computed 90 − 100 = −10, wrote
    // the balance down to 80 and posted a 10-unit shrinkage loss to the
    // ledger. Recording the count against the live quantity makes the
    // discrepancy a true variance, and leaves only movements between the
    // count and completion (a short window) to the increment.
    const balance = await prisma.inventoryBalance.findUnique({
      where:  { itemId_channelId: { itemId, channelId: item.stockTake.channelId } },
      select: { availableQty: true },
    })
    const expectedQty = balance?.availableQty ?? item.expectedQty

    // Always recompute discrepancy here — never trust a stale DB value
    const discrepancy = recordedQty - expectedQty

    return prisma.stockTakeItem.update({
      where: { id: item.id },
      data: {
        expectedQty,   // rebased to the quantity the system believed at count time
        recordedQty,
        discrepancy,   // always a fresh safe integer
      }
    })
  }

  async complete(id: string, completedBy: string) {
    return prisma.$transaction(async (tx) => {
      const stockTake = await tx.stockTake.findUniqueOrThrow({
        where: { id },
        include: { items: true }
      })

      if (stockTake.status !== 'OPEN') {
        throw { statusCode: 400, message: 'Stock take is already completed or cancelled' }
      }

      await tx.stockTake.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          completedBy,
          updatedAt: new Date()
        }
      })

      // Generate StockMovements for discrepancies
      for (const item of stockTake.items) {
        // ── FIX: skip items that were never physically counted ──────────
        if (item.recordedQty === null || item.recordedQty === undefined) continue

        // ── FIX: recompute discrepancy fresh — NEVER use the nullable
        //    DB field directly. item.discrepancy is Int? and could be null
        //    even when recordedQty is set, if a previous bug left it null.
        const discrepancy = item.recordedQty - item.expectedQty

        // No discrepancy — nothing to correct
        if (discrepancy === 0) continue

        // FIX: no DB trigger maintains inventory_balances from stock_movements
        // anywhere in this codebase (confirmed — no CREATE TRIGGER in any
        // migration; the same false assumption was already found and fixed
        // for manual stock adjustments and purchases elsewhere). This code
        // logged the discrepancy as a StockMovement but never actually wrote
        // the corrected quantity anywhere — completing a stock take never
        // changed availableQty at all, defeating the entire point of a
        // physical count reconciliation.
        const balance = await tx.inventoryBalance.findUnique({
          where: {
            itemId_channelId: {
              itemId: item.itemId,
              channelId: stockTake.channelId
            }
          },
          select: { weightedAvgCost: true }
        })

        await tx.stockMovement.create({
          data: {
            itemId: item.itemId,
            channelId: stockTake.channelId,
            movementType: 'STOCK_TAKE_CORRECTION',
            quantityChange: discrepancy,           // safe integer, never null
            unitCostAtTime: balance?.weightedAvgCost ?? 0,
            referenceId: stockTake.id,
            referenceType: 'stock_take',
            performedBy: completedBy,
            notes: `Stock Take Correction (Expected: ${item.expectedQty}, Counted: ${item.recordedQty}, Delta: ${discrepancy > 0 ? '+' : ''}${discrepancy})`
          }
        })

        await tx.inventoryBalance.upsert({
          where: {
            itemId_channelId: {
              itemId: item.itemId,
              channelId: stockTake.channelId
            }
          },
          create: { itemId: item.itemId, channelId: stockTake.channelId, availableQty: item.recordedQty },
          update: { availableQty: { increment: discrepancy } },
        })

        // A negative discrepancy (counted less than expected) is a genuine
        // physical loss — post it the same way a manual DAMAGED/THEFT stock
        // adjustment does. A positive discrepancy (counted more than
        // expected) is left unposted, same as manual adjustments: it's at
        // least as likely to be a past data-entry error being corrected as
        // a genuine inventory gain, so it isn't assumed to be real income.
        if (discrepancy < 0) {
          const shrinkageValue = Math.abs(discrepancy) * Number(balance?.weightedAvgCost ?? 0)
          if (shrinkageValue > 0) {
            await buildStockAdjustmentShrinkageJournalEntry(
              tx as any, stockTake.id,
              `Stock take correction: ${item.itemId} (expected ${item.expectedQty}, counted ${item.recordedQty})`,
              shrinkageValue, stockTake.channelId, completedBy
            )
          }
        }
      }

      return { id, status: 'COMPLETED' }
    })
  }

  async getTakeDetails(id: string, userRole: string) {
    const take = await basePrisma.stockTake.findUniqueOrThrow({
      where: { id },
      include: {
        items: {
          include: { item: { select: { name: true, sku: true } } }
        },
        channel: { select: { name: true } },
        startedByUser: { select: { username: true } },
        completedByUser: { select: { username: true } }
      }
    })

    // Blind count: hide expected qty from storekeepers during an open take
    if (userRole === 'STOREKEEPER' && take.status === 'OPEN') {
      return {
        ...take,
        items: take.items.map(i => ({
          ...i,
          expectedQty: undefined,
          discrepancy: undefined
        }))
      }
    }

    return take
  }

  private async checkAndPurge() {
    const seventyTwoHoursAgo = new Date();
    seventyTwoHoursAgo.setHours(seventyTwoHoursAgo.getHours() - 72);

    const purged = await prisma.stockTake.updateMany({
      where: {
        status: 'OPEN',
        updatedAt: { lt: seventyTwoHoursAgo }
      },
      data: {
        status: 'CANCELLED',
        notes: 'Automatically purged (cancelled) due to 72-hour inactivity policy (Incomplete since 72h).'
      }
    })
    
    if (purged.count > 0) {
      console.log(`[Policy] Purged ${purged.count} stale stock takes from over 72h ago.`)
    }
  }

  async list(channelId?: string) {
    // Audit-style lazy purge
    await this.checkAndPurge()

    return prisma.stockTake.findMany({
      where: channelId ? { channelId } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        channel: { select: { name: true } },
        startedByUser: { select: { username: true } }
      }
    })
  }
}

export const stockTakeService = new StockTakeService()
