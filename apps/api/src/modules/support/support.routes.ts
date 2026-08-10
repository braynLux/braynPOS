import type { FastifyPluginAsync } from 'fastify'
import { supportService } from './support.service.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize } from '../../middleware/authorize.js'
import { z } from 'zod'
import { RATE } from '../../lib/rate-limit.plugin.js'
import { SupportCategory, TicketPriority, TicketStatus } from '@prisma/client'

const GLOBAL_SUPPORT_ROLES = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export const supportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // POST /support/tickets — Create a new ticket (Managers)
  app.post('/tickets', {
    config:     RATE.AI_CHAT,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const body = z.object({
      subject: z.string().min(1).max(200),
      category: z.nativeEnum(SupportCategory),
      priority: z.nativeEnum(TicketPriority),
      content: z.string().min(1).max(5000),
    }).parse(request.body)
    if (!GLOBAL_SUPPORT_ROLES.includes(request.user.role) && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }

    const ticket = await supportService.createTicket(request.user.sub, {
      ...body,
      channelId: request.user.channelId || undefined,
    })
    reply.status(201).send(ticket)
  })

  // GET /support/tickets — List tickets (Filters for Admins vs Managers)
  app.get('/tickets', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const query = z.object({
      status: z.nativeEnum(TicketStatus).optional(),
      page: z.coerce.number().min(1).optional(),
      limit: z.coerce.number().min(1).max(100).optional(),
    }).parse(request.query)

    const baseFilters: any = { ...query }
    if (GLOBAL_SUPPORT_ROLES.includes(request.user.role)) {
      return supportService.getTickets(baseFilters)
    }

    let creatorRole: any = undefined
    let channelId: string | undefined = undefined

    // Hierarchy logic for which OTHER tickets can be seen
    if (request.user.role === 'MANAGER') {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      channelId = request.user.channelId || undefined
    }

    // Final "OR" filter: (Your own tickets) OR (Tickets you oversee)
    const filters = {
      ...baseFilters,
      OR: [
        { userId: request.user.sub },
        ...(creatorRole || channelId ? [{
          AND: [
             ...(creatorRole ? [{ user: { role: creatorRole } }] : []),
             ...(channelId ? [{ channelId }] : [])
          ]
        }] : [])
      ]
    }

    return supportService.getTickets(filters)
  })

  // GET /support/tickets/:id — Get ticket details
  app.get('/tickets/:id', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const ticket = await supportService.getTicketDetails(
      id,
      request.user.sub,
      request.user.role,
      request.user.channelId,
    )

    // Security check
    if (GLOBAL_SUPPORT_ROLES.includes(request.user.role)) {
      // Access granted
    } else if (request.user.role === 'MANAGER') {
      if (ticket.channelId !== request.user.channelId) {
        throw { statusCode: 403, message: 'You do not have permission to view this branch ticket' }
      }
    } else if (ticket.userId !== request.user.sub) {
      throw { statusCode: 403, message: 'You do not have permission to view this ticket' }
    }

    return ticket
  })

  // POST /support/tickets/:id/messages — Reply to a ticket
  app.post('/tickets/:id/messages', {
    // Each reply runs the AI agent: a paid embedding call, a paid streaming
    // generation, and a fan-out of database lookups. Left unlimited, one
    // client could drain the Gemini quota and hammer the database.
    config:     RATE.AI_CHAT,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { content } = z.object({ content: z.string().min(1).max(5000) }).parse(request.body)

    const ticket = await supportService.getTicketDetails(
      id,
      request.user.sub,
      request.user.role,
      request.user.channelId,
    )

    // Security check
    if (GLOBAL_SUPPORT_ROLES.includes(request.user.role)) {
      // Access granted
    } else if (request.user.role === 'MANAGER') {
      if (ticket.channelId !== request.user.channelId) {
        throw { statusCode: 403, message: 'You do not have permission to reply to this branch ticket' }
      }
    } else if (ticket.userId !== request.user.sub) {
      throw { statusCode: 403, message: 'You do not have permission to reply to this ticket' }
    }

    const message = await supportService.handleUserMessage(
      id,
      request.user.sub,
      content,
      () => {},
      request.user.role,
      request.user.channelId,
    )
    reply.status(201).send(message)
  })

  // PATCH /support/tickets/:id/status — Update ticket status (Admins only)
  app.patch('/tickets/:id/status', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN')],
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { status } = z.object({ status: z.nativeEnum(TicketStatus) }).parse(request.body)
    return supportService.updateTicketStatus(id, status)
  })

  // DELETE /support/tickets/:id — Delete a ticket (if Resolved/Closed)
  app.delete('/tickets/:id', {
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const ticket = await supportService.getTicketDetails(
      id,
      request.user.sub,
      request.user.role,
      request.user.channelId,
    )

    // Security check (same as GET)
    if (GLOBAL_SUPPORT_ROLES.includes(request.user.role)) {
      // Access granted
    } else if (request.user.role === 'MANAGER') {
      if (ticket.channelId !== request.user.channelId) {
        throw { statusCode: 403, message: 'You do not have permission to delete this branch ticket' }
      }
    } else if (ticket.userId !== request.user.sub) {
      throw { statusCode: 403, message: 'You do not have permission to delete this ticket' }
    }

    await supportService.deleteTicket(id)
    reply.status(204).send()
  })

  // POST /support/ai-portal/chat — Direct chat with BraynAI (No ticket)
  app.post('/ai-portal/chat', {
    config:     RATE.AI_CHAT,
    preHandler: [authorize('SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { message } = z.object({ message: z.string().min(1).max(5000) }).parse(request.body)
    
    // We return the full string for consistency with the support chat session logic.
    const fullReply = await supportService.handleStandaloneChat(
      request.user.sub,
      request.user.role,
      request.user.username,
      message,
      () => {}
    )
    
    return { reply: fullReply }
  })
}
