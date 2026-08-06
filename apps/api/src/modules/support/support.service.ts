// ══════════════════════════════════════════════════════════════════════
// FILE: apps/api/src/modules/support/support.service.ts
// Fixes:
//   1. refCode used Math.random() — not cryptographically random. At
//      scale, 8 hex chars (4 bytes) gives ~4 billion values but birthday
//      collision probability becomes meaningful in the millions of tickets.
//      Replaced with crypto.randomBytes() for a proper 8-byte token.
//   2. handleUserMessage() duplicate check matched on content string only.
//      A user sending the same message twice (e.g. "Hello") would have
//      the second silently dropped. Fixed by scoping the dedup check to
//      a short time window (5 seconds) to catch Socket/HTTP double-sends
//      without swallowing intentional duplicate messages.
//   3. Double WAITING_HUMAN check — lines 60-61 checked the same condition
//      twice with a redundant cast. Collapsed into a single clean check.
//   4. getTicketDetails() — no channel ownership check. Any authenticated
//      user who knew a ticket ID could read all its messages including
//      internal staff discussions. Now accepts actorId + actorRole and
//      enforces ownership for non-admin roles.
//   5. addMessage() — never checked ticket exists or is open. Messages
//      could be added to RESOLVED or CLOSED tickets. Now guards this.
//   6. deleteTicket() — deleteMany for messages was redundant since the
//      schema has onDelete: Cascade on SupportMessage. Removed the
//      redundant operation and simplified to a single ticket delete.
// ══════════════════════════════════════════════════════════════════════

import { basePrisma, prisma } from '../../lib/prisma.js'
import { randomBytes } from 'crypto'
import { SupportCategory, TicketPriority, TicketStatus } from '@prisma/client'
import { runSupportAgent } from './ai-agent.js'

// FIX 1: Cryptographically random reference code
function generateRefCode(): string {
  return randomBytes(8).toString('hex').toUpperCase()
}

