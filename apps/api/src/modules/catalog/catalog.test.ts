import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../../app.js'
import { prisma } from '../../lib/prisma.js'

describe('Public Catalog', () => {
  let app: any

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns slug-scoped catalog items in the frontend contract', async () => {
    const channel = await prisma.channel.create({
      data: { name: 'Catalog Shop', code: 'CAT-SHOP', type: 'RETAIL_SHOP' },
    })

    await prisma.setting.create({
      data: {
        key: 'bizSettings',
        channelId: channel.id,
        value: { businessName: 'Catalog Shop', phone: '254700000000' },
        updatedBy: 'test',
      },
    })

    await prisma.setting.create({
      data: {
        key: 'brandingSettings',
        channelId: channel.id,
        value: { primaryColor: '#111827', catalogPublic: true },
        updatedBy: 'test',
      },
    })

    const visibleItem = await prisma.item.create({
      data: {
        name: 'Catalog Phone',
        sku: 'CAT-PHONE',
        imageUrl: 'https://example.com/phone.jpg',
        retailPrice: 0,
        wholesalePrice: 1000,
        minRetailPrice: 1100,
        minWholesalePrice: 900,
        weightedAvgCost: 800,
      },
    })

    await prisma.inventoryBalance.create({
      data: {
        itemId: visibleItem.id,
        channelId: channel.id,
        retailPrice: 1150,
        wholesalePrice: 1000,
        minRetailPrice: 1100,
        minWholesalePrice: 900,
        weightedAvgCost: 800,
        availableQty: 3,
      },
    })

    await prisma.item.create({
      data: {
        name: 'Other Channel Item',
        sku: 'OTHER-CAT',
        imageUrl: 'https://example.com/other.jpg',
        retailPrice: 999,
        wholesalePrice: 900,
        minRetailPrice: 950,
        minWholesalePrice: 850,
        weightedAvgCost: 700,
      },
    })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/public/catalog/catalog-shop/items',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({
      id: visibleItem.id,
      name: 'Catalog Phone',
      images: ['https://example.com/phone.jpg'],
      price: 1150,
      availableQty: 3,
    })
  })

  it('hides items when the catalog is disabled', async () => {
    const channel = await prisma.channel.create({
      data: { name: 'Hidden Catalog', code: 'HIDDEN-CAT', type: 'RETAIL_SHOP' },
    })

    await prisma.setting.create({
      data: {
        key: 'brandingSettings',
        channelId: channel.id,
        value: { catalogPublic: false },
        updatedBy: 'test',
      },
    })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/public/catalog/hidden-catalog/items',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })

  it('does not fall back to the global catalog for an unknown slug', async () => {
    const item = await prisma.item.create({
      data: {
        name: 'Global Catalog Item',
        sku: 'GLOBAL-CAT',
        imageUrl: 'https://example.com/global.jpg',
        retailPrice: 2500,
        wholesalePrice: 2000,
        minRetailPrice: 2300,
        minWholesalePrice: 1800,
        weightedAvgCost: 1500,
      },
    })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/public/catalog/does-not-exist/items',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])

    await prisma.item.delete({ where: { id: item.id } })
  })
})
