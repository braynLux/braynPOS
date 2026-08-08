import { prisma, basePrisma, type TransactionClient } from '../../lib/prisma.js'
import { Prisma }                        from '@prisma/client'
import { buildShrinkageJournalEntry }    from '../../lib/ledger.js'
import { eventBus }                      from '../../lib/event-bus.js'
import { itemsService }                  from '../items/items.service.js'
import { randomBytes }                   from 'crypto'

export class TransfersService {

  async create(data: {
    fromChannelId: string
    toChannelId:   string
    lines:         Array<{ itemId: string; quantity: number; serialIds?: string[] }>
    notes?:        string
    sentBy:        string
  }) {
    // ── Stock availability check ───────────────────────────────────
    const stockErrors: string[] = []
    for (const line of data.lines) {
      const balance = await (prisma as any).inventoryBalance.findUnique({
        where:  { itemId_channelId: { itemId: line.itemId, channelId: data.fromChannelId } },
        select: { availableQty: true },
      })
      const available = (balance as any)?.availableQty ?? 0
      if (available < line.quantity) {
        const item  = await prisma.item.findUnique({
          where:  { id: line.itemId },
          select: { name: true, sku: true },
        })
        const label = item ? `"${item.name}" (${item.sku})` : line.itemId
        stockErrors.push(`${label}: requested ${line.quantity}, available ${available}`)
      }
    }
    if (stockErrors.length > 0) {
      const error = new Error(`Insufficient stock for transfer:\n${stockErrors.join('\n')}`) as any
      error.statusCode = 422
      throw error
    }

    // ── Cost existence check (HARD BLOCK) ──────────────────────────
    const missingCostItems: string[] = []
    for (const line of data.lines) {
      const balance = await (prisma as any).inventoryBalance.findUnique({
        where:  { itemId_channelId: { itemId: line.itemId, channelId: data.fromChannelId } },
        select: { weightedAvgCost: true },
      })
      const cost = Number((balance as any)?.weightedAvgCost ?? 0)
      if (cost <= 0) {
        const item = await prisma.item.findUnique({
          where:  { id: line.itemId },
          select: { name: true, sku: true },
        })
        missingCostItems.push(`${item?.name || line.itemId} (${item?.sku || 'N/A'})`)
      }
    }

    if (missingCostItems.length > 0) {
      throw {
        statusCode: 422,
        message: `Transfer Blocked: The following items have no recorded cost price. You must record a purchase or update the cost before transferring:\n${missingCostItems.join('\n')}`
      }
    }

    const uniqueSuffix = randomBytes(3).toString('hex').toUpperCase()
    const transferNo   = `TRF-${Date.now()}-${uniqueSuffix}`

    // ── Create Transfer using basePrisma ───────────────────────────
    // KEY FIX: basePrisma bypasses the multi-tenant extension entirely.
    // The extension tries to inject channelId into Transfer.create()
    // but Transfer uses fromChannelId/toChannelId — channelId doesn't
    // exist on this model and Prisma throws an "Unknown argument" error.
    // Using basePrisma is the correct, permanent solution.
    const transfer = await basePrisma.transfer.create({
      data: {
        transferNo,
        fromChannelId: data.fromChannelId,
        toChannelId:   data.toChannelId,
        status:        'SENT',
        sentBy:        data.sentBy,
        sentAt:        new Date(),
        notes:         data.notes ?? null,
        lines: {
          create: data.lines.map(l => ({
            itemId:       l.itemId,
            sentQuantity: l.quantity,
          })),
        },
      },
      include: { lines: true },
    })

    // ── Stock movements in a transaction ───────────────────────────
    try {
      await prisma.$transaction(async (tx: TransactionClient) => {
        for (const line of data.lines) {
          await tx.stockMovement.create({
            data: {
              itemId:         line.itemId,
              channelId:      data.fromChannelId,
              movementType:   'TRANSFER_OUT',
              quantityChange: -(line.quantity),
              referenceId:    transfer.id,
              referenceType:  'transfer',
              performedBy:    data.sentBy,
            },
          })

          // No DB trigger exists! We must manually deduct from source location.
          //
          // FIX: the availability check above runs before the transaction opens,
          // so two transfers of the same item raced — both read availableQty 10,
          // both passed, and both decremented, driving stock negative and
          // shipping units that were never there. A plain decrement cannot
          // detect that. This conditional UPDATE re-checks the quantity inside
          // the transaction, in the same statement that applies the decrement,
          // so the loser matches no row and is rejected.
          const decremented = await tx.$executeRaw`
            UPDATE inventory_balances
            SET "availableQty" = "availableQty" - ${line.quantity}
            WHERE "itemId"     = ${line.itemId}::text
              AND "channelId"  = ${data.fromChannelId}::text
              AND "availableQty" >= ${line.quantity}
          `
          if (decremented === 0) {
            throw {
              statusCode: 422,
              message: `Insufficient stock for item ${line.itemId} — another transfer or sale consumed it while this transfer was being prepared. Please retry.`,
            }
          }
          if (line.serialIds?.length) {
            // FIX: the chosen serials used to be marked TRANSFERRED and nothing
            // else, so which units belonged to which transfer was lost the
            // moment the request finished. Stamp the transfer line on them so
            // receive() and cancel() act only on this transfer's units.
            const transferLine = transfer.lines.find(tl => tl.itemId === line.itemId)
            await tx.serial.updateMany({
              where: { id: { in: line.serialIds }, channelId: data.fromChannelId },
              data:  { status: 'TRANSFERRED', transferLineId: transferLine?.id ?? null },
            })
          }

          await tx.stockMovement.create({
            data: {
              itemId:         line.itemId,
              channelId:      data.toChannelId,
              movementType:   'TRANSFER_IN_PENDING',
              quantityChange: line.quantity,
              referenceId:    transfer.id,
              referenceType:  'transfer',
              performedBy:    data.sentBy,
            },
          })
        }
      })
    } catch (err) {
      // Compensating action: remove transfer if stock operations fail
      await basePrisma.transferLine.deleteMany({ where: { transferId: transfer.id } })
      await basePrisma.transfer.delete({ where: { id: transfer.id } })
      throw err
    }

    eventBus.emit('transfer.sent', {
      transferId:    transfer.id,
      fromChannelId: data.fromChannelId,
      toChannelId:   data.toChannelId,
    })

    return this.findById(transfer.id)
  }

