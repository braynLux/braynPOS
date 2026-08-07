import { prisma } from '../../lib/prisma.js'
import { Prisma } from '@prisma/client'
import type { CreateInvoiceInput, ListInvoicesQuery } from './invoice.schema.js'
import { buildInvoiceJournalEntry, buildInvoiceVoidJournalEntry, buildInvoicePaymentJournalEntry } from '../../lib/ledger.js'

const DOC_PREFIX: Record<string, string> = {
  QUOTATION: 'QUO',
  PROFORMA:  'PRO',
  INVOICE:   'INV',
}

function generateDocNo(type: string) {
  const uniqueSuffix = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `${DOC_PREFIX[type] || 'INV'}-${Date.now()}-${uniqueSuffix}`
}

export class InvoiceService {
  async create(data: CreateInvoiceInput & { createdBy: string; convertedFromId?: string }) {
    const customer = await prisma.customer.findUnique({
      where:  { id: data.customerId },
      select: { channelId: true, deletedAt: true },
    })
    if (!customer || customer.deletedAt) {
      throw { statusCode: 404, message: 'Customer not found' }
    }
    if (customer.channelId && customer.channelId !== data.channelId) {
      throw { statusCode: 403, message: 'Customer does not belong to this channel' }
    }

    if (data.selectedBankId) {
      const bank = await prisma.channelBank.findFirst({
        where:  { id: data.selectedBankId, channelId: data.channelId, isActive: true },
        select: { id: true },
      })
      if (!bank) {
        throw { statusCode: 400, message: 'Selected bank account does not belong to this channel' }
      }
    }

    const lineDiscountTotal = data.lines.reduce((s, l) => s + (l.discountAmount ?? 0), 0)
    const subtotal = data.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
    const totalAmount = Math.max(0, subtotal - lineDiscountTotal - data.discountAmount + (data.taxExempt ? 0 : data.taxAmount))

    // FIX: invoices previously never touched the ledger — a B2B invoice
    // created Accounts Receivable in name only, invisible to the Trial
    // Balance, P&L, Balance Sheet, and AR Aging Report. QUOTATION/PROFORMA
    // are non-binding and must NOT post; only a real INVOICE creates AR.
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          invoiceNo:       generateDocNo(data.type),
          type:            data.type,
          status:          'DRAFT',
          channelId:       data.channelId,
          customerId:      data.customerId,
          subtotal,
          discountAmount:  data.discountAmount + lineDiscountTotal,
          taxAmount:       data.taxExempt ? 0 : data.taxAmount,
          totalAmount,
          dueDate:         data.dueDate ? new Date(data.dueDate) : null,
          notes:           data.notes,
          customerOrderNo: data.customerOrderNo,
          quotationRefNo:  data.quotationRefNo,
          taxExempt:       data.taxExempt,
          terms:           data.terms,
          selectedBankId:  data.selectedBankId,
          createdBy:       data.createdBy,
          convertedFromId: data.convertedFromId,
          lines: {
            create: data.lines.map(l => ({
              itemId:         l.itemId,
              description:    l.description,
              quantity:       l.quantity,
              unitPrice:      l.unitPrice,
              discountAmount: l.discountAmount ?? 0,
              lineTotal:      l.quantity * l.unitPrice - (l.discountAmount ?? 0),
            })),
          },
        },
        include: { lines: true, customer: { select: { id: true, name: true } }, bank: true },
      })

      if (invoice.type === 'INVOICE') {
        await buildInvoiceJournalEntry(tx as any, invoice, data.createdBy)
      }

      return invoice
    })
  }

  async findAll(query: ListInvoicesQuery) {
    const page  = query.page  ?? 1
    const limit = query.limit ?? 25
    const skip  = (page - 1) * limit

    const where: Prisma.InvoiceWhereInput = {
      ...(query.channelId  && { channelId: query.channelId }),
      ...(query.customerId && { customerId: query.customerId }),
      ...(query.type        && { type: query.type }),
      ...(query.status      && { status: query.status }),
      ...(query.search && {
        OR: [
          { invoiceNo: { contains: query.search, mode: 'insensitive' } },
          { customer:  { name: { contains: query.search, mode: 'insensitive' } } },
        ],
      }),
      ...(query.startDate || query.endDate ? {
        createdAt: {
          ...(query.startDate && { gte: new Date(query.startDate) }),
          ...(query.endDate   && { lte: new Date(query.endDate) }),
        },
      } : {}),
    }

    const [data, total] = await Promise.all([
      prisma.invoice.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          channel:  { select: { id: true, name: true } },
          _count:   { select: { lines: true } },
        },
      }),
      prisma.invoice.count({ where }),
    ])

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }
  }

  async findById(id: string, channelId?: string) {
    return prisma.invoice.findFirstOrThrow({
      where: { id, ...(channelId && { channelId }) },
      include: {
        customer:      true,
        channel:       true,
        creator:       { select: { id: true, username: true } },
        lines:         { include: { item: { select: { id: true, name: true, sku: true } } } },
        convertedFrom: { select: { id: true, invoiceNo: true, type: true } },
        convertedTo:   { select: { id: true, invoiceNo: true, type: true } },
        bank:          true,
      },
    })
  }

  /** Turn a QUOTATION or PROFORMA into an INVOICE, preserving its lines. */
  async convert(id: string, targetType: 'PROFORMA' | 'INVOICE', createdBy: string, channelId?: string) {
    const source = await this.findById(id, channelId)

    if (source.status === 'VOID') {
      throw { statusCode: 400, message: 'Cannot convert a voided document' }
    }
    if (source.type === 'INVOICE') {
      throw { statusCode: 400, message: 'This document is already an invoice' }
    }
    if (source.convertedTo) {
      throw { statusCode: 400, message: 'This document has already been converted' }
    }

    return this.create({
      type:            targetType,
      channelId:       source.channelId,
      customerId:      source.customerId,
      lines: source.lines.map(l => ({
        itemId:         l.itemId ?? undefined,
        description:    l.description,
        quantity:       Number(l.quantity),
        unitPrice:      Number(l.unitPrice),
        discountAmount: 0,
      })),
      discountAmount:  Number(source.discountAmount),
      taxAmount:       Number(source.taxAmount),
      notes:           source.notes ?? undefined,
      customerOrderNo: source.customerOrderNo ?? undefined,
      quotationRefNo:  source.quotationRefNo ?? undefined,
      taxExempt:       source.taxExempt,
      terms:           source.terms ?? undefined,
      selectedBankId:  source.selectedBankId ?? undefined,
      createdBy,
      convertedFromId: source.id,
    })
  }

  async recordPayment(id: string, amount: number, paymentMethod: string, postedBy: string, channelId?: string) {
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirstOrThrow({
        where: { id, ...(channelId && { channelId }) },
      })
      if (invoice.type !== 'INVOICE') {
        throw { statusCode: 400, message: 'Only invoices accept payments — convert this document first' }
      }
      if (invoice.status === 'VOID') {
        throw { statusCode: 400, message: 'Cannot record payment against a voided invoice' }
      }

      const newAmountPaid = Number(invoice.amountPaid) + amount
      if (newAmountPaid > Number(invoice.totalAmount) + 0.01) {
        throw { statusCode: 422, message: 'Payment exceeds the outstanding balance' }
      }

      const status = newAmountPaid >= Number(invoice.totalAmount)
        ? 'PAID'
        : newAmountPaid > 0 ? 'PARTIALLY_PAID' : invoice.status

      const updated = await tx.invoice.update({
        where: { id },
        data:  { amountPaid: newAmountPaid, status },
      })

      // FIX: payments were only ever recorded on the Invoice row itself —
      // Cash/Bank never moved and Accounts Receivable never cleared on the
      // actual books, so a "PAID" invoice still showed as outstanding AR.
      await buildInvoicePaymentJournalEntry(tx as any, invoice, amount, paymentMethod, postedBy)

      return updated
    })
  }

  async markSent(id: string, channelId?: string) {
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { id, ...(channelId && { channelId }) },
    })
    if (invoice.status !== 'DRAFT') {
      throw { statusCode: 400, message: 'Only draft documents can be marked as sent' }
    }
    return prisma.invoice.update({ where: { id }, data: { status: 'SENT' } })
  }

  async void(id: string, postedBy: string, channelId?: string) {
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirstOrThrow({
        where: { id, ...(channelId && { channelId }) },
      })
      if (invoice.status === 'VOID') {
        throw { statusCode: 400, message: 'Document is already void' }
      }
      if (Number(invoice.amountPaid) > 0) {
        throw { statusCode: 400, message: 'Cannot void an invoice with recorded payments' }
      }

      const updated = await tx.invoice.update({ where: { id }, data: { status: 'VOID', voidedAt: new Date() } })

      // Only INVOICE-type documents ever posted (see create()) — reverse
      // that same entry, or a voided invoice keeps sitting on the Balance
      // Sheet as live Accounts Receivable forever.
      if (invoice.type === 'INVOICE') {
        await buildInvoiceVoidJournalEntry(tx as any, invoice, postedBy)
      }

      return updated
    })
  }
}

export const invoiceService = new InvoiceService()
