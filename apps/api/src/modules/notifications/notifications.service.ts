import { basePrisma, prisma } from '../../lib/prisma.js'
import { WhatsAppService } from '../support/whatsapp.service.js'
import { settingsService } from '../dashboard/settings.service.js'
import { logger } from '../../lib/logger.js'

let io: any = null
const GLOBAL_NOTIFICATION_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN']

export function setNotificationIo(socketIo: any) {
  io = socketIo
}

export class NotificationService {
  /**
   * Unified Dispatcher: The "Omni-Channel" entry point for all system alerts.
   * Path: Save DB -> Emit WebSocket -> (Optional) External WhatsApp
   */
  static async notify(data: {
    type: 'LOW_STOCK' | 'NEGATIVE_STOCK' | 'TRANSFER_RECEIVED' | 'TRANSFER_DISPUTED' | 'CREDIT_DUE' | 'SYSTEM' | 'APPROVAL_REQUESTED'
    message: string
    channelId?: string | null
    userId?: string | null // Target specific user if provided
    metadata?: any
  }) {
    try {
      // 1. Save to Database (Permanent record - Free)
      const notification = await prisma.notification.create({
        data: {
          type:      data.type,
          message:   data.message,
          channelId: data.channelId ?? null,
        },
      })

      // 2. Broadcast over WebSockets (Real-time Dashboard - Free)
      if (io) {
        const payload = {
            ...notification,
            metadata: data.metadata
        }
        
        if (data.channelId) {
          // Send to the whole channel (all managers/admins in that branch)
          io.to(`channel:${data.channelId}`).emit('notification', payload)
        } else {
          // System-wide broadcast (Super Admins)
          io.to('super-admins').emit('notification', payload)
        }
      }

      // 3. Optional External Dispatch (WhatsApp - Potential Cost)
      // Check Shop's specific settings via the settingsService
      const whatsappEnabled = await settingsService.getByKey('whatsapp_notifications_enabled', data.channelId)
      
      if (whatsappEnabled === true) {
        // Resolve tenant-specific credentials or fall back to platform aggregator
        const whatsappConfig = await settingsService.getByKey('whatsapp_config', data.channelId)
        
        // Logical "Aggregator" Toggle: 
        // If shop has no config, check if they allowed "Platform Official Messaging"
        const usePlatformOfficial = await settingsService.getByKey('use_platform_official_messaging', data.channelId)
        
        if (whatsappConfig || usePlatformOfficial) {
           await WhatsAppService.sendAlert(data.message, data.channelId || undefined)
        }
      }

      return notification
    } catch (err) {
      logger.error({ err, data }, '[NotificationService] Unified dispatch failed')
      return null
    }
  }

  static async markAsRead(id: string, actorRole: string, actorChannelId?: string | null) {
    const notification = await prisma.notification.findUnique({
      where:  { id },
      select: { id: true, channelId: true },
    })

    if (!notification) {
      throw { statusCode: 404, message: 'Notification not found' }
    }

    const isGlobalRole = GLOBAL_NOTIFICATION_ROLES.includes(actorRole)
    if (!isGlobalRole && (!actorChannelId || notification.channelId !== actorChannelId)) {
      throw { statusCode: 404, message: 'Notification not found' }
    }

    return prisma.notification.update({
      where: { id },
      data:  { isRead: true },
    })
  }

  static async getHistory(channelId?: string | null, page = 1, limit = 20, enterpriseId?: string | null) {
     const skip = (page - 1) * limit
     return prisma.notification.findMany({
       where: channelId ? { channelId } : enterpriseId ? { channel: { enterpriseId } } : {},
       orderBy: { createdAt: 'desc' },
       take: limit,
       skip,
     })
  }
}