  async receive(
    id:         string,
    userId:     string,
    lines:      Array<{ itemId: string; receivedQuantity: number; disputeReason?: string }>
  ) {
    const transfer = await this.findById(id)
    const t        = transfer as any

    if (t.status !== 'SENT') {
      throw { statusCode: 400, message: `Only SENT transfers can be received. Current: ${t.status}` }
    }

    // FIX: the loop below walks the caller's payload, so any transfer line the
    // payload omitted was silently skipped — its TRANSFER_IN_PENDING was never
    // cleared, no shrinkage was raised for it, and the transfer was still
    // marked RECEIVED. Stock left the source and vanished with no record.
    // Require every line to be accounted for; the UI already sends them all.
    const payloadItemIds  = new Set(lines.map(l => l.itemId))
    const uncoveredLines  = (t.lines ?? []).filter((tl: any) => !payloadItemIds.has(tl.itemId))
    if (uncoveredLines.length > 0) {
      throw {
        statusCode: 422,
        message: `Receive payload must account for every line on the transfer. Missing: ${uncoveredLines.map((l: any) => l.itemId).join(', ')}`,
      }
    }

    let hasDispute           = false
    let totalShrinkageValue  = 0
    let receivedBy           = userId

    // Pre-fetch metadata (categories/brands/suppliers) OUTSIDE the transaction
    // to prevent connection pool deadlocks with the global Prisma client
    const ensuredMetadata: Record<string, { localCategoryId?: string, localBrandId?: string, localSupplierId?: string }> = {}
    const sourceItemsForMetadata: Record<string, any> = {} // Store source items for later use
    for (const line of lines) {
      const sourceItemForMeta = await prisma.item.findUniqueOrThrow({
        where: { id: line.itemId },
        include: { 
          category: true, 
          brand: true, 
          supplier: true,
          inventoryBalances: { where: { channelId: t.fromChannelId }, take: 1 },
        } as any,
      })
      sourceItemsForMetadata[line.itemId] = sourceItemForMeta
      ensuredMetadata[line.itemId] = await itemsService.ensureMetadata(t.toChannelId, sourceItemForMeta)
    }
    await prisma.$transaction(async (tx: TransactionClient) => {
      for (const line of lines) {
        const transferLine = t.lines?.find((tl: any) => tl.itemId === line.itemId)
        if (!transferLine) continue
        if (line.receivedQuantity > transferLine.sentQuantity) {
          throw {
            statusCode: 422,
            message: `Received quantity for item ${line.itemId} cannot exceed sent quantity ${transferLine.sentQuantity}`,
          }
        }

        // Update transfer line inside the shared transaction avoiding pool deadlocks
        await tx.transferLine.update({
          where: { id: transferLine.id },
          data:  {
            receivedQuantity: line.receivedQuantity,
            disputeReason:    line.disputeReason ?? null,
          },
        })

        if (line.receivedQuantity > 0) {
          await tx.stockMovement.create({
            data: {
              itemId:         line.itemId,
              channelId:      t.toChannelId,
              movementType:   'TRANSFER_IN',
              quantityChange: line.receivedQuantity,
              referenceId:    id,
              referenceType:  'transfer',
              performedBy:    receivedBy,
            },
          })

          // No DB trigger exists! Increment handled via upsert below.
        }

        // Use the pre-fetched source item
        const sourceItem = sourceItemsForMetadata[line.itemId]

        const existingBalance = await (tx as any).inventoryBalance.findUnique({
          where: { itemId_channelId: { itemId: line.itemId, channelId: t.toChannelId } },
        })

        // Consume the pre-fetched metadata mapping to avoid global client usage inside `tx`
        const metadata = ensuredMetadata[line.itemId] || {}
        const { localCategoryId, localBrandId, localSupplierId } = metadata

        await tx.item.update({
          where: { id: line.itemId },
          data:  {
            categoryId: localCategoryId ?? sourceItem.categoryId,
            brandId:    localBrandId    ?? sourceItem.brandId,
            supplierId: localSupplierId ?? sourceItem.supplierId,
          },
        })

        const sourceBalance   = (sourceItem as any).inventoryBalances?.[0]

        await (tx as any).inventoryBalance.upsert({
          where:  { itemId_channelId: { itemId: line.itemId, channelId: t.toChannelId } },
          create: {
            itemId:            line.itemId,
            channelId:         t.toChannelId,
            availableQty:      line.receivedQuantity,
            retailPrice:       sourceBalance?.retailPrice       ?? 0,
            wholesalePrice:    sourceBalance?.wholesalePrice    ?? 0,
            minRetailPrice:    sourceBalance?.minRetailPrice    ?? 0,
            minWholesalePrice: sourceBalance?.minWholesalePrice ?? 0,
            weightedAvgCost:   sourceBalance?.weightedAvgCost   ?? 0,
          },
          update: {
            availableQty: { increment: line.receivedQuantity },
            ...(Number(existingBalance?.retailPrice     ?? 0) === 0 && { retailPrice:       sourceBalance?.retailPrice       ?? 0 }),
            ...(Number(existingBalance?.wholesalePrice  ?? 0) === 0 && { wholesalePrice:    sourceBalance?.wholesalePrice    ?? 0 }),
            ...(Number(existingBalance?.minRetailPrice  ?? 0) === 0 && { minRetailPrice:    sourceBalance?.minRetailPrice    ?? 0 }),
            ...(Number(existingBalance?.weightedAvgCost ?? 0) === 0 && { weightedAvgCost:   sourceBalance?.weightedAvgCost   ?? 0 }),
          },
        })

        await tx.stockMovement.create({
          data: {
            itemId:         line.itemId,
            channelId:      t.toChannelId,
            movementType:   'TRANSFER_IN_PENDING',
            quantityChange: -(transferLine.sentQuantity),
            referenceId:    id,
            referenceType:  'transfer',
            performedBy:    receivedBy,
          },
        })

        const shortage = transferLine.sentQuantity - line.receivedQuantity
        if (shortage > 0) {
          hasDispute           = true
          totalShrinkageValue += shortage * Number(sourceBalance?.weightedAvgCost || 0)
        }

        // FIX: this used to match any TRANSFERRED serial of the item at the
        // source channel, so a concurrent transfer of the same item could have
        // its units moved by whichever transfer was received first. Prefer the
        // serials actually stamped with this transfer line; fall back to the
        // old status-only match for transfers sent before transferLineId
        // existed, which have no stamp to select on.
        // Every query here names channelId explicitly. Serial is channel-isolated,
        // and the multi-tenant extension injects the *caller's* channelId into any
        // where clause that omits it — but the units are still parked at
        // fromChannelId until this moment, so an un-scoped query run by a
        // receiving (toChannel) user silently matches nothing.
        const ownSerials = await tx.serial.findMany({
          where:   { transferLineId: transferLine.id, channelId: t.fromChannelId, status: 'TRANSFERRED' },
          orderBy: { id: 'asc' },
          take:    line.receivedQuantity,
        })
        const serialsToMove = ownSerials.length > 0
          ? ownSerials
          : await tx.serial.findMany({
              where:   { itemId: line.itemId, channelId: t.fromChannelId, status: 'TRANSFERRED', transferLineId: null },
              orderBy: { id: 'asc' },
              take:    line.receivedQuantity,
            })
        if (serialsToMove.length > 0) {
          // FIX: the update omitted channelId too, so the extension scoped it to
          // the receiver's channel and matched none of the source-channel rows —
          // serials were never actually moved for any non-admin receiver.
          await tx.serial.updateMany({
            where: { id: { in: serialsToMove.map((s: any) => s.id) }, channelId: t.fromChannelId },
            data:  { channelId: t.toChannelId, status: 'IN_STOCK', transferLineId: null, updatedAt: new Date() },
          })
        }
      }

      const newStatus = hasDispute ? 'DISPUTED' : 'RECEIVED'
      // Use updateMany so the Prisma extension's `OR: []` injection is valid syntax.
      await tx.transfer.updateMany({
        where: { id },
        data:  { status: newStatus, receivedBy, receivedAt: new Date() },
      })

      if (hasDispute && totalShrinkageValue > 0) {
        await buildShrinkageJournalEntry(
          tx, t.transferNo, totalShrinkageValue, t.toChannelId, receivedBy
        )
      }
    })

    return this.findById(id)
  }

