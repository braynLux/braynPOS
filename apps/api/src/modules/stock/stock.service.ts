import { prisma, basePrisma } from '../../lib/prisma.js'
import { Prisma } from '@prisma/client'

export class StockService {
  /**
   * Get live stock balance from inventory_balances (NOT stock_levels view).
   * This is the source of truth for available stock.
   */
  async getBalance(itemId: string, channelId: string): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ availableQty: number; incomingQty: number }>>`
      SELECT "availableQty", "incomingQty" FROM inventory_balances
      WHERE "itemId" = ${itemId} AND "channelId" = ${channelId}
    `
    return rows[0]?.availableQty ?? 0
  }

  private async getThreshold(channelId: string): Promise<number> {
    const setting = await prisma.setting.findFirst({
      where: { key: 'notifSettings', OR: [{ channelId }, { channelId: null }] },
      orderBy: { channelId: 'desc' } // Channel specific first
    })
    return (setting?.value as any)?.lowStockThreshold ?? 5
  }

  async getChannelBalances(channelId?: string, categoryId?: string, enterpriseId?: string) {
    const isGlobal = !channelId || channelId === '';
    
    const channelFilter = !isGlobal
      ? Prisma.sql`AND ib."channelId" = ${channelId}`
      : enterpriseId
      ? Prisma.sql`AND ib."channelId" IN (SELECT id FROM channels WHERE "enterpriseId" = ${enterpriseId} AND "deletedAt" IS NULL)`
      : Prisma.empty

    const itemFilter = enterpriseId
      ? Prisma.sql`AND i."enterpriseId" = ${enterpriseId}`
      : Prisma.empty

    let catFilter = Prisma.empty;
    if (categoryId && categoryId !== '') {
      const selectedCat = await prisma.category.findUnique({ where: { id: categoryId }, select: { name: true } });
      if (selectedCat) {
        const matchingCats = await prisma.category.findMany({
          where: { name: { equals: selectedCat.name, mode: 'insensitive' }, deletedAt: null },
          select: { id: true }
        });
        const catIds = matchingCats.map(c => c.id);
        if (catIds.length > 0) {
          catFilter = Prisma.sql`AND i."categoryId" IN (${Prisma.join(catIds)})`;
        }
      }
    }

    const query = Prisma.sql`
      SELECT 
        i."id" as "itemId", 
        i."name" as "itemName", 
        i."sku", 
        c."name" as "category",
        CAST(COALESCE(SUM(ib."availableQty"), 0) AS FLOAT) as "availableQty", 
        CAST(COALESCE(SUM(ib."incomingQty"), 0) AS FLOAT) as "incomingQty", 
        CAST(COALESCE(MAX(ib."weightedAvgCost"), 0) AS FLOAT) as "weightedAvgCost",
        i."reorderLevel",
        MAX(ib."lastMovementAt") as "lastMovementAt"
      FROM "items" i
      LEFT JOIN "categories" c ON i."categoryId" = c."id"
      INNER JOIN "inventory_balances" ib ON i."id" = ib."itemId" 
      WHERE i."deletedAt" IS NULL 
        AND i."isActive" = true
        ${itemFilter}
        ${channelFilter}
        ${catFilter}
        -- FIX: Use a subquery to check for ANY actual activity (stock or history) in the TARGET channel(s)
        AND (
          ib."availableQty" > 0 
          OR ib."incomingQty" > 0 
          OR EXISTS (
            SELECT 1 FROM "stock_movements" sm 
            WHERE sm."itemId" = i."id" 
              AND sm."channelId" = ib."channelId" 
            LIMIT 1
          )
        )
      GROUP BY i."id", c."id", c."name", i."name", i."sku", i."reorderLevel"
      ORDER BY i."name" ASC
    `;

    return prisma.$queryRaw<any[]>(query);
  }

  /**
   * Get balances across all channels for an item.
   */
  async getItemBalancesAllChannels(itemId: string, enterpriseId?: string) {
    return prisma.$queryRaw<
      Array<{ channelId: string; availableQty: number; incomingQty: number; lastMovementAt: Date; channelName: string; channelCode: string }>
    >`
      SELECT 
        ib."channelId", 
        ib."availableQty", 
        ib."incomingQty", 
        ib."lastMovementAt",
        c."name" as "channelName",
        c."code" as "channelCode"
      FROM "inventory_balances" ib
      JOIN "channels" c ON ib."channelId" = c."id"
      WHERE ib."itemId" = ${itemId}
        AND c."deletedAt" IS NULL
        ${enterpriseId ? Prisma.sql`AND c."enterpriseId" = ${enterpriseId}` : Prisma.empty}
    `
  }

  async getLowStockItems(channelId?: string, categoryId?: string, enterpriseId?: string) {
    const isGlobal = !channelId || channelId === '';
    const threshold = await this.getThreshold(channelId || '');

    const channelFilter = !isGlobal
      ? Prisma.sql`AND ib."channelId" = ${channelId}`
      : enterpriseId
      ? Prisma.sql`AND ib."channelId" IN (SELECT id FROM channels WHERE "enterpriseId" = ${enterpriseId} AND "deletedAt" IS NULL)`
      : Prisma.empty

    const itemFilter = enterpriseId
      ? Prisma.sql`AND i."enterpriseId" = ${enterpriseId}`
      : Prisma.empty

    let catFilter = Prisma.empty;
    if (categoryId && categoryId !== '') {
      const selectedCat = await prisma.category.findUnique({ where: { id: categoryId }, select: { name: true } });
      if (selectedCat) {
        const matchingCats = await prisma.category.findMany({
          where: { name: { equals: selectedCat.name, mode: 'insensitive' }, deletedAt: null },
          select: { id: true }
        });
        const catIds = matchingCats.map(c => c.id);
        if (catIds.length > 0) {
          catFilter = Prisma.sql`AND i."categoryId" IN (${Prisma.join(catIds)})`;
        }
      }
    }

    const query = Prisma.sql`
      SELECT
        i."id" as "itemId",
        i."name" as "itemName",
        i."sku",
        c."name" as "category",
        CAST(SUM(COALESCE(ib."availableQty", 0)) AS FLOAT) as "availableQty",
        CAST(SUM(COALESCE(ib."incomingQty", 0)) AS FLOAT) as "incomingQty",
        CAST(COALESCE(MAX(ib."weightedAvgCost"), 0) AS FLOAT) as "weightedAvgCost",
        i."reorderLevel",
        MAX(ib."lastMovementAt") as "lastMovementAt"
      FROM "items" i
      LEFT JOIN "categories" c ON i."categoryId" = c."id"
      INNER JOIN "inventory_balances" ib ON ib."itemId" = i."id" 
      WHERE i."deletedAt" IS NULL AND i."isActive" = true
        ${itemFilter}
        ${channelFilter}
        ${catFilter}
        -- Filter out ghost rows
        AND (
          ib."availableQty" > 0 
          OR ib."incomingQty" > 0 
          OR EXISTS (
            SELECT 1 FROM "stock_movements" sm 
            WHERE sm."itemId" = i."id" 
              AND sm."channelId" = ib."channelId" 
            LIMIT 1
          )
        )
      GROUP BY i."id", c."id", c."name", i."name", i."sku", i."reorderLevel"
      HAVING SUM(COALESCE(ib."availableQty", 0)) <= GREATEST(COALESCE(i."reorderLevel", 5), ${threshold})
      ORDER BY SUM(COALESCE(ib."availableQty", 0)) ASC
    `;

    return prisma.$queryRaw<any[]>(query);
  }

  /**
   * Get stock movement history for an item in a channel.
   */
  async getMovementHistory(
    itemId: string,
    channelId: string,
    page = 1,
    limit = 50
  ) {
    const skip = (page - 1) * limit

    const [data, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where: { itemId, channelId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          item: { select: { name: true, sku: true } },
        },
      }),
      prisma.stockMovement.count({ where: { itemId, channelId } }),
    ])

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }
  }
}

export const stockService = new StockService()
// Ghost filtering active
