import { describe, expect, it } from 'vitest'
import { prisma } from '../../lib/prisma.js'
import { commitSale } from './sales.service.js'
import type { TokenPayload } from '../../lib/jwt.js'

describe('Sales service', () => {
  it('rejects duplicate item lines when combined quantity exceeds stock', async () => {
    const channel = await prisma.channel.create({
      data: { name: 'Sales Test Channel', code: 'SALE-TST', type: 'RETAIL_SHOP' },
    })
    const item = await prisma.item.create({
      data: {
        name: 'Limited Stock Item',
        sku: 'LIMITED-STOCK',
        retailPrice: 100,
        wholesalePrice: 90,
        minRetailPrice: 80,
        weightedAvgCost: 50,
      },
    })
    await prisma.inventoryBalance.create({
      data: {
        itemId: item.id,
        channelId: channel.id,
        availableQty: 5,
        retailPrice: 100,
        wholesalePrice: 90,
        minRetailPrice: 80,
        weightedAvgCost: 50,
      },
    })

    const actor: TokenPayload = {
      id: 'cashier-1',
      sub: 'cashier-1',
      username: 'cashier',
      email: 'cashier@test.local',
      role: 'CASHIER',
      channelId: channel.id,
      mfaVerified: true,
    }

    await expect(commitSale({
      channelId: channel.id,
      saleType: 'RETAIL',
      customerId: null,
      sessionId: null,
      items: [
        { itemId: item.id, quantity: 3, unitPrice: 100, discountAmount: 0 },
        { itemId: item.id, quantity: 3, unitPrice: 100, discountAmount: 0 },
      ],
      payments: [{ method: 'CASH', amount: 600 }],
    }, actor)).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining('Requested: 6'),
    })
  })
})