  async cancel(id: string, cancelledBy: string) {
    const transfer = await this.findById(id)
    const t        = transfer as any

    if (t.status !== 'SENT') {
      throw { statusCode: 400, message: `Only SENT transfers can be cancelled. Current: ${t.status}` }
    }

    await prisma.$transaction(async (tx: TransactionClient) => {
      for (const line of t.lines ?? []) {
        await tx.stockMovement.create({
          data: {
            itemId:         line.itemId,
            channelId:      t.fromChannelId,
            movementType:   'ADJUSTMENT_IN',
            quantityChange: line.sentQuantity,
            referenceId:    id,
            referenceType:  'transfer_cancel',
            performedBy:    cancelledBy,
          },
        })
        await tx.$executeRaw`
          UPDATE inventory_balances
          SET "availableQty" = "availableQty" + ${line.sentQuantity}
          WHERE "itemId" = ${line.itemId}::text AND "channelId" = ${t.fromChannelId}::text
        `
        await tx.stockMovement.create({
          data: {
            itemId:         line.itemId,
            channelId:      t.toChannelId,
            movementType:   'TRANSFER_IN_PENDING',
            quantityChange: -(line.sentQuantity),
            referenceId:    id,
            referenceType:  'transfer_cancel',
            performedBy:    cancelledBy,
          },
        })
        // FIX: this matched every TRANSFERRED serial of the item at the source
        // channel, so cancelling one transfer returned to stock the units still
        // in flight on any other transfer of the same item. Restore only the
        // units stamped with this line; for pre-stamp transfers, restore at most
        // the quantity this line sent rather than the item's entire in-flight set.
        const stamped = await tx.serial.updateMany({
          where: { transferLineId: line.id, channelId: t.fromChannelId, status: 'TRANSFERRED' },
          data:  { status: 'IN_STOCK', transferLineId: null },
        })
        if (stamped.count === 0) {
          const legacySerials = await tx.serial.findMany({
            where:   { itemId: line.itemId, channelId: t.fromChannelId, status: 'TRANSFERRED', transferLineId: null },
            orderBy: { id: 'asc' },
            take:    line.sentQuantity,
            select:  { id: true },
          })
          if (legacySerials.length > 0) {
            await tx.serial.updateMany({
              where: { id: { in: legacySerials.map((s: any) => s.id) }, channelId: t.fromChannelId },
              data:  { status: 'IN_STOCK' },
            })
          }
        }
      }
    })

    await basePrisma.transfer.update({
      where: { id },
      data:  {
        status: 'REJECTED',
        notes:  t.notes ? `${t.notes}\nCancelled by ${cancelledBy}` : `Cancelled by ${cancelledBy}`,
      },
    })

    return this.findById(id)
  }

