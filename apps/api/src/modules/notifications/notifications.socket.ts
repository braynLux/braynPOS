import { Server, Socket } from 'socket.io'
import { verifyToken } from '../../lib/jwt.js'
import { setNotificationIo } from './notifications.service.js'

/**
 * Notifications Socket: Strict multi-tenant room management for real-time alerts.
 * Users join rooms strictly isolated by their enterpriseId and channelId.
 */
export function setupNotificationSocket(io: Server) {
  setNotificationIo(io)

  io.on('connection', (socket: Socket) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token
    if (!token) return

    try {
      const user = verifyToken(token as string) as any
      socket.data.user = user

      const enterpriseId = user.enterpriseId
      const channelId = user.channelId
      const isPlatformOwner = user.role === 'PLATFORM_OWNER'

      // Direct user room
      if (user.sub || user.id) {
        socket.join(`user:${user.sub || user.id}`)
      }

      if (enterpriseId) {
        // Multi-tenant channel room
        if (channelId) {
          socket.join(`enterprise:${enterpriseId}:channel:${channelId}`)
        }

        // Multi-tenant enterprise admin room
        if (['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN'].includes(user.role)) {
          socket.join(`enterprise:${enterpriseId}:admins`)
        }
      } else if (isPlatformOwner) {
        // Global platform owner room
        socket.join('platform:owners')
      }
    } catch {
      // Ignore invalid tokens
    }

    socket.on('disconnect', () => { })
  })
}
