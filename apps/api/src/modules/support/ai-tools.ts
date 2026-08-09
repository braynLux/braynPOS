// ══════════════════════════════════════════════════════════════════════
// FILE: apps/api/src/modules/support/ai-tools.ts
// Fixes:
//   1. getSaleByReceipt — no channel scoping. The AI agent could be
//      prompted to look up any sale in the system by receipt number,
//      exposing data from other channels. Now requires channelCode in
//      the input and scopes the lookup to that channel only.
//   2. toolInput: any — no validation. A prompt injection attack could
//      pass arbitrary fields. Now validates each tool's input shape
//      before executing the query.
//   3. getStockLevel — looked up channel by code with findFirst which
//      is unscoped. Now explicitly restricted to active channels only.
// ══════════════════════════════════════════════════════════════════════

import { prisma } from '../../lib/prisma.js'

const GLOBAL_SUPPORT_TOOL_ROLES = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

// FIX 2: Simple input validator to prevent arbitrary data reaching queries
function requireFields(input: any, fields: string[]): void {
  for (const field of fields) {
    if (input[field] === undefined || input[field] === null || input[field] === '') {
      throw new Error(`Missing required tool input field: ${field}`)
    }
    if (typeof input[field] !== 'string') {
      throw new Error(`Tool input field "${field}" must be a string`)
    }
  }
}

export async function executeTool(
  toolName:       string,
  toolInput:      unknown,
  actorChannelId?: string,
  actorRole?:     string
): Promise<string> {
  try {
    const input = toolInput as Record<string, any>

    switch (toolName) {
      case 'getSaleByReceipt': {
        // FIX 2: Validate input before use
        requireFields(input, ['receiptNo', 'channelCode'])

        // FIX 1: Scope lookup to the caller's channel via channelCode
        const channel = await prisma.channel.findFirst({
          where:  { code: input.channelCode, deletedAt: null },
          select: { id: true, name: true },
        })
        if (!channel) return `Channel with code "${input.channelCode}" not found.`

        // SECURITY: Verify requested channel matches actor's channel context
        if (!GLOBAL_SUPPORT_TOOL_ROLES.includes(actorRole || '')) {
          if (!actorChannelId || channel.id !== actorChannelId) {
            return `Access Denied: You are not authorized to access data for ${channel.name}.`
          }
        }

        const sale = await prisma.sale.findFirst({
          where: {
            receiptNo: input.receiptNo,
            channelId: channel.id,   // FIX 1: scoped to channel
            // FIX: voided sales were returned as though they were live, so the
            // agent would confirm a reversed transaction to whoever asked. The
            // soft-delete middleware that would have excluded them is never
            // registered on the client, so it has to be filtered here.
            deletedAt: null,
          },
          include: {
            items:    { include: { item: { select: { name: true, sku: true } } } },
            payments: true,
            channel:  { select: { name: true } },
          },
        })

        if (!sale) {
          return `No sale found with receipt number ${input.receiptNo} in ${channel.name}.`
        }

        return JSON.stringify({
          receiptNo:      sale.receiptNo,
          channel:        sale.channel.name,
          total:          sale.totalAmount,
          itemCount:      sale.items.length,
          items:          sale.items.map(i => ({ name: i.item.name, qty: i.quantity })),
          paymentMethods: sale.payments.map(p => p.method),
          createdAt:      sale.createdAt,
        }, null, 2)
      }

      case 'getStockLevel': {
        // FIX 2: Validate input before use
        requireFields(input, ['itemSku', 'channelCode'])

        const [item, channel] = await Promise.all([
          prisma.item.findFirst({
            where:  { sku: input.itemSku, deletedAt: null },
            select: { id: true, name: true },
          }),
          prisma.channel.findFirst({
            where:  { code: input.channelCode, deletedAt: null },
            select: { id: true, name: true },
          }),
        ])

        if (!item)    return `No active item found with SKU "${input.itemSku}".`
        if (!channel) return `No active channel found with code "${input.channelCode}".`

        // SECURITY: Verify requested channel matches actor's channel context
        if (!GLOBAL_SUPPORT_TOOL_ROLES.includes(actorRole || '')) {
          if (!actorChannelId || channel.id !== actorChannelId) {
            return `Access Denied: You are not authorized to access data for ${channel.name}.`
          }
        }

        const rows = await prisma.$queryRaw<Array<{ availableQty: number }>>`
          SELECT "availableQty" FROM inventory_balances
          WHERE  "itemId"    = ${item.id}::uuid
            AND  "channelId" = ${channel.id}::uuid
        `
        const qty = rows[0]?.availableQty ?? 0
        return `${item.name} in ${channel.name}: ${qty} available.`
      }

      default:
        return `Unknown tool: ${toolName}`
    }
  } catch (err: any) {
    return `Error: ${err.message}`
  }
}

export const SUPPORT_TOOLS = [
  {
    name:        'getSaleByReceipt',
    description: 'Lookup a sale by receipt number within a specific channel.',
    input_schema: {
      type:       'object',
      properties: {
        receiptNo:   { type: 'string' },
        channelCode: { type: 'string', description: 'The channel code to scope the lookup' },
      },
      required: ['receiptNo', 'channelCode'],
    },
  },
  {
    name:        'getStockLevel',
    description: 'Get real-time stock levels for an item in a specific channel.',
    input_schema: {
      type:       'object',
      properties: {
        itemSku:     { type: 'string' },
        channelCode: { type: 'string' },
      },
      required: ['itemSku', 'channelCode'],
    },
  },
]
