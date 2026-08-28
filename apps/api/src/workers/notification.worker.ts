import { eventBus } from '../lib/event-bus.js'
import pino from 'pino'
import { NotificationService } from '../modules/notifications/notifications.service.js'

const logger = pino({ name: 'notification-worker' })

/**
 * Notification Worker: processes domain events and stores notifications.
 * Listens to event bus and creates notification records for
 * low stock, session events, transfer disputes, etc.
 */
export function startNotificationWorker() {
  // Listen for low stock events
  eventBus.on('stock.low', async (data: any) => {
    try {
      await NotificationService.notify({
        type: 'LOW_STOCK',
        message: `Item ${data.itemId} is below reorder level. Current: ${data.currentQty}, Reorder: ${data.reorderLevel}`,
        channelId: data.channelId,
        metadata: data
      })
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to process stock.low event')
    }
  })

  eventBus.on('stock.negative', async (data: any) => {
    try {
      await NotificationService.notify({
        type: 'NEGATIVE_STOCK',
        message: `Item ${data.itemId} has negative stock: ${data.currentQty}`,
        channelId: data.channelId,
        metadata: data
      })
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to process stock.negative event')
    }
  })

  eventBus.on('transfer.disputed', async (data: any) => {
    try {
      await NotificationService.notify({
        type: 'TRANSFER_DISPUTED',
        message: `Transfer ${data.transferId} has discrepancies`,
        channelId: data.toChannelId,
        metadata: data
      })
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to process transfer.disputed event')
    }
  })

  eventBus.on('approval.requested', async (data) => {
    try {
      await NotificationService.notify({
        type: 'SYSTEM',
        message: `New approval request: ${data.action.replace('_', ' ')} for ${data.notes || 'context ' + data.approvalId}`,
        channelId: data.channelId,
        metadata: { approvalId: data.approvalId, action: data.action }
      })
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to process approval.requested event')
    }
  })

  eventBus.on('sale.zero_cost', async (data: any) => {
    try {
      await NotificationService.notify({
        type: 'SYSTEM',
        message: `⚠️ MARGIN VULNERABILITY: Sale ${data.receiptNo} contains item ${data.itemSku} with ZERO cost. Commission was skipped. Please fix item cost immediately.`,
        channelId: data.channelId,
        metadata: data
      })
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to process sale.zero_cost event')
    }
  })

  eventBus.on('transfer.zero_cost', async (data: any) => {
    try {
      await NotificationService.notify({
        type: 'SYSTEM',
        message: `⚠️ TRANSFER WARNING: Item ${data.itemSku} being transferred to ${data.toChannelId} has UNKNOWN/ZERO cost. This will break margin reporting at the destination.`,
        channelId: data.fromChannelId,
        metadata: data
      })
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to process transfer.zero_cost event')
    }
  })

  logger.info('[Notification Worker] Event listeners initialized')
}
