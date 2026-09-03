import * as XLSX from 'xlsx'
import { prisma } from '../../lib/prisma.js'

export interface DynamicImportRow {
  name: string
  buyingPrice?: number | string
  costPrice?: number | string
  weightedAvgCost?: number | string
  sellingPrice?: number | string
  retailPrice?: number | string
  wholesalePrice?: number | string
  minRetailPrice?: number | string
  openingStock?: number | string
  quantity?: number | string
  availableQty?: number | string
  sku?: string
  barcode?: string
  category?: string
  categoryName?: string
  brand?: string
  brandName?: string
  supplier?: string
  supplierName?: string
  reorderLevel?: number | string
  unitOfMeasure?: string
  description?: string
  taxClass?: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT'
}

export interface ImportOptions {
  channelId: string
  enterpriseId?: string | null
  actorId: string
  duplicateMode?: 'UPDATE' | 'SKIP'
}

export interface ImportResult {
  total: number
  created: number
  updated: number
  skipped: number
  totalStockAdded: number
  totalValuation: number
  errors: Array<{ row: number; item?: string; error: string }>
}

export class InventoryImportService {
  /**
   * Sanitizes dirty numbers (e.g. "Ksh 1,500.00", "120,50", "  24 ") into clean floats.
   */
  private cleanNumber(val: unknown, fallback = 0): number {
    if (val === null || val === undefined || val === '') return fallback
    if (typeof val === 'number') return isNaN(val) ? fallback : val

    let str = String(val)
      .replace(/[^\d.,-]/g, '') // keep digits, period, comma, minus
      .trim()

    // If both comma and period exist (e.g. 1,200.50 or 1.200,50)
    if (str.includes(',') && str.includes('.')) {
      if (str.indexOf(',') < str.indexOf('.')) {
        // e.g. 1,200.50 -> comma is thousands separator
        str = str.replace(/,/g, '')
      } else {
        // e.g. 1.200,50 -> period is thousands separator, comma is decimal
        str = str.replace(/\./g, '').replace(',', '.')
      }
    } else if (str.includes(',')) {
      // Only comma exists.
      // If there are exactly 3 digits after the comma (e.g. "1,000" or "50,000"), it's a thousands separator
      // If there are 1 or 2 digits after the comma (e.g. "120,50" or "45,5"), it's a decimal separator
      const parts = str.split(',')
      if (parts.length === 2 && (parts[1]?.length === 1 || parts[1]?.length === 2)) {
        str = str.replace(',', '.')
      } else {
        str = str.replace(/,/g, '')
      }
    }

    const num = parseFloat(str)
    return isNaN(num) ? fallback : num
  }

