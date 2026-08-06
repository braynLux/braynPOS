import { Server, Socket } from 'socket.io'
import { verifyToken } from '../../lib/jwt.js'
import { eventBus }   from '../../lib/event-bus.js'

// JWT configuration is handled centrally in lib/jwt.js

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
      
      // Join channel-specific room
      if (decoded.channelId) {
        socket.join(`channel:${decoded.channelId}`)
      }
      if (['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN'].includes(decoded.role)) {
        socket.join('channel:HQ')
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
  }) => {
    // Broadcast to the specific channel room
    inventoryNamespace.to(`channel:${payload.channelId}`).emit('stock_update', {
      itemId:       payload.itemId,
      availableQty: payload.availableQty,
      movementType: payload.movementType
    })

    // Also broadcast to global admins room if we have one (optional)
    inventoryNamespace.to('channel:HQ').emit('stock_update', payload)
  })
}
