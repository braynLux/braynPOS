// ══════════════════════════════════════════════════════════════════════
// FILE: apps/api/src/modules/support/support.socket.ts
// Fixes:
//   1. CRITICAL: JWT_SECRET fallback was 'your-secret-key' — a known
//      public string. If JWT_SECRET env var is missing at runtime, every
//      WebSocket connection is validated against a string any attacker
//      knows, allowing forged tokens. Now throws at startup if the env
//      var is absent instead of silently degrading to an insecure default.
//   2. join_ticket had no ownership check — any authenticated user could
//      join any ticket room and receive all AI responses and messages
//      in real time. Now verifies the user owns the ticket or is a
//      MANAGER+ before allowing them to join the room.
//   3. Hardcoded PII (phone number, email) in error message template
//      replaced with env var references.
//   4. console.log calls leaking usernames and connection events removed.
//   5. Math.random() message ID replaced with a timestamp+random suffix
//      that is unique enough for a transient socket message ID.
// ══════════════════════════════════════════════════════════════════════

import { Server, Socket } from 'socket.io'
import { supportService } from './support.service.js'
import { verifyToken }    from '../../lib/jwt.js'
import { prisma }         from '../../lib/prisma.js'

// JWT configuration is handled centrally in lib/jwt.js
const GLOBAL_TICKET_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN']

type SocketUser = {
  sub: string
  role: string
  channelId?: string | null
}

// FIX 3: Contact details from env vars — never hardcode PII in source
const SUPPORT_PHONE = process.env.SUPPORT_CONTACT_PHONE ?? 'the support team'
const SUPPORT_EMAIL = process.env.SUPPORT_CONTACT_EMAIL ?? ''

const ESCALATION_MSG =
  `⚠️ **BRAYN CORE:** System reasoning module is unreachable. A human agent has been notified. ` +
  `If you do not receive a response within 5 minutes, please contact **${SUPPORT_PHONE}**` +
  (SUPPORT_EMAIL ? ` or email **${SUPPORT_EMAIL}**` : '') + ` for urgent assistance.`

// FIX 5: Transient socket message ID — unique enough for client-side dedup
function socketMsgId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

async function canAccessTicket(ticketId: string, user: SocketUser): Promise<boolean> {
  const ticket = await prisma.supportTicket.findUnique({
    where:  { id: ticketId },
    select: { userId: true, channelId: true },
  })

  if (!ticket) return false
  if (GLOBAL_TICKET_ROLES.includes(user.role)) return true

  const isOwner = ticket.userId === user.sub
  const sameChannel = Boolean(user.channelId && ticket.channelId === user.channelId)
  return isOwner || sameChannel
}

export function setupSupportSocket(io: Server) {
  const supportNamespace = io.of('/support')

  supportNamespace.on('connection', (socket: Socket) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token

    if (!token) {
      socket.disconnect()
      return
    }

    try {
      const decoded      = verifyToken(token as string) as any
      socket.data.user   = decoded
      // FIX 4: Removed console.log leaking username
    } catch {
      socket.disconnect()
      return
    }

    // FIX 2: Ownership check before joining a ticket room
    socket.on('join_ticket', async (ticketId: string) => {
      try {
        const user = socket.data.user as SocketUser

        if (!ticketId || !(await canAccessTicket(ticketId, user))) {
          socket.emit('error', 'Access denied to this ticket')
          return
        }

        socket.join(`ticket:${ticketId}`)
        // FIX 4: Removed console.log leaking ticket IDs
      } catch {
        socket.emit('error', 'Failed to join ticket room')
      }
    })

    // Handle new message from user via socket
    socket.on('send_message', async (payload) => {
      const { ticketId, content } = payload || {}
      const user = socket.data.user as SocketUser

      if (typeof ticketId !== 'string' || typeof content !== 'string' || !content.trim()) {
        socket.emit('error', 'Invalid support message')
        return
      }

      if (!(await canAccessTicket(ticketId, user))) {
        socket.emit('error', 'Access denied to this ticket')
        return
      }

      // Emit user message to the room immediately for responsive UI
      supportNamespace.to(`ticket:${ticketId}`).emit('message', {
        id:        socketMsgId(),  // FIX 5
        content,
        sender:    'USER',
        senderId:  user.sub,
        createdAt: new Date(),
      })

      let fullAIContent = ''
      try {
        await supportService.handleUserMessage(
          ticketId,
          user.sub,
          content,
          (token) => {
            fullAIContent += token
            supportNamespace.to(`ticket:${ticketId}`).emit('ai_chunk', {
              ticketId,
              token,
            })
          },
          user.role,
          user.channelId,
        )

        supportNamespace.to(`ticket:${ticketId}`).emit('ai_message_complete', {
          ticketId,
          fullContent: fullAIContent,
        })
      } catch (err) {
        // FIX 4: Removed console.error leaking error details to stdout
        supportNamespace.to(`ticket:${ticketId}`).emit('message', {
          id:        socketMsgId(),
          content:   ESCALATION_MSG,  // FIX 3
          sender:    'SYSTEM',
          createdAt: new Date(),
        })
        supportNamespace.to(`ticket:${ticketId}`).emit('error', 'AI processing failed.')
        supportNamespace.to('admin').emit('ai_failure_alert', {
          ticketId,
          error: err instanceof Error ? err.message : 'Unknown AI error',
        })
      }
    })

    socket.on('disconnect', () => {
      // FIX 4: Removed console.log leaking disconnect events
    })
  })
}
