import { prisma }        from '../../lib/prisma.js'
import type { FastifyPluginAsync } from 'fastify'
import { authenticate }  from '../../middleware/authenticate.js'
import { authorize }     from '../../middleware/authorize.js'
import { RATE }          from '../../lib/rate-limit.plugin.js'

export const receiptsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // GET /receipts/:saleId
  app.get('/:saleId', {
    config:     RATE.READ,
    preHandler: [authorize(
      'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER',
      'CASHIER', 'SALES_PERSON', 'PROMOTER',
    )],
  }, async (request, reply) => {
    const { saleId } = request.params as { saleId: string }

    const sale = await prisma.sale.findFirst({
      where: {
        id:        saleId,
        deletedAt: null,
      },
      include: {
        items:    { include: { item: { select: { name: true, sku: true } } } },
        payments: true,
        customer: { select: { name: true, phone: true } },
        channel:  { include: { settings: true } },
      },
    })

    if (!sale) {
      return reply.status(404).send({ error: 'Receipt not found or sale has been voided' })
    }

    const cashierUser = await prisma.user.findUnique({
      where:  { id: sale.performedBy },
      select: { username: true },
    })

    // Channel scoping
    if (!['PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN'].includes(request.user.role)) {
      if (sale.channelId !== request.user.channelId) {
        return reply.status(403).send({
          error:   'Forbidden',
          message: 'You do not have access to this receipt',
        })
      }
    }

    return {
      receiptNo: sale.receiptNo,
      channel:   sale.channel,
      customer:  sale.customer,
      items: sale.items.map(i => ({
        name:      i.item.name,
        sku:       i.item.sku,
        quantity:  i.quantity,
        unitPrice: Number(i.unitPrice),
        lineTotal: Number(i.lineTotal),
        discount:  Number(i.discountAmount ?? 0),
      })),
      totals: {
        subtotal: Number(sale.totalAmount),
        discount: Number(sale.discountAmount),
        tax:      Number(sale.taxAmount),
        total:    Number(sale.netAmount),
      },
      payments: sale.payments.map(p => ({
        method:    p.method,
        amount:    Number(p.amount),
        reference: p.reference,
      })),
      cashier: cashierUser?.username,
      vatPIN:  (sale.channel.settings as any)?.find((s: any) => s.key === 'bizSettings')?.value?.vatNumber,
      date:    sale.createdAt,
    }
  })

  // GET /receipts/public/:saleId (No authentication required)
  app.get('/public/:saleId', {
    config: {
      rateLimit: {
        max:        20,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const { saleId } = request.params as { saleId: string }

    const sale = await prisma.sale.findFirst({
      where: { id: saleId, deletedAt: null },
      include: {
        items:    { include: { item: { select: { name: true, sku: true } } } },
        payments: true,
        channel:  { include: { settings: true } },
      },
    })

    if (!sale) return reply.status(404).send({ error: 'Receipt not found' })

    const cashierUser = await prisma.user.findUnique({
      where:  { id: sale.performedBy },
      select: { username: true },
    })

    return {
      receiptNo: sale.receiptNo,
      channel:   {
        name:    sale.channel.name,
        address: sale.channel.address,
        phone:   sale.channel.phone,
        email:   sale.channel.email,
      },
      items: sale.items.map(i => ({
        name:      i.item.name,
        quantity:  i.quantity,
        unitPrice: Number(i.unitPrice),
        lineTotal: Number(i.lineTotal),
      })),
      totals: {
        subtotal: Number(sale.totalAmount),
        discount: Number(sale.discountAmount),
        total:    Number(sale.netAmount),
      },
      payments: sale.payments.map(p => ({
        method:    p.method,
        amount:    Number(p.amount),
        reference: p.reference,
      })),
      cashier: cashierUser?.username,
      date:    sale.createdAt,
    }
  })
}
