import { prisma } from '../../lib/prisma.js'
import { logAction, AUDIT } from '../../lib/audit.js'

export class AuditService {
  /**
   * Authoritatively swaps or corrects a serial number on a specific sale item.
   * This is a forensic tool for correcting "fat-finger" errors.
   */
  async swapSerialNumber(data: {
    saleId:      string
    itemId:      string
    oldSerialId: string | null
    newSerialNo: string
    reason:      string
    actorId:     string
  }) {
    const { saleId, itemId, oldSerialId, newSerialNo, reason, actorId } = data

    return prisma.$transaction(async (tx) => {
      // 1. Verify the sale and item association
      const saleItem = await tx.saleItem.findFirstOrThrow({
        where: { saleId, itemId },
        include: { sale: { select: { channelId: true } } },
      })

      // 2. Fetch actor info for auditing
      const actor = await tx.user.findUniqueOrThrow({
        where: { id: actorId },
        select: { role: true, channelId: true }
      })

      // 3. Find/Verify the specific serial record if oldId provided
      // If oldId is null, we are attaching a serial to a non-serialized sale (if allowed)
      let oldSerialNo = 'NONE'
      let serialIdForSale = oldSerialId
      if (oldSerialId) {
        const serialRecord = await tx.serial.findUniqueOrThrow({
          where: { id: oldSerialId }
        })
        if (serialRecord.itemId !== itemId || serialRecord.channelId !== saleItem.sale.channelId) {
          throw { statusCode: 422, message: 'Old serial does not belong to this sale item and channel' }
        }
        if (saleItem.serialId && saleItem.serialId !== oldSerialId) {
          throw { statusCode: 422, message: 'Old serial does not match the serial currently attached to this sale line' }
        }
        oldSerialNo = serialRecord.serialNo
        
        // Update the existing record or create a replacement audit
        await tx.serial.update({
          where: { id: oldSerialId },
          data: { 
            serialNo: newSerialNo,
            status:   'SOLD',
            saleId,
            updatedAt: new Date()
          }
        })
      } else {
        const existingSerial = await tx.serial.findUnique({
          where: {
            serialNo_itemId_channelId: {
              serialNo:  newSerialNo,
              itemId,
              channelId: saleItem.sale.channelId,
            },
          },
        })

        if (existingSerial?.saleId && existingSerial.saleId !== saleId) {
          throw { statusCode: 422, message: 'New serial is already attached to another sale' }
        }

        const serial = existingSerial
          ? await tx.serial.update({
              where: { id: existingSerial.id },
              data:  { status: 'SOLD', saleId, deletedAt: null },
            })
          : await tx.serial.create({
              data: {
                serialNo:  newSerialNo,
                itemId,
                channelId: saleItem.sale.channelId,
                status:    'SOLD',
                saleId,
              },
            })
        serialIdForSale = serial.id
      }

      await tx.saleItem.update({
        where: { id: saleItem.id },
        data:  { serialId: serialIdForSale },
      })

      // 4. Log the Serial Audit specifically
      await tx.serialAudit.create({
        data: {
          serialId:     serialIdForSale || 'NEW',
          action:       'SWAP',
          oldSerialNo,
          newSerialNo,
          reason,
          performedBy:  actorId,
        }
      })

      // 5. Log the general system Action Audit
      logAction({
        action:     AUDIT.SERIAL_ADJUST,
        actorId,
        actorRole:  actor.role,
        channelId:  actor.channelId || 'HQ',
        targetType: 'Sale',
        targetId:   saleId,
        newValues:  { oldSerialNo, newSerialNo, reason }
      })

      return {
        success: true,
        message: `Serial swapped from ${oldSerialNo} to ${newSerialNo}`,
        auditId: saleId
      }
    })
  }

  async getSerialAudits(limit = 20) {
    return (prisma as any).serialAudit.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit
    })
  }
}

export const auditService = new AuditService()
