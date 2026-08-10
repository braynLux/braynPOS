// ══════════════════════════════════════════════════════════════════════
// FILE: apps/api/src/modules/support/proactive-monitor.ts
// Fixes:
//   1. (prisma as any).item.findUnique — unnecessary cast. Prisma types
//      item.findUnique natively, no cast needed.
//   2. console.log startup message removed — use structured logger.
//   3. Low stock alert threshold was `item.reorderLevel >= 50` which
//      means items with a reorderLevel < 50 (e.g. a high-value item
//      with reorderLevel = 2) would never trigger an alert even if at
//      zero stock. The threshold should be on the stock quantity, not
//      the reorder level. Fixed to alert whenever stock is critically
//      low regardless of what the reorderLevel is configured to.
// ══════════════════════════════════════════════════════════════════════

import { logger }   from '../../lib/logger.js'
import { eventBus }       from '../../lib/event-bus.js'
import { WhatsAppService } from './whatsapp.service.js'
import { prisma }          from '../../lib/prisma.js'

export function startProactiveMonitor() {
  // FIX 2: Removed console.log — startup is already logged by the server

  // 1. Watch for Low Stock
  eventBus.on('stock.low', async (data: any) => {
    try {
      // FIX 1: Native Prisma call — no any cast needed
      const item = await prisma.item.findUnique({
        where:  { id: data.itemId },
        select: { name: true, reorderLevel: true },
      })

      if (!item) return

      // FIX 3: Alert based on stock quantity being critically low,
      // not on whether the reorderLevel is >= 50.
      if (data.currentQty <= item.reorderLevel) {
        await WhatsAppService.sendAlert(
          `📉 *LOW STOCK ALERT*\nItem: ${item.name}\nBranch: ${data.channelId}\nCurrent: ${data.currentQty} (Reorder at: ${item.reorderLevel})`
        )
      }
    } catch (err) {
      // An alert that fails must never take the API down with it. These
      // handlers are async listeners on an EventEmitter, which neither
      // awaits nor catches the promises they return — so before this
      // guard a rejection here became an unhandled rejection, and Node
      // terminates the process on those by default.
      logger.error({ err, event: 'stock.low' }, '[proactive-monitor] handler failed')
    }
  })

  // 2. Watch for Urgent Support Tickets
  eventBus.on('ticket.created', async (data: any) => {
    try {
      if (data.priority === 'URGENT') {
        await WhatsAppService.sendAlert(
          `🆘 *URGENT TICKET*\nSubject: ${data.subject}\nRef: ${data.refCode}`
        )
      }
    } catch (err) {
      // An alert that fails must never take the API down with it. These
      // handlers are async listeners on an EventEmitter, which neither
      // awaits nor catches the promises they return — so before this
      // guard a rejection here became an unhandled rejection, and Node
      // terminates the process on those by default.
      logger.error({ err, event: 'ticket.created' }, '[proactive-monitor] handler failed')
    }
  })

  // 3. Watch for Large Adjustments
  eventBus.on('stock.adjustment', async (data: any) => {
    try {
      if (Math.abs(data.quantityChange) > 100) {
        await WhatsAppService.sendApprovalRequest(
          'Mass Stock Adjustment',
          `Item: ${data.itemId}, Change: ${data.quantityChange}`,
          data.ticketId || 'manual'
        )
      }
    } catch (err) {
      // An alert that fails must never take the API down with it. These
      // handlers are async listeners on an EventEmitter, which neither
      // awaits nor catches the promises they return — so before this
      // guard a rejection here became an unhandled rejection, and Node
      // terminates the process on those by default.
      logger.error({ err, event: 'stock.adjustment' }, '[proactive-monitor] handler failed')
    }
  })

  // 4. NEW: Margin Integrity Alerts (WhatsApp)
  eventBus.on('sale.zero_cost', async (data: any) => {
    try {
      await WhatsAppService.sendAlert(
        `⚠️ *MARGIN VULNERABILITY*\nSale ${data.receiptNo} contains item ${data.itemSku} with ZERO cost. Commission was skipped. Please fix item cost immediately in the Correction Center.`
      )
    } catch (err) {
      // An alert that fails must never take the API down with it. These
      // handlers are async listeners on an EventEmitter, which neither
      // awaits nor catches the promises they return — so before this
      // guard a rejection here became an unhandled rejection, and Node
      // terminates the process on those by default.
      logger.error({ err, event: 'sale.zero_cost' }, '[proactive-monitor] handler failed')
    }
  })

  eventBus.on('transfer.zero_cost', async (data: any) => {
    try {
      await WhatsAppService.sendAlert(
        `🚚 *TRANSFER COST WARNING*\nItem ${data.itemSku} being transferred to branch ${data.toChannelId} has UNKNOWN cost. This will break tracking at the destination.`
      )
    } catch (err) {
      // An alert that fails must never take the API down with it. These
      // handlers are async listeners on an EventEmitter, which neither
      // awaits nor catches the promises they return — so before this
      // guard a rejection here became an unhandled rejection, and Node
      // terminates the process on those by default.
      logger.error({ err, event: 'transfer.zero_cost' }, '[proactive-monitor] handler failed')
    }
  })

  // 5. NEW: Universal Approval Requests via WhatsApp
  eventBus.on('approval.requested', async (data: any) => {
    try {
      await WhatsAppService.sendApprovalRequest(
          data.action.replace('_', ' ').toUpperCase(),
          `Context: ${data.notes || 'Approval ID ' + data.approvalId}`,
          data.approvalId || 'new'
      )
    } catch (err) {
      // An alert that fails must never take the API down with it. These
      // handlers are async listeners on an EventEmitter, which neither
      // awaits nor catches the promises they return — so before this
      // guard a rejection here became an unhandled rejection, and Node
      // terminates the process on those by default.
      logger.error({ err, event: 'approval.requested' }, '[proactive-monitor] handler failed')
    }
  })
}