export class SupportService {
  async createTicket(userId: string, data: {
    subject:    string
    category:   SupportCategory
    priority:   TicketPriority
    content:    string
    channelId?: string
  }) {
    const refCode = generateRefCode()  // FIX 1
    const userObj = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } })

    return prisma.supportTicket.create({
      data: {
        subject:   data.subject,
        category:  data.category,
        priority:  data.priority,
        userId,
        refCode,
        channelId: data.channelId,
        messages: {
          create: [
            {
              sender:   'USER',
              senderId: userId,
              content:  data.content,
            },
            {
              sender:  'AI',
              content: `Hello ${userObj?.username || 'there'}! I am **BraynAI**, your dedicated operational assistant. I've received your ticket and I am ready to help you resolve this issue. How can I assist you today?`,
            },
          ],
        },
      },
      include: {
        messages: true,
        user:     { select: { username: true, role: true } },
      },
    })
  }

  async handleUserMessage(
    ticketId: string,
    senderId: string,
    content:  string,
    onToken:  (chunk: string) => void,
    actorRole?: string,
    actorChannel?: string | null
  ) {
    const ticket = await this.getTicketDetails(ticketId, senderId, actorRole, actorChannel)

    if (['RESOLVED', 'CLOSED'].includes(ticket.status)) {
      throw {
        statusCode: 400,
        message:    'Cannot add messages to a resolved or closed ticket',
      }
    }

    // FIX 2: Scope dedup check to a 5-second window to handle Socket/HTTP
    // double-sends without silently dropping intentional repeated messages.
    // The original checked content match across all time — too broad.
    const fiveSecondsAgo = new Date(Date.now() - 5000)
    let userMessage = await prisma.supportMessage.findFirst({
      where: {
        ticketId,
        sender:    'USER',
        senderId,
        content,
        createdAt: { gte: fiveSecondsAgo },
      },
    })

    if (!userMessage) {
      userMessage = await prisma.supportMessage.create({
        data: { ticketId, sender: 'USER', senderId, content },
      })
    }

    // FIX 3: Single clean WAITING_HUMAN check — was duplicated with a cast
    if (ticket.status === 'WAITING_HUMAN') return userMessage

    const aiReply = await runSupportAgent({
      ticketId,
      subject:       ticket.subject,
      category:      ticket.category,
      priority:      ticket.priority,
      actorUsername: ticket.user.username,
      actorRole:     ticket.user.role,
      userMessage:   content,
      actorChannelId: ticket.channelId || undefined
    }, onToken)

    return prisma.supportMessage.create({
      data: { ticketId, sender: 'AI', content: aiReply },
    })
  }

  async handleStandaloneChat(
    userId:   string,
    role:     string,
    username: string,
    content:  string,
    onToken:  (chunk: string) => void
  ) {
    const userData = await prisma.user.findUnique({ 
      where: { id: userId },
      select: { channelId: true, username: true }
    })
    
    return runSupportAgent({
      ticketId:      'STANDALONE',
      subject:       'BraynAI Portal Session',
      category:      'GENERAL',
      priority:      'MEDIUM',
      actorUsername: userData?.username || username || 'User',
      actorRole:     role,
      userMessage:   content,
      actorChannelId: userData?.channelId || undefined
    }, onToken)
  }

  async getTickets(filters: {
    userId?:      string
    status?:      TicketStatus
    page?:        number
    limit?:       number
    channelId?:   string
    creatorRole?: string | { in: string[] }
    OR?:          any[]
  }) {
    const page  = filters.page  ?? 1
    const limit = filters.limit ?? 20
    const skip  = (page - 1) * limit
    const { creatorRole, ...rawWhere } = filters as any
    delete rawWhere.page
    delete rawWhere.limit

    const where: any = {
      ...rawWhere,
      ...(creatorRole && { user: { role: creatorRole } }),
    }

    const [data, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        skip, take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          user:   { select: { username: true, role: true } },
          _count: { select: { messages: true } },
        },
      }),
      prisma.supportTicket.count({ where }),
    ])

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }
  }

  // FIX 4: Channel ownership check added
  async getTicketDetails(
    id:          string,
    actorId?:    string,
    actorRole?:  string,
    actorChannel?: string | null
  ) {
    const ticket = await basePrisma.supportTicket.findUniqueOrThrow({
      where:   { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        user:     { select: { username: true, role: true } },
      },
    })

    // Non-admin roles can only see tickets from their own channel or tickets
    // they created. Internal callers (no actor args) bypass this check.
    if (actorId && actorRole) {
      const isGlobal   = ['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN'].includes(actorRole)
      const isOwner    = ticket.userId === actorId
      const sameChannel = Boolean(actorChannel && ticket.channelId === actorChannel)

      if (!isGlobal && !isOwner && !sameChannel) {
        throw { statusCode: 403, message: 'You do not have access to this ticket' }
      }
    }

    return ticket
  }

  // FIX 5: Guard against adding messages to closed tickets
  async addMessage(ticketId: string, senderId: string, content: string) {
    const ticket = await prisma.supportTicket.findUniqueOrThrow({
      where:  { id: ticketId },
      select: { status: true },
    })

    if (['RESOLVED', 'CLOSED'].includes(ticket.status)) {
      throw {
        statusCode: 400,
        message:    'Cannot add messages to a resolved or closed ticket',
      }
    }

    const [message] = await Promise.all([
      prisma.supportMessage.create({
        data: { ticketId, senderId, content },
      }),
      prisma.supportTicket.update({
        where: { id: ticketId },
        data:  { updatedAt: new Date() },
      }),
    ])

    return message
  }

  async updateTicketStatus(id: string, status: TicketStatus) {
    return prisma.supportTicket.update({
      where: { id },
      data: {
        status,
        ...(status === 'CLOSED' || status === 'RESOLVED'
          ? { closedAt: new Date() }
          : {}),
      },
    })
  }

  async deleteTicket(id: string) {
    const ticket = await this.getTicketDetails(id)

    if (!['RESOLVED', 'CLOSED'].includes(ticket.status)) {
      throw {
        statusCode: 400,
        message:    'Only resolved or closed tickets can be deleted',
      }
    }

    // FIX 6: deleteMany for messages is redundant — SupportMessage has
    // onDelete: Cascade in the schema. A single ticket delete removes
    // all associated messages automatically at the DB level.
    return prisma.supportTicket.delete({ where: { id } })
  }
}

export const supportService = new SupportService()
