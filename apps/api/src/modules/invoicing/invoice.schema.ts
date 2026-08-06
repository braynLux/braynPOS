import { z } from 'zod'

export const invoiceLineSchema = z.object({
  itemId:         z.string().uuid().optional(),
  description:    z.string().min(1),
  quantity:       z.coerce.number().positive(),
  unitPrice:      z.coerce.number().nonnegative(),
  discountAmount: z.coerce.number().nonnegative().default(0),
})

export const createInvoiceSchema = z.object({
  type:            z.enum(['QUOTATION', 'PROFORMA', 'INVOICE']).default('INVOICE'),
  channelId:       z.string().uuid(),
  customerId:      z.string().uuid(),
  lines:           z.array(invoiceLineSchema).min(1),
  discountAmount:  z.coerce.number().nonnegative().default(0),
  taxAmount:       z.coerce.number().nonnegative().default(0),
  dueDate:         z.string().datetime().optional(),
  notes:           z.string().optional(),
  customerOrderNo: z.string().max(100).optional(),
  quotationRefNo:  z.string().max(100).optional(),
  taxExempt:       z.boolean().default(false),
  terms:           z.string().max(2000).optional(),
  selectedBankId:  z.string().uuid().optional(),
})

export const listInvoicesQuerySchema = z.object({
  channelId:  z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  type:       z.enum(['QUOTATION', 'PROFORMA', 'INVOICE']).optional(),
  status:     z.enum(['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'VOID']).optional(),
  search:     z.string().optional(),
  startDate:  z.string().optional(),
  endDate:    z.string().optional(),
  page:       z.coerce.number().min(1).optional(),
  limit:      z.coerce.number().min(1).max(100).optional(),
})

export const recordPaymentSchema = z.object({
  amount: z.coerce.number().positive(),
})

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>
