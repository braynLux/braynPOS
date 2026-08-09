import { basePrisma, prisma } from '../../lib/prisma.js'
import { logAction, AUDIT } from '../../lib/audit.js'

export class SessionsService {
  async open(userId: string, channelId: string, openingFloat: number, actorRole: string) {
    // FIX: check-then-create raced — a double-tap or client retry could send
    // two concurrent opens that both pass the "no existing OPEN session" check
    // before either INSERT commits, leaving two OPEN sessions for one cashier.
    // An advisory lock scoped to (userId, channelId) serializes the pair so the
    // second call always sees the first's session once it holds the lock.
    const session = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId} || ':' || ${channelId}))`

      const existing = await tx.salesSession.findFirst({
        where: { userId, channelId, status: 'OPEN' },
      })
      if (existing) {
        throw { statusCode: 409, message: 'You already have an open session at this channel' }
      }

      return tx.salesSession.create({
        data: { userId, channelId, openingFloat, status: 'OPEN' },
      })
    })

    // FIX 4: Audit log session openings
    logAction({
      action:     AUDIT.SESSION_OPEN,
      actorId:    userId,
      actorRole,
      channelId,
      targetType: 'sales_session',
      targetId:   session.id,
      newValues:  { openingFloat },
    })

    return session
  }

  async close(
    sessionId:    string,
    closingFloat: number,
    actorId:      string,
    actorRole:    string,
    notes?:       string
  ) {
    const session = await prisma.salesSession.findUniqueOrThrow({
      where: { id: sessionId },
    })

    if (session.status === 'CLOSED') {
      throw { statusCode: 400, message: 'Session is already closed' }
    }

    const isOwner   = session.userId === actorId
    const isManager = ['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER'].includes(actorRole)
    if (!isOwner && !isManager) {
      throw { statusCode: 403, message: 'You can only close your own session' }
    }

    const [salesTotal, refundsTotal] = await Promise.all([
      prisma.payment.aggregate({
        where: { sale: { sessionId }, method: 'CASH', status: 'CONFIRMED' },
        _sum: { amount: true },
      }),
      prisma.$queryRaw<Array<{ total: number }>>`
        SELECT COALESCE(SUM(p.amount), 0) AS total
        FROM payments p
        JOIN sales s ON s.id = p."saleId"
        WHERE s."sessionId" = ${sessionId}
          AND p.method       = 'CASH'
          AND p.status       = 'CONFIRMED'
          AND s."deletedAt"  IS NOT NULL
      `,
    ])

    const cashIn        = Number(salesTotal._sum.amount ?? 0)
    const cashRefunds   = Number(refundsTotal[0]?.total   ?? 0)
    const expectedFloat = Number(session.openingFloat) + cashIn - cashRefunds
    const variance      = closingFloat - expectedFloat

    const updated = await prisma.salesSession.update({
      where: { id: sessionId },
      data: { closingFloat, expectedFloat, variance, status: 'CLOSED', closedAt: new Date(), notes },
    })

    // FIX 4: Audit log session closures with variance
    logAction({
      action:     AUDIT.SESSION_CLOSE,
      actorId,
      actorRole,
      channelId:  session.channelId,
      targetType: 'sales_session',
      targetId:   sessionId,
      newValues:  { expectedFloat, closingFloat, variance, notes },
    })

    return updated
  }

  async findById(id: string) {
    return basePrisma.salesSession.findUniqueOrThrow({
      where:   { id },
      include: {
        user: { select: { id: true, username: true } },
        channel: { select: { id: true, name: true, code: true } },
        _count: { select: { sales: true } },
      },
    })
  }

  async getActiveSession(userId: string) {
    return prisma.salesSession.findFirst({
      where: { userId, status: 'OPEN' },
      include: { channel: { select: { id: true, name: true, code: true } } },
    })
  }

  async findAll(channelId?: string, page = 1, limit = 25) {
    const skip = (page - 1) * limit
    const where: any = { ...(channelId && { channelId }) }

    const [data, total] = await Promise.all([
      prisma.salesSession.findMany({
        where, skip, take: limit, orderBy: { openedAt: 'desc' },
        include: { user: { select: { id: true, username: true } }, channel: { select: { id: true, name: true } } },
      }),
      prisma.salesSession.count({ where }),
    ])

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }
  }
}

export const sessionsService = new SessionsService()