  async findAll(query: {
    channelId?: string
    status?:    string
    page?:      number
    limit?:     number
    startDate?: string
    endDate?:   string
  }) {
    const page  = query.page  ?? 1
    const limit = Math.min(query.limit ?? 25, 100)
    const skip  = (page - 1) * limit

    const where: Prisma.TransferWhereInput = {
      ...(query.status    && { status: query.status as any }),
      ...(query.channelId && {
        OR: [{ fromChannelId: query.channelId }, { toChannelId: query.channelId }],
      }),
      ...(query.startDate || query.endDate ? {
        createdAt: {
          ...(query.startDate && { gte: new Date(query.startDate) }),
          ...(query.endDate   && { lte: new Date(query.endDate) }),
        },
      } : {}),
    }

    const [data, total] = await Promise.all([
      basePrisma.transfer.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          fromChannel: { select: { id: true, name: true } },
          toChannel:   { select: { id: true, name: true } },
          lines: { include: { item: { select: { name: true, sku: true } } } },
        },
      }),
      basePrisma.transfer.count({ where }),
    ])

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }
  }

  async findById(id: string) {
    return basePrisma.transfer.findUniqueOrThrow({
      where:   { id },
      include: {
        fromChannel: true,
        toChannel:   true,
        lines: { include: { item: true } },
      },
    })
  }
}

export const transfersService = new TransfersService()
