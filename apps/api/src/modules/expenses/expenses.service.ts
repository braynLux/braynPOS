import { prisma }                      from '../../lib/prisma.js'
import { buildExpenseJournalEntry,
         buildExpenseReversalJournalEntry } from '../../lib/ledger.js'
import { eventBus }                   from '../../lib/event-bus.js'

export class ExpensesService {
  async create(data: {
    channelId:      string
    description:    string
    amount:         number
    category?:      string
    receiptRef?:    string
    notes?:         string
    paymentSource?: 'CASH' | 'BANK' | 'CREDITOR' | 'CAPITAL'
    createdBy:      string
  }) {
    return prisma.$transaction(async (tx) => {
      const strictAmount = Math.round(data.amount * 100) / 100;

      const expense = await tx.expense.create({
        data: {
          channelId:     data.channelId,
          description:   data.description,
          amount:        strictAmount,
          category:      data.category   ?? null,
          receiptRef:    data.receiptRef ?? null,
          notes:         data.notes      ?? null,
          paymentSource: data.paymentSource ?? 'CASH',
          createdBy:     data.createdBy,
        },
      })

      await buildExpenseJournalEntry(tx, expense, data.createdBy)

      eventBus.emit('expense.created', {
        expenseId: expense.id,
        channelId: expense.channelId,
        amount:    Number(expense.amount),
      })

      return expense
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
    // FIX: Cap limit to prevent full-table dumps
    const limit = Math.min(query.limit ?? 25, 100)
    const skip  = (page - 1) * limit

    const where = {
      // FIX 4: Exclude soft-deleted expenses from list results
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
      prisma.expense.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: { channel: { select: { id: true, name: true } } },
      }),
      prisma.expense.count({ where }),
    ])

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }
  }

  async findById(id: string, channelId?: string) {
    return prisma.expense.findFirstOrThrow({
      where:   { id, deletedAt: null, ...(channelId && { channelId }) },
      include: { channel: true },
    })
  }

  // FIX 1: Corrected signature — channelId is optional (undefined for HQ),
  // deletedBy is the actor performing the delete.
  // Previously the route was calling softDelete(id, actorId) which passed
  // the user ID as channelId and left deletedBy as undefined.
  async softDelete(id: string, channelId: string | undefined, deletedBy: string) {
    return prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findFirstOrThrow({
        where: {
          id,
          deletedAt: null,
          ...(channelId && { channelId }),
        },
      })

      if (expense.deletedAt) {
        throw { statusCode: 400, message: 'Expense is already deleted' }
      }

      await buildExpenseReversalJournalEntry(tx, expense, deletedBy)

      return tx.expense.update({
        where: { id },
        data:  { deletedAt: new Date() },
      })
    })
  }
}

export const expensesService = new ExpensesService()
