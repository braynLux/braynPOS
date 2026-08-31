import { Server, Socket } from 'socket.io'
import { verifyToken } from '../../lib/jwt.js'
import { eventBus } from '../../lib/event-bus.js'

export function setupInventorySocket(io: Server) {
  const inventoryNamespace = io.of('/inventory')

  inventoryNamespace.on('connection', (socket: Socket) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token

    if (!token) {
      socket.disconnect()
      return
    }

    try {
      const decoded = verifyToken(token as string) as any
      socket.data.user = decoded

      const enterpriseId = decoded.enterpriseId
      const channelId = decoded.channelId
      const isPlatformOwner = decoded.role === 'PLATFORM_OWNER'

      if (enterpriseId) {
        // Strict multi-tenant channel room
        if (channelId) {
          socket.join(`enterprise:${enterpriseId}:channel:${channelId}`)
        }
        // Strict multi-tenant admin room
        if (['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN'].includes(decoded.role)) {
          socket.join(`enterprise:${enterpriseId}:admins`)
        }
      } else if (isPlatformOwner) {
        socket.join('platform:owners')
      }
    } catch {
      socket.disconnect()
      return
    }

    socket.on('disconnect', () => { })
  })

  // Listen to internal event bus for stock changes
  eventBus.on('inventory.updated', (payload: {
    itemId: string
    channelId: string
    availableQty: number
    movementType: string
    enterpriseId?: string
  }) => {
    if (payload.enterpriseId) {
      // Broadcast strictly within this enterprise's channel and admin rooms
      inventoryNamespace.to(`enterprise:${payload.enterpriseId}:channel:${payload.channelId}`).emit('stock_update', {
        itemId:       payload.itemId,
        availableQty: payload.availableQty,
        movementType: payload.movementType,
      })
      inventoryNamespace.to(`enterprise:${payload.enterpriseId}:admins`).emit('stock_update', payload)
    } else {
      // Fallback for legacy channel broadcast
      inventoryNamespace.to(`channel:${payload.channelId}`).emit('stock_update', {
        itemId:       payload.itemId,
        availableQty: payload.availableQty,
        movementType: payload.movementType,
      })
    }
  })
}
