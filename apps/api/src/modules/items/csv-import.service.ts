import { parse } from 'csv-parse'
import { Readable } from 'stream'
import { prisma } from '../../lib/prisma.js'

interface CsvItemRow {
  sku: string
  name: string
  barcode?: string
  description?: string
  retailPrice: string
  wholesalePrice: string
  minRetailPrice: string
  weightedAvgCost?: string
  unitOfMeasure?: string
  reorderLevel?: string
  isSerialized?: string
  taxClass?: string
  categoryName?: string
  brandName?: string
  supplierName?: string
}

export class CsvImportService {
  // FIX: imported items were created via a bare prisma.item.create() with no
  // InventoryBalance row at all — unlike itemsService.create() (the normal
  // single-item path), which always anchors a new item into a channel with
  // its pricing. Without that anchor, a CSV-imported item has 0 availableQty
  // everywhere and is invisible to non-HQ (channel-scoped) staff entirely,
  // since item listings filter by inventoryBalances presence per channel —
  // bulk import silently produced catalog entries no one at store level
  // could ever see or sell.
  async importItems(csvBuffer: Buffer, channelId: string) {
    const records: CsvItemRow[] = []
    const errors: { row: number; error: string }[] = []
    let created = 0
    let updated = 0

    // Parse CSV
    const parser = Readable.from(csvBuffer).pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
      })
    )

    for await (const row of parser) {
      records.push(row as CsvItemRow)
    }

    // Process each row
    for (let i = 0; i < records.length; i++) {
      const row = records[i]!
      try {
        // Resolve category by name
        let categoryId: string | undefined
        if (row.categoryName) {
          const cat = await prisma.category.findFirst({
            where: { name: row.categoryName, deletedAt: null },
          })
          if (cat) categoryId = cat.id
        }

        // Resolve brand by name
        let brandId: string | undefined
        if (row.brandName) {
          const brand = await prisma.brand.findFirst({
            where: { name: row.brandName, deletedAt: null },
          })
          if (brand) brandId = brand.id
        }

        // Resolve supplier by name
        let supplierId: string | undefined
        if (row.supplierName) {
          const supplier = await prisma.supplier.findFirst({
            where: { name: row.supplierName, deletedAt: null },
          })
          if (supplier) supplierId = supplier.id
        }

        // Upsert item by SKU
        const existing = await prisma.item.findFirst({
          where: { sku: row.sku, deletedAt: null },
        })

        const itemData = {
          name: row.name,
          barcode: row.barcode || null,
          description: row.description || null,
          retailPrice: parseFloat(row.retailPrice),
          wholesalePrice: parseFloat(row.wholesalePrice),
          minRetailPrice: parseFloat(row.minRetailPrice),
          weightedAvgCost: row.weightedAvgCost ? parseFloat(row.weightedAvgCost) : 0,
          unitOfMeasure: row.unitOfMeasure || 'PCS',
          reorderLevel: row.reorderLevel ? parseInt(row.reorderLevel, 10) : 10,
          isSerialized: row.isSerialized?.toLowerCase() === 'true',
          taxClass: (row.taxClass as 'STANDARD' | 'ZERO_RATED' | 'EXEMPT') || 'STANDARD',
          categoryId: categoryId ?? null,
          brandId: brandId ?? null,
          supplierId: supplierId ?? null,
        }

        if (itemData.weightedAvgCost <= 0) {
          throw new Error('Import Refused: A valid Cost Price is mandatory for every item to ensure margin integrity.')
        }

        const item = existing
          ? await prisma.item.update({ where: { id: existing.id }, data: itemData })
          : await prisma.item.create({ data: { sku: row.sku, ...itemData } })

        // Anchor pricing into the target channel — see FIX note above.
        // availableQty is deliberately left untouched on update (stock
        // levels come from purchases/adjustments, not a catalog re-sync)
        // and defaults to 0 on create (this endpoint sets up the catalog
        // entry, not opening stock).
        await (prisma as any).inventoryBalance.upsert({
          where:  { itemId_channelId: { itemId: item.id, channelId } },
          create: {
            itemId: item.id, channelId,
            retailPrice:     itemData.retailPrice,
            wholesalePrice:  itemData.wholesalePrice,
            minRetailPrice:  itemData.minRetailPrice,
            weightedAvgCost: itemData.weightedAvgCost,
          },
          update: {
            retailPrice:     itemData.retailPrice,
            wholesalePrice:  itemData.wholesalePrice,
            minRetailPrice:  itemData.minRetailPrice,
            weightedAvgCost: itemData.weightedAvgCost,
          },
        })

        if (existing) updated++
        else created++
      } catch (err) {
        errors.push({
          row: i + 2, // 1-indexed + header row
          error: (err as Error).message,
        })
      }
    }

    return {
      total: records.length,
      created,
      updated,
      errors,
    }
  }
}

export const csvImportService = new CsvImportService()
