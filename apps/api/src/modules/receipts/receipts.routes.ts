import { prisma }        from '../../lib/prisma.js'
import type { FastifyPluginAsync } from 'fastify'
import { authenticate }  from '../../middleware/authenticate.js'
import { authorize }     from '../../middleware/authorize.js'
import { RATE }          from '../../lib/rate-limit.plugin.js'

export const receiptsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // GET /receipts/:saleId
  // FIX 1: Added authorize() — was completely open to any authenticated user
  // FIX 1: Added channel scoping — CASHIER from Channel A could fetch
  //       receipts for sales from Channel B
  // FIX 10: Added deletedAt: null — voided sales were still returning receipts
  // FIX 1: Added RATE.READ
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
        // FIX 10: Exclude voided/reversed sales — a reversed sale is no
        // longer valid and should not generate a printable receipt.
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

    // FIX 1: Channel scoping — non-admin roles may only retrieve receipts
    // for sales from their own channel
    if (!['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN'].includes(request.user.role)) {
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
        method: p.method,
        amount: Number(p.amount),
      })),
      cashier: cashierUser?.username,
      vatPIN:  (sale.channel.settings as any)?.find((s: any) => s.key === 'bizSettings')?.value?.vatNumber,
      date:    sale.createdAt,
    }
  })

  // GET /receipts/public/:saleId (No authentication required)
  // Audit finding: Permanent Digital Receipt Links
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

    // Sanitize: No PII besides name if public
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
        method: p.method,
        amount: Number(p.amount),
      })),
      cashier: cashierUser?.username,
      date:    sale.createdAt,
    }
  })
}
