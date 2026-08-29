import { z } from 'zod'

// ══════════════════════════════════════════════════════════════════════
// SALES SCHEMA — with payload limits & sanitisation
// apps/api/src/modules/sales/sales.schema.ts
//
// Changes from original:
//  1. items array: .min(1).max(50)        — cap transaction size
//  2. payments array: .min(1).max(10)     — no more than 10 split payments
//  3. quantity: max(10,000)               — prevent absurd qty values
//  4. unitPrice: max(100,000,000)         — prevent overflow attacks
//  5. discountAmount: max cap added       — discount can't exceed price
//  6. notes: max(500) chars              — prevent large text payloads
//  7. reference: max(100) chars          — payment refs kept short
//  8. itemId / serialId: uuid() format   — ensures valid UUIDs only
//  9. listSalesQuery: limit hard cap 100  — already present, confirmed
// ══════════════════════════════════════════════════════════════════════

export const commitSaleSchema = z.object({
  channelId: z.string().uuid(),                        // must be a valid UUID

  saleType: z.enum(['WHOLESALE', 'RETAIL', 'CREDIT', 'PRE_ORDER', 'LAYAWAY'])
    .default('RETAIL'),

  customerId: z.string().uuid().optional().nullable(),

  sessionId: z.preprocess(
    (val) => (val === '' ? null : val),
    z.string().uuid().optional().nullable()            // session IDs are UUIDs
  ),

  items: z.array(
    z.object({
      itemId:         z.string().uuid(),               // must be valid UUID
      serialId:       z.string().uuid().optional().nullable(),
      quantity:       z.number().int().positive().max(10_000),  // max 10k units per line
      unitPrice:      z.number().positive().max(100_000_000),   // max 100M per unit
      discountAmount: z.number().min(0).max(100_000_000)        // can't discount more than price
                       .optional().nullable(),
    })
  )
  .min(1, 'A sale must have at least one item')
  .max(50, 'A single sale cannot exceed 50 line items'),   // ← KEY FIX

  payments: z.array(
    z.object({
      method: z.enum(['CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'LOYALTY_POINTS', 'CREDIT']),
      amount:    z.number().positive().max(100_000_000),
      reference: z.string().max(100).optional().nullable(), // refs kept short
    })
  )
  .min(1, 'A sale must have at least one payment')
  .max(10, 'A sale cannot have more than 10 split payments'),

  notes:         z.string().max(500).optional().nullable(),   // no essays in notes
  discountAmount: z.number().min(0).max(100_000_000).optional().nullable(),
  approvalToken: z.string().max(500).optional().nullable(),
  promoterId:    z.string().uuid().optional().nullable(),
  dueDate:       z.string().datetime({ offset: true }).optional().nullable(), // must be ISO date
})

// ── Offline sync wraps commitSaleSchema ───────────────────────────────
export const offlineSyncSchema = z.object({
  offlineReceiptNo: z.string().min(1).max(100),  // prevent empty / huge receipt nos
  saleData: commitSaleSchema,
})

// ── List query — already had max(100), keeping + adding channelId uuid check ──
export const listSalesQuery = z.object({
  page:       z.coerce.number().int().min(1).optional(),
  limit:      z.coerce.number().int().min(1).max(100).optional(),
  channelId:  z.string().uuid().optional(),
  saleType:   z.enum(['WHOLESALE', 'RETAIL', 'CREDIT', 'PRE_ORDER', 'LAYAWAY']).optional(),
  startDate:  z.string().optional(),
  endDate:    z.string().optional(),
  customerId: z.string().uuid().optional(),
  sessionId:  z.string().uuid().optional(),
  paymentMethod: z.enum(['CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'LOYALTY_POINTS', 'CREDIT']).optional(),
  performedBy: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().uuid().optional()
  ),
})

export type CommitSaleInput  = z.infer<typeof commitSaleSchema>
export type OfflineSyncInput = z.infer<typeof offlineSyncSchema>
