import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { settingsService } from '../dashboard/settings.service.js'
import { RATE } from '../../lib/rate-limit.plugin.js'

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function resolveChannelId(slug?: string) {
  if (!slug) return null

  const normalized = slugify(slug)
  const channels = await prisma.channel.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, code: true },
  })

  const channelMatch = channels.find((channel) =>
    slugify(channel.name) === normalized || slugify(channel.code) === normalized
  )
  if (channelMatch) return channelMatch.id

  const settings = await prisma.setting.findMany({
    where: { key: 'bizSettings' },
    select: { channelId: true, value: true },
  })

  const settingMatch = settings.find((setting) => {
    const businessName = (setting.value as any)?.businessName
    return typeof businessName === 'string' && slugify(businessName) === normalized
  })

  return settingMatch?.channelId ?? null
}

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  const getItems = async (slug?: string) => {
    const channelId = await resolveChannelId(slug)
    if (slug && !channelId) return []

    const branding = await settingsService.getByKey('brandingSettings', channelId)
    if (branding && (branding as any).catalogPublic === false) return []

    const items = await prisma.item.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        imageUrl: { not: null },
        ...(channelId
          ? { inventoryBalances: { some: { channelId, retailPrice: { gt: 0 } } } }
          : { retailPrice: { gt: 0 } }),
      },
      select: {
        id: true,
        name: true,
        imageUrl: true,
        retailPrice: true,
        category: { select: { name: true } },
        inventoryBalances: channelId
          ? {
              where: { channelId },
              select: { retailPrice: true, availableQty: true },
              take: 1,
            }
          : false,
      },
      orderBy: { name: 'asc' },
      take: 50,
    })

    return items.map((item) => {
      const balance = (item as any).inventoryBalances?.[0]
      return {
        id: item.id,
        name: item.name,
        images: item.imageUrl ? [item.imageUrl] : [],
        price: Number(balance?.retailPrice ?? item.retailPrice ?? 0),
        availableQty: Number(balance?.availableQty ?? 0),
        category: item.category,
      }
    })
  }

  const getBranding = async (slug?: string) => {
    const channelId = await resolveChannelId(slug)
    if (slug && !channelId) {
      return {
        branding: {
          logo: '',
          tagline: 'Welcome to our shop',
          primaryColor: '#0ea5e9',
          catalogPublic: false,
        },
        business: { businessName: 'Catalog not found' },
      }
    }

    const branding = await settingsService.getByKey('brandingSettings', channelId)
    const business = await settingsService.getByKey('bizSettings', channelId)

    return {
      branding: branding || {
        logo: '',
        tagline: 'Welcome to our shop',
        primaryColor: '#0ea5e9',
        catalogPublic: true,
      },
      business: business || { businessName: 'LUX POS Retail' },
    }
  }

  app.get('/items', { config: RATE.PUBLIC_CATALOG }, async () => getItems())

  app.get('/:slug/items', { config: RATE.PUBLIC_CATALOG }, async (request) => {
    const { slug } = request.params as { slug: string }
    return getItems(slug)
  })

  app.get('/branding', { config: RATE.PUBLIC_CATALOG }, async () => getBranding())

  app.get('/:slug/branding', { config: RATE.PUBLIC_CATALOG }, async (request) => {
    const { slug } = request.params as { slug: string }
    return getBranding(slug)
  })
}
