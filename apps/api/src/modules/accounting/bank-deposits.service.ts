import { prisma } from '../../lib/prisma.js'
import { buildBankDepositJournalEntry } from '../../lib/ledger.js'

export class BankDepositsService {
  async listBanks(channelId?: string) {
    return prisma.channelBank.findMany({
      where: { isActive: true, ...(channelId && { channelId }) },
      orderBy: { bankName: 'asc' },
    })
  }

  async createBank(data: {
    channelId: string; bankName: string; accountName: string
    accountNumber: string; paybill?: string; branch?: string
  }) {
    return prisma.channelBank.create({ data })
  }

  async listDeposits(query: {
    channelId?: string; startDate?: string; endDate?: string
    page?: number; limit?: number
  }) {
    const page  = query.page  ?? 1
    const limit = query.limit ?? 25
    const skip  = (page - 1) * limit

    const where = {
      ...(query.channelId && { channelId: query.channelId }),
      ...(query.startDate || query.endDate ? {
        depositedAt: {
          ...(query.startDate && { gte: new Date(query.startDate) }),
          ...(query.endDate   && { lte: new Date(query.endDate) }),
        },
      } : {}),
    }

    const [data, total] = await Promise.all([
      prisma.bankDeposit.findMany({
        where, skip, take: limit,
        orderBy: { depositedAt: 'desc' },
        include: { channel: { select: { id: true, name: true } } },
      }),
      prisma.bankDeposit.count({ where }),
    ])

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }
  }

  async create(data: { channelId: string; amount: number; reference?: string; notes?: string; depositedBy: string }) {
    const bank = await prisma.channelBank.findFirst({
      where: { channelId: data.channelId, isActive: true },
      select: { id: true },
    })
    if (!bank) {
      throw { statusCode: 400, message: 'No active bank account configured for this channel — add one first' }
    }

    return prisma.$transaction(async (tx) => {
      const deposit = await tx.bankDeposit.create({
        data: {
          channelId:   data.channelId,
          amount:      data.amount,
          reference:   data.reference,
          notes:       data.notes,
          depositedBy: data.depositedBy,
        },
      })

      await buildBankDepositJournalEntry(tx as any, deposit.id, data.amount, data.channelId, data.depositedBy)

      return deposit
    })
  }

  /** Cash-at-hand reconciliation: today's cash sales minus what's already been deposited today. */
  async cashPosition(channelId?: string) {
    const now    = new Date()
    const eatNow = new Date(now.getTime() + 3 * 60 * 60 * 1000)
    const today  = new Date(eatNow.toISOString().slice(0, 10) + 'T00:00:00+03:00')

    const [cashSales, deposits] = await Promise.all([
      prisma.payment.aggregate({
        where: {
          method: 'CASH',
          status: 'CONFIRMED',
          createdAt: { gte: today },
          sale: { deletedAt: null, ...(channelId && { channelId }) },
        },
        _sum: { amount: true },
      }),
      prisma.bankDeposit.aggregate({
        where: { depositedAt: { gte: today }, ...(channelId && { channelId }) },
        _sum: { amount: true },
      }),
    ])

    const todayCashSales = Number(cashSales._sum.amount ?? 0)
    const todayDeposited = Number(deposits._sum.amount ?? 0)

    return {
      todayCashSales,
      todayDeposited,
      cashAtHand: Math.max(0, todayCashSales - todayDeposited),
    }
  }
}

export const bankDepositsService = new BankDepositsService()
