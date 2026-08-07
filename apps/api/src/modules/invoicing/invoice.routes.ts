import type { FastifyPluginAsync } from 'fastify'
import { invoiceService } from './invoice.service.js'
import { authenticate }   from '../../middleware/authenticate.js'
import { authorize }      from '../../middleware/authorize.js'
import { z }              from 'zod'
import { createInvoiceSchema, listInvoicesQuerySchema, recordPaymentSchema } from './invoice.schema.js'

const HQ_INVOICE_ROLES = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export const invoiceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // ── List invoices/quotations/proformas ──────────────────────────────
  app.get('/', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER')],
  }, async (request) => {
    const query = listInvoicesQuerySchema.parse(request.query)

    if (!HQ_INVOICE_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      query.channelId = request.user.channelId
    }

    return invoiceService.findAll(query)
  })

  // ── Get by ID ────────────────────────────────────────────────────────
  app.get('/:id', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER')],
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const isHQ   = HQ_INVOICE_ROLES.includes(request.user.role)
    if (!isHQ && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    return invoiceService.findById(id, isHQ ? undefined : request.user.channelId!)
  })

  // ── Create quotation / proforma / invoice ───────────────────────────
  app.post('/', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER')],
  }, async (request, reply) => {
    const body = createInvoiceSchema.parse(request.body)

    if (!HQ_INVOICE_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      if (body.channelId !== request.user.channelId) {
        throw { statusCode: 403, message: 'You can only create documents for your assigned channel' }
      }
    }

    const invoice = await invoiceService.create({ ...body, createdBy: request.user.sub })
    reply.status(201).send(invoice)
  })

  // ── Convert a quotation/proforma into a proforma/invoice ────────────
  app.post('/:id/convert', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { targetType } = z.object({ targetType: z.enum(['PROFORMA', 'INVOICE']) }).parse(request.body)
    const isHQ = HQ_INVOICE_ROLES.includes(request.user.role)

    const invoice = await invoiceService.convert(
      id, targetType, request.user.sub, isHQ ? undefined : request.user.channelId!
    )
    reply.status(201).send(invoice)
  })

  // ── Mark as sent ─────────────────────────────────────────────────────
  app.post('/:id/send', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER')],
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const isHQ   = HQ_INVOICE_ROLES.includes(request.user.role)
    return invoiceService.markSent(id, isHQ ? undefined : request.user.channelId!)
  })

  // ── Record a payment against an invoice ─────────────────────────────
  app.post('/:id/payments', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER')],
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { amount, paymentMethod } = recordPaymentSchema.parse(request.body)
    const isHQ   = HQ_INVOICE_ROLES.includes(request.user.role)
    return invoiceService.recordPayment(id, amount, paymentMethod, request.user.sub, isHQ ? undefined : request.user.channelId!)
  })

  // ── Void ─────────────────────────────────────────────────────────────
  app.post('/:id/void', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const isHQ   = HQ_INVOICE_ROLES.includes(request.user.role)
    return invoiceService.void(id, request.user.sub, isHQ ? undefined : request.user.channelId!)
  })
}
