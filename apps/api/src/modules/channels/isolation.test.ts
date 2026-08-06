import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildApp } from '../../app.js'
import { prisma } from '../../lib/prisma.js'
import { signAccessToken } from '../../lib/jwt.js'
import { hashPassword } from '../../lib/password.js'

describe('Multi-Tenant Isolation', () => {
  let app: any
  let tokenA: string
  let tokenB: string
  let channelAId: string
  let channelBId: string
  let itemAId: string

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    // ── Setup Channels ───────────────────────────────────────────
    const channelA = await prisma.channel.create({
      data: { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Channel A', code: 'CH-A', type: 'RETAIL_SHOP' }
    })
    channelAId = channelA.id

    const channelB = await prisma.channel.create({
      data: { id: '550e8400-e29b-41d4-a716-446655440001', name: 'Channel B', code: 'CH-B', type: 'RETAIL_SHOP' }
    })
    channelBId = channelB.id

    // ── Setup Users ──────────────────────────────────────────────
    const passwordHash = await hashPassword('password123')

    const userA = await prisma.user.create({
      data: {
        id: '550e8400-e29b-41d4-a716-446655440002', username: 'userA', email: 'userA@test.com', passwordHash,
        role: 'CASHIER', channelId: channelAId
      }
    })
    tokenA = signAccessToken({
      sub: userA.id, username: userA.username, email: userA.email,
      role: userA.role, channelId: channelAId, mfaVerified: true
    })

    const userB = await prisma.user.create({
      data: {
        id: '550e8400-e29b-41d4-a716-446655440003', username: 'userB', email: 'userB@test.com', passwordHash,
        role: 'MANAGER', channelId: channelBId
      }
    })
    tokenB = signAccessToken({
      sub: userB.id, username: userB.username, email: userB.email,
      role: userB.role, channelId: channelBId, mfaVerified: true
    })

    // ── Create item in Channel A ─────────────────────────────────
    const itemA = await (prisma.item as any).create({
      data: {
        name: 'Secret Item A', sku: 'SKU-A', retailPrice: 100, wholesalePrice: 80, minRetailPrice: 90,
        inventoryBalances: {
          create: { channelId: channelAId, availableQty: 10 }
        }
      }
    })
    itemAId = itemA.id
  })

  it('User B should NOT see items created in Channel A', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/items',
      headers: { authorization: `Bearer ${tokenB}` }
    })

    const data = response.json()
    // The items list for User B should NOT contain Channel A's item
    const found = (data.data || data.items || []).find((i: any) => i.id === itemAId)
    expect(found).toBeUndefined()
  })

  it('User B should NOT be able to find Channel A item by ID', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/items/${itemAId}`,
      headers: { authorization: `Bearer ${tokenB}` }
    })
    // Should return 404-not-found, proving tenant isolation is working
    expect(response.statusCode).toBe(404)
  })

  it('User B should NOT be able to update Channel A item', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/items/${itemAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { name: 'Hacked Item' }
    })
    // Cashiers cannot edit items at all, so Fastify authorize() returns 403
    expect(response.statusCode).toBe(403)
  })

  it('User B should NOT see payments for sales in Channel A', async () => {
    // Create a sale in Channel A
    const saleA = await prisma.sale.create({
      data: {
        id: '550e8400-e29b-41d4-a716-446655440004', receiptNo: 'REC-A', channelId: channelAId, totalAmount: 100,
        taxAmount: 0, discountAmount: 0, netAmount: 100, performedBy: '550e8400-e29b-41d4-a716-446655440002'
      }
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/payments?saleId=${saleA.id}`,
      headers: { authorization: `Bearer ${tokenB}` }
    })

    // Should return 403 Forbidden as the sale belongs to Channel A
    expect(response.statusCode).toBe(403)
  })

  it('User B report queries should be forced to Channel B even when channelId points to Channel A', async () => {
    const reportDate = new Date('2026-01-15T10:00:00.000Z')

    await prisma.sale.createMany({
      data: [
        {
          receiptNo: 'REC-A-REPORT',
          channelId: channelAId,
          totalAmount: 100,
          taxAmount: 0,
          discountAmount: 0,
          netAmount: 100,
          performedBy: '550e8400-e29b-41d4-a716-446655440002',
          createdAt: reportDate,
        },
        {
          receiptNo: 'REC-B-REPORT',
          channelId: channelBId,
          totalAmount: 25,
          taxAmount: 0,
          discountAmount: 0,
          netAmount: 25,
          performedBy: '550e8400-e29b-41d4-a716-446655440003',
          createdAt: reportDate,
        },
      ],
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/reports/sales-summary?channelId=${channelAId}&startDate=2026-01-15&endDate=2026-01-15`,
      headers: { authorization: `Bearer ${tokenB}` },
    })

    expect(response.statusCode).toBe(200)
    const data = response.json()
    expect(data.sales.count).toBe(1)
    expect(data.sales.netAmount).toBe(25)
  })

  it('User B should NOT see inventory balances for Channel A', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/accounting/inventory-balances',
      headers: { authorization: `Bearer ${tokenB}` }
    })

    const data = response.json()
    // Even if no channelId is provided, the route should force User B to their own channel
    // and thus NOT show any balances for Channel A
    const found = data.find((ib: any) => ib.channelId === channelAId)
    expect(found).toBeUndefined()
  })

  it('User B should NOT see Channel A chart accounts from raw SQL chart route', async () => {
    const account = await prisma.account.create({
      data: {
        code: `A-${Date.now()}`,
        name: 'Channel A Private Account',
        type: 'ASSET',
        channelId: channelAId,
      },
    })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/accounting/accounts',
      headers: { authorization: `Bearer ${tokenB}` },
    })

    expect(response.statusCode).toBe(200)
    const data = response.json()
    const found = data.find((acct: any) => acct.id === account.id)
    expect(found).toBeUndefined()
  })

  it('User B should NOT read Channel A journal entries by ID', async () => {
    const account = await prisma.account.create({
      data: {
        code: `JE-${Date.now()}`,
        name: 'Channel A Journal Account',
        type: 'ASSET',
        channelId: channelAId,
      },
    })
    const entry = await prisma.journalEntry.create({
      data: {
        description: 'Private Channel A Entry',
        referenceId: 'private-entry',
        referenceType: 'ADJUSTMENT',
        channelId: channelAId,
        postedBy: '550e8400-e29b-41d4-a716-446655440002',
        lines: {
          create: [
            { accountId: account.id, debitAmount: 1, creditAmount: 0 },
          ],
        },
      },
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/accounting/journal-entries/${entry.id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    })

    expect(response.statusCode).toBe(404)
  })

  it('User B should NOT read or reply to Channel A support tickets', async () => {
    const ticket = await prisma.supportTicket.create({
      data: {
        refCode: 'SUP-A-REPORT',
        subject: 'Private Channel A ticket',
        category: 'GENERAL',
        priority: 'MEDIUM',
        userId: '550e8400-e29b-41d4-a716-446655440002',
        channelId: channelAId,
      },
    })

    const readResponse = await app.inject({
      method: 'GET',
      url: `/v1/support/tickets/${ticket.id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    })

    expect(readResponse.statusCode).toBe(403)

    const replyResponse = await app.inject({
      method: 'POST',
      url: `/v1/support/tickets/${ticket.id}/messages`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { content: 'Trying to access another branch ticket' },
    })

    expect(replyResponse.statusCode).toBe(403)
  })

  it('standard managers should NOT approve admin-only approval requests', async () => {
    const approval = await prisma.managerApproval.create({
      data: {
        action: 'purchase_delete',
        contextId: 'purchase-needing-admin',
        channelId: channelBId,
        requesterId: '550e8400-e29b-41d4-a716-446655440003',
      },
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/users/approvals/${approval.id}/approve`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {},
    })

    expect(response.statusCode).toBe(403)
  })
})
