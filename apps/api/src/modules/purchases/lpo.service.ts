import { prisma } from '../../lib/prisma.js'
import type { Prisma } from '@prisma/client'
 
export class LpoService {
  async create(data: {
    supplierId: string
    channelId: string
    lines: Array<{ itemId: string; quantity: number; unitCost: number }>
    notes?: string
    createdBy: string
    expectedDate?: string
  }) {
    const orderNo = `LPO-${Date.now()}`

    const supplier = await prisma.supplier.findUnique({
      where:  { id: data.supplierId },
      select: { channelId: true, deletedAt: true },
    })
    if (!supplier || supplier.deletedAt) {
      throw { statusCode: 404, message: 'Supplier not found' }
    }
    if (supplier.channelId && supplier.channelId !== data.channelId) {
      throw { statusCode: 403, message: 'Supplier does not belong to the LPO channel' }
    }
 
    return prisma.purchaseOrder.create({
      data: {
        orderNo,
        supplierId: data.supplierId,
        channelId: data.channelId,
        notes: data.notes,
        expectedDate: data.expectedDate,
        createdBy: data.createdBy,
        lines: {
          create: data.lines.map(l => ({
            itemId: l.itemId,
            quantity: l.quantity,
            unitCost: l.unitCost,
          })),
        },
      },
      include: { lines: { include: { item: true } }, supplier: true },
    })
  }
 
  async findAll(query: { channelId?: string; status?: string; page?: number; limit?: number }) {
    const page = query.page ?? 1
    const limit = query.limit ?? 25
    const skip = (page - 1) * limit
 
    const where: Prisma.PurchaseOrderWhereInput = {
      ...(query.channelId && { channelId: query.channelId }),
      ...(query.status && { status: query.status as Prisma.EnumLpoStatusFilter }),
    }
 
    const [data, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: { supplier: { select: { id: true, name: true } }, _count: { select: { lines: true } } },
      }),
      prisma.purchaseOrder.count({ where }),
    ])
 
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }
  }
 
  async findById(id: string, channelId?: string) {
    return prisma.purchaseOrder.findFirstOrThrow({
      where: { id, ...(channelId && { channelId }) },
      include: {
        supplier: true,
        channel: true,
        lines: { include: { item: { select: { id: true, name: true, sku: true } } } },
      },
    })
  }
 
  async send(id: string, channelId?: string) {
    const order = await this.findById(id, channelId)
    if (order.status !== 'DRAFT') {
      throw { statusCode: 400, message: `Only draft LPOs can be sent. Current: ${order.status}` }
    }
    return prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'SENT' },
    })
  }
 
  async cancel(id: string, channelId?: string) {
    const order = await this.findById(id, channelId)
    if (['FULFILLED', 'CANCELLED'].includes(order.status)) {
      throw { statusCode: 400, message: `Cannot cancel a ${order.status.toLowerCase()} LPO` }
    }
    return prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED' },
    })
  }
}
 
export const lpoService = new LpoService()
