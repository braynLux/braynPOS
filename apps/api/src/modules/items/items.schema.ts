import { z } from 'zod'

export const createItemSchema = z.object({
  sku: z.string().max(50).optional(),
  barcode: z.string().optional(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  categoryId: z.string().optional().nullable(),
  brandId: z.string().optional().nullable(),
  supplierId: z.string().optional().nullable(),
  unitOfMeasure: z.string().default('PCS'),
  packSize: z.number().int().min(1).optional(),
  retailPrice: z.number().min(0),
  wholesalePrice: z.number().min(0).optional(),
  minRetailPrice: z.number().min(0).optional(),
  minWholesalePrice: z.number().min(0).optional(),
  weightedAvgCost: z.number().min(0).optional(),
  reorderLevel: z.number().int().min(0).optional(),
  isSerialized: z.boolean().optional(),
  taxClass: z.enum(['STANDARD', 'ZERO_RATED', 'EXEMPT']).optional(),
  imageUrl: z.string().optional(),
  isActive: z.boolean().optional(),
  type: z.enum(['PRODUCT', 'SERVICE']).default('PRODUCT').optional(),
})

export const updateItemSchema = createItemSchema.partial()

export const listItemsQuery = z.object({
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  search: z.string().optional(),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
  supplierId: z.string().optional(),
  channelId: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  isSerialized: z.coerce.boolean().optional(),
  sortBy: z.enum(['name', 'category', 'brand', 'supplier', 'sku', 'retailPrice', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
})

export const AdjustmentReason = z.enum([
  'DAMAGED_IN_STORE',
  'EXPIRED',
  'SYSTEM_CORRECTION',
  'THEFT_INVESTIGATION',
  'INITIAL_WALKTHROUGH'
])

export const stockAdjustmentSchema = z.object({
  itemId: z.string(),
  channelId: z.string(),
  quantity: z.number().int().refine(v => v !== 0, 'Quantity cannot be zero'),
  reason: z.string().min(1),
  reasonCode: AdjustmentReason.optional(),
  isOpening: z.boolean().optional(),
})

export type CreateItemInput = z.infer<typeof createItemSchema>
export type UpdateItemInput = z.infer<typeof updateItemSchema>
export type ListItemsInput = z.infer<typeof listItemsQuery>
