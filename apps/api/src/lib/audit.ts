// apps/api/src/lib/audit.ts
// NEVER await this in the main transaction path.
// Call it AFTER commit as a background fire-and-forget.

import { prisma } from './prisma.js'
import { logger }  from './logger.js'
import { requestContext } from './request-context.plugin.js'

interface AuditPayload {
  action:        string
  actorId:       string
  actorRole:     string
  enterpriseId?: string
  approverId?:   string
  channelId?:    string
  targetType?:   string
  targetId?:     string
  oldValues?:    any
  newValues?:    any
  ipAddress?:    string
}

export function logAction(payload: AuditPayload): void {
  const store = requestContext.getStore()
  const enterpriseId = payload.enterpriseId ?? store?.enterpriseId
  // Fire-and-forget — intentionally NOT awaited
  prisma.auditLog.create({
    data: {
      ...payload,
      ...(enterpriseId && { enterpriseId }),
    }
  }).catch((err: any) => {
    // FIX: Use structured logger instead of console.error so audit
    // failures appear in the log aggregator with full context
    logger.error({ err, payload }, '[audit] Failed to write audit log')
  })
}

// ── AUDIT ACTION CONSTANTS ────────────────────────────────────────────
export const AUDIT = {
  // Sales
  SALE_VOID:             'sale.void',
  SALE_REFUND:           'sale.refund',
  DISCOUNT_OVERRIDE:     'discount.override',
  PRICE_BELOW_MIN:       'price.below_minimum',

  // Items
  PRICE_EDIT:            'item.price_edit',
  ITEM_CREATE:           'item.create',
  ITEM_UPDATE:           'item.update',
  ITEM_DELETE:           'item.delete',

  // Stock
  STOCK_ADJUST:          'stock.adjust',
  STOCK_WRITE_OFF:       'stock.write_off',
  MARGIN_REPAIR:         'margin.repair',

  // Transfers
  TRANSFER_DISPUTE:      'transfer.dispute',

  // Users
  USER_ROLE_CHANGE:      'user.role_change',
  USER_CREATE:           'user.create',
  USER_DELETE:           'user.delete',
  USER_UPDATE:           'user.update',

  // Auth & MFA
  MFA_DISABLED:          'auth.mfa_disabled',
  MFA_ENABLED:           'auth.mfa_enabled',
  PASSWORD_CHANGED:      'auth.password_changed',

  // Payroll
  PAYROLL_ACCESS:        'payroll.access',
  PAYROLL_RUN_FINALIZE:  'payroll.run_finalize',
  PAYROLL_RUN_REVERSE:   'payroll.run_reverse',
  PAYROLL_RUN_DELETE:    'payroll.run_delete',

  // Purchases
  PURCHASE_DELETE:       'purchase.delete',
  PURCHASE_COMMIT:       'purchase.commit',

  // Customers & Credit
  CREDIT_LIMIT_ADJUST:   'credit.limit_adjustment',
  CUSTOMER_DELETE:       'customer.delete',

  // Tax & Config
  TAX_CONFIG:            'tax.config',

  // Sessions
  SESSION_OPEN:          'session.open',
  SESSION_CLOSE:         'session.close',

  // Approvals
  MANAGER_APPROVAL:      'manager.approval',

  // Offline & Sync
  OFFLINE_OVERRIDE:      'offline.override',
  OFFLINE_SYNC:          'offline.sync',
  SERIAL_ADJUST:         'serial.adjust',
} as const

// Derive a union type from the constants for type-safe action strings
export type AuditAction = typeof AUDIT[keyof typeof AUDIT]