  /**
   * Recovers barcodes that Excel may have converted to scientific notation (e.g. 6.1611E+12).
   */
  private cleanBarcode(val: unknown): string | null {
    if (val === null || val === undefined) return null
    let str = String(val).trim().replace(/['"]/g, '')
    if (!str) return null

    // Check for scientific notation like 6.1611E+12
    if (/[eE]\+?/.test(str)) {
      try {
        const num = Number(str)
        if (!isNaN(num)) {
          str = num.toLocaleString('fullwide', { useGrouping: false })
        }
      } catch {
        // keep original string if parsing fails
      }
    }
    return str
  }

  /**
   * Auto-generates a clean unique SKU if user omitted it.
   */
  private generateUniqueSku(index: number): string {
    const timestamp = Date.now().toString(36).toUpperCase().slice(-4)
    const randomSuffix = Math.random().toString(36).slice(-3).toUpperCase()
    const seq = (index + 1).toString().padStart(4, '0')
    return `SKU-${timestamp}${seq}-${randomSuffix}`
  }

  /**
   * Main Dynamic Ingestion Engine:
   * Accepts arbitrary mapped rows, sanitizes inputs, auto-creates taxonomies,
   * anchors opening stock, and logs stock movements.
   */
  async importDynamicItems(rows: DynamicImportRow[], options: ImportOptions): Promise<ImportResult> {
    const { channelId, enterpriseId, actorId, duplicateMode = 'UPDATE' } = options
    const errors: Array<{ row: number; item?: string; error: string }> = []
    let created = 0
    let updated = 0
    let skipped = 0
    let totalStockAdded = 0
    let totalValuation = 0

    // In-memory caches for fast taxonomy resolution and creation
    const categoryCache = new Map<string, string>() // lowerName -> id
    const brandCache = new Map<string, string>()
    const supplierCache = new Map<string, string>()

    // Pre-populate existing categories
    const existingCats = await prisma.category.findMany({
      where: { deletedAt: null, ...(channelId ? { channelId } : {}) },
      select: { id: true, name: true }
    })
    for (const c of existingCats) categoryCache.set(c.name.toLowerCase().trim(), c.id)

    const existingBrands = await prisma.brand.findMany({
      where: { deletedAt: null, ...(channelId ? { channelId } : {}) },
      select: { id: true, name: true }
    })
    for (const b of existingBrands) brandCache.set(b.name.toLowerCase().trim(), b.id)

    const existingSuppliers = await prisma.supplier.findMany({
      where: { deletedAt: null, ...(channelId ? { channelId } : {}) },
      select: { id: true, name: true }
    })
    for (const s of existingSuppliers) supplierCache.set(s.name.toLowerCase().trim(), s.id)

    // Process rows in batches of 50 inside transactions for performance and safety
    const BATCH_SIZE = 50
    for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_SIZE) {
      const batch = rows.slice(batchStart, batchStart + BATCH_SIZE)

      await prisma.$transaction(async (tx) => {
        for (let i = 0; i < batch.length; i++) {
          const rowIndex = batchStart + i + 1 // 1-indexed
          const row = batch[i]!

          try {
            const rawName = (row.name || '').trim()
            if (!rawName) {
              errors.push({ row: rowIndex, error: 'Missing mandatory Item Name' })
              continue
            }

            // Normalise numeric values
            const costPrice = this.cleanNumber(row.costPrice ?? row.buyingPrice ?? row.weightedAvgCost, 0)
            const retailPrice = this.cleanNumber(row.retailPrice ?? row.sellingPrice, 0)
            const wholesalePrice = this.cleanNumber(row.wholesalePrice, retailPrice)
            const minRetailPrice = this.cleanNumber(row.minRetailPrice, costPrice > 0 ? costPrice : retailPrice)
            const openingQty = Math.max(0, Math.floor(this.cleanNumber(row.openingStock ?? row.quantity ?? row.availableQty, 0)))
            const reorderLevel = Math.max(0, Math.floor(this.cleanNumber(row.reorderLevel, 5)))
            const barcode = this.cleanBarcode(row.barcode)
            const unitOfMeasure = (row.unitOfMeasure || 'PCS').trim().toUpperCase()
            const description = row.description ? String(row.description).trim() : null
            const taxClass = (row.taxClass as any) || 'STANDARD'

            // Category resolution / auto-creation
            let categoryId: string | null = null
            const catName = (row.categoryName || row.category || '').trim()
            if (catName) {
              const lowerCat = catName.toLowerCase()
              if (categoryCache.has(lowerCat)) {
                categoryId = categoryCache.get(lowerCat)!
              } else {
                const newCat = await tx.category.create({
                  data: {
                    name: catName,
                    channelId: channelId || null,
                  }
                })
                categoryId = newCat.id
                categoryCache.set(lowerCat, newCat.id)
              }
            }

            // Brand resolution / auto-creation
            let brandId: string | null = null
            const brandName = (row.brandName || row.brand || '').trim()
            if (brandName) {
              const lowerBrand = brandName.toLowerCase()
              if (brandCache.has(lowerBrand)) {
                brandId = brandCache.get(lowerBrand)!
              } else {
                const newBrand = await tx.brand.create({
                  data: {
                    name: brandName,
                    channelId: channelId || null,
                  }
                })
                brandId = newBrand.id
                brandCache.set(lowerBrand, newBrand.id)
              }
            }

            // Supplier resolution / auto-creation
            let supplierId: string | null = null
            const supName = (row.supplierName || row.supplier || '').trim()
            if (supName) {
              const lowerSup = supName.toLowerCase()
              if (supplierCache.has(lowerSup)) {
                supplierId = supplierCache.get(lowerSup)!
              } else {
                const newSup = await tx.supplier.create({
                  data: {
                    name: supName,
                    channelId: channelId || null,
                  }
                })
                supplierId = newSup.id
                supplierCache.set(lowerSup, newSup.id)
              }
            }

            // Check for existing item by SKU or Barcode
            const cleanSku = (row.sku || '').trim()
            let existingItem = null

            if (cleanSku) {
              existingItem = await tx.item.findFirst({
                where: { sku: cleanSku, deletedAt: null, ...(enterpriseId ? { enterpriseId } : {}) }
              })
            }

            if (!existingItem && barcode) {
              existingItem = await tx.item.findFirst({
                where: { barcode, deletedAt: null, ...(enterpriseId ? { enterpriseId } : {}) }
              })
            }

            let itemId: string

            if (existingItem) {
              if (duplicateMode === 'SKIP') {
                skipped++
                continue
              }

              // Update existing item
              const updatedItem = await tx.item.update({
                where: { id: existingItem.id },
                data: {
                  name: rawName,
                  retailPrice,
                  wholesalePrice,
                  minRetailPrice,
                  weightedAvgCost: costPrice > 0 ? costPrice : existingItem.weightedAvgCost,
                  reorderLevel,
                  unitOfMeasure,
                  ...(description && { description }),
                  ...(categoryId && { categoryId }),
                  ...(brandId && { brandId }),
                  ...(supplierId && { supplierId }),
                }
              })
              itemId = updatedItem.id
              updated++
            } else {
              // Create new item with generated SKU if not provided
              const finalSku = cleanSku || this.generateUniqueSku(rowIndex)
              const newItem = await tx.item.create({
                data: {
                  sku: finalSku,
                  barcode: barcode || null,
                  name: rawName,
                  description,
                  retailPrice,
                  wholesalePrice,
                  minRetailPrice,
                  weightedAvgCost: costPrice,
                  reorderLevel,
                  unitOfMeasure,
                  taxClass,
                  categoryId,
                  brandId,
                  supplierId,
                  enterpriseId: enterpriseId || null,
                }
              })
              itemId = newItem.id
              created++
            }

            // Anchor into InventoryBalance for the designated store branch
            const existingBalance = await (tx as any).inventoryBalance.findUnique({
              where: { itemId_channelId: { itemId, channelId } }
            })

            if (!existingBalance) {
              await (tx as any).inventoryBalance.create({
                data: {
                  itemId,
                  channelId,
                  availableQty: openingQty,
                  weightedAvgCost: costPrice,
                  retailPrice,
                  wholesalePrice,
                  minRetailPrice,
                }
              })
            } else {
              await (tx as any).inventoryBalance.update({
                where: { itemId_channelId: { itemId, channelId } },
                data: {
                  ...(openingQty > 0 && { availableQty: { increment: openingQty } }),
                  ...(costPrice > 0 && { weightedAvgCost: costPrice }),
                  retailPrice,
                  wholesalePrice,
                  minRetailPrice,
                }
              })
            }

            // Record OPENING_STOCK movement if quantity is provided
            if (openingQty > 0) {
              await tx.stockMovement.create({
                data: {
                  itemId,
                  channelId,
                  quantityChange: openingQty,
                  movementType: 'OPENING_STOCK',
                  referenceId: 'BULK-IMPORT',
                  referenceType: 'ONBOARDING',
                  unitCostAtTime: costPrice,
                  performedBy: actorId,
                  notes: `Opening inventory imported via dynamic onboarding wizard (${openingQty} ${unitOfMeasure})`
                }
              })

              totalStockAdded += openingQty
              totalValuation += openingQty * (costPrice > 0 ? costPrice : retailPrice)
            }
          } catch (rowErr: any) {
            errors.push({
              row: rowIndex,
              item: row.name,
              error: rowErr.message || 'Row processing failure'
            })
          }
        }
      })
    }

    return {
      total: rows.length,
      created,
      updated,
      skipped,
      totalStockAdded,
      totalValuation,
      errors,
    }
  }

  /**
   * Backwards-compatible buffer importer:
   * Parses either .xlsx, .xls, or .csv buffers into rows and executes importDynamicItems.
   */
  async importItems(fileBuffer: Buffer, channelId: string, enterpriseId?: string | null, actorId = 'SYSTEM') {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' })
    const firstSheetName = workbook.SheetNames[0]
    if (!firstSheetName) throw new Error('No readable sheets found in file')

    const worksheet = workbook.Sheets[firstSheetName]!
    const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' })

    // Normalize keys: maps various potential header names to canonical DynamicImportRow fields
    const normalizedRows: DynamicImportRow[] = rawRows.map(r => {
      const getVal = (...keys: string[]) => {
        for (const k of keys) {
          const targetKey = k.toLowerCase().replace(/[^a-z0-9]/g, '')
          for (const rowKey of Object.keys(r)) {
            const cleanRowKey = rowKey.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
            if (cleanRowKey === targetKey || cleanRowKey.includes(targetKey)) {
              return r[rowKey]
            }
          }
        }
        return undefined
      }

      return {
        name: String(getVal('item name', 'name', 'product name', 'description', 'product') || ''),
        buyingPrice: getVal('buying price', 'cost price', 'cost', 'purchase price', 'buying cost', 'weightedavgcost'),
        sellingPrice: getVal('selling price', 'retail price', 'price', 'retail'),
        wholesalePrice: getVal('wholesale price', 'wholesale'),
        openingStock: getVal('opening stock', 'quantity', 'qty', 'opening stock qty', 'stock quantity', 'in stock', 'count'),
        sku: getVal('sku', 'item code', 'code', 'product code'),
        barcode: getVal('barcode', 'upc', 'ean', 'barcode number'),
        category: getVal('category', 'category name', 'department'),
        brand: getVal('brand', 'brand name', 'make', 'manufacturer'),
        supplier: getVal('supplier', 'supplier name', 'vendor'),
        reorderLevel: getVal('reorder level', 'min stock', 'alert level'),
        unitOfMeasure: getVal('unit of measure', 'unit', 'uom'),
        description: getVal('description', 'notes'),
      }
    })

    return this.importDynamicItems(normalizedRows, {
      channelId,
      enterpriseId,
      actorId,
      duplicateMode: 'UPDATE',
    })
  }
}

export const inventoryImportService = new InventoryImportService()
export const csvImportService = inventoryImportService
