import { EventEmitter } from 'events'
import { logger } from './logger.js'

// ── Domain Event Types ────────────────────────────────────────────────
export interface DomainEvents {
  'sale.committed':          { saleId: string; channelId: string; totalAmount: number; enterpriseId?: string }
  'purchase.committed':      { purchaseId: string; channelId: string; enterpriseId?: string }
  'transfer.sent':           { transferId: string; fromChannelId: string; toChannelId: string; enterpriseId?: string }
  'transfer.received':       { transferId: string; toChannelId: string; enterpriseId?: string }
  'transfer.disputed':       { transferId: string; toChannelId: string; enterpriseId?: string }
  'expense.created':         { expenseId: string; channelId: string; amount: number; enterpriseId?: string }
  'stock.low':               { itemId: string; channelId: string; currentQty: number; reorderLevel: number; enterpriseId?: string }
  'stock.negative':          { itemId: string; channelId: string; currentQty: number; enterpriseId?: string }
  'session.opened':          { sessionId: string; channelId: string; userId: string; enterpriseId?: string }
  'session.closed':          { sessionId: string; channelId: string; enterpriseId?: string }
  'payroll.finalized':       { salaryRunId: string; enterpriseId?: string }
  'credit.payment.received': { customerId: string; amount: number; enterpriseId?: string }
  'ticket.created':          { ticketId: string; subject: string; category: string; priority: string; refCode: string; enterpriseId?: string }
  'stock.adjustment':        { itemId: string; quantityChange: number; reason: string; ticketId?: string; enterpriseId?: string }
  'approval.requested':      { approvalId: string; requesterId: string; channelId: string | null; action: string; notes?: string | null; enterpriseId?: string }
  'inventory.updated':       { itemId: string; channelId: string; availableQty: number; movementType: string; enterpriseId?: string }
  'sale.zero_cost':          { receiptNo: string; itemSku: string; channelId: string; enterpriseId?: string }
  'transfer.zero_cost':      { itemSku: string; fromChannelId: string; toChannelId: string; enterpriseId?: string }
}

class TypedEventBus {
  private emitter = new EventEmitter()

  constructor() {
    // 50 listeners is a reasonable ceiling for this domain size.
    // If this warning fires in future, audit for listener leaks first
    // before raising the number — leaked listeners cause memory pressure.
    this.emitter.setMaxListeners(50)
  }

  emit<K extends keyof DomainEvents>(event: K, data: DomainEvents[K]): void {
    this.emitter.emit(event, data)
  }

  // FIX: Async handlers previously had no error boundary — a rejected
  // Promise would surface as an unhandledRejection, potentially crashing
  // the process in Node 18+ where unhandled rejections exit by default.
  // Now wraps every handler in Promise.resolve().catch() so failures
  // are logged via the structured logger and never propagate upward.
  on<K extends keyof DomainEvents>(
    event:   K,
    handler: (data: DomainEvents[K]) => void | Promise<void>
  ): void {
    this.emitter.on(event, (data: DomainEvents[K]) => {
      Promise.resolve(handler(data)).catch((err) => {
        logger.error(
          { err, event, data },
          `[event-bus] Unhandled error in handler for "${event}"`
        )
      })
    })
  }

  off<K extends keyof DomainEvents>(
    event:   K,
    handler: (data: DomainEvents[K]) => void | Promise<void>
  ): void {
    this.emitter.off(event, handler)
  }

  once<K extends keyof DomainEvents>(
    event:   K,
    handler: (data: DomainEvents[K]) => void | Promise<void>
  ): void {
    this.emitter.once(event, (data: DomainEvents[K]) => {
      Promise.resolve(handler(data)).catch((err) => {
        logger.error(
          { err, event, data },
          `[event-bus] Unhandled error in once-handler for "${event}"`
        )
      })
    })
  }
}

export const eventBus = new TypedEventBus()
