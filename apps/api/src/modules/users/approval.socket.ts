import { Server, Socket } from 'socket.io'
import { verifyToken } from '../../lib/jwt.js'
import { eventBus } from '../../lib/event-bus.js'
import pino from 'pino'

const logger = pino({ name: 'approval-socket' })

export function setupApprovalSocket(io: Server) {
  const approvalNamespace = io.of('/approvals')

  approvalNamespace.on('connection', (socket: Socket) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token

    if (!token) {
      socket.disconnect()
      return
    }

    try {
      const decoded = verifyToken(token as string) as any
      const userId = decoded.id || decoded.sub

      if (!userId) {
        logger.error({ token: 'provided' }, 'Token verified but contains no user ID (id/sub)')
        socket.disconnect()
        return
      }

      socket.data.user = { ...decoded, id: userId }
      const enterpriseId = decoded.enterpriseId
      const channelId = decoded.channelId

      if (enterpriseId) {
        if (decoded.role === 'SUPER_ADMIN' || decoded.role === 'MANAGER_ADMIN' || decoded.role === 'ADMIN') {
          socket.join(`enterprise:${enterpriseId}:admins`)
        }
        if (channelId) {
          socket.join(`enterprise:${enterpriseId}:channel:${channelId}`)
        }
      } else if (decoded.role === 'PLATFORM_OWNER') {
        socket.join('platform:owners')
      }

      logger.debug({ username: decoded.username, role: decoded.role, enterpriseId }, 'Approval socket connected')
    } catch {
      socket.disconnect()
      return
    }

    socket.on('disconnect', () => {
      logger.debug('Approval socket disconnected')
    })
  })

  // Listen to Domain Events and broadcast strictly within tenant boundaries
  eventBus.on('approval.requested', (data: {
    approvalId: string
    requesterId: string
    channelId: string | null
    action: string
    notes?: string | null
    enterpriseId?: string
  }) => {
    logger.debug({ approvalId: data.approvalId, enterpriseId: data.enterpriseId }, '[ApprovalSocket] Broadcasting request')

    if (data.enterpriseId) {
      // Notify only this enterprise's admins
      approvalNamespace.to(`enterprise:${data.enterpriseId}:admins`).emit('new_approval_request', data)

      // Notify only this enterprise's channel managers
      if (data.channelId) {
        approvalNamespace.to(`enterprise:${data.enterpriseId}:channel:${data.channelId}`).emit('new_approval_request', data)
      }
    } else {
      // Fallback for unscoped local testing
      if (data.channelId) {
        approvalNamespace.to(`channel:${data.channelId}`).emit('new_approval_request', data)
      }
    }
  })
}
