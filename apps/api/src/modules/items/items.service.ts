import { prisma, basePrisma } from '../../lib/prisma.js'
import { randomBytes } from 'crypto'
import type { Prisma } from '@prisma/client'
import type { ListItemsInput, CreateItemInput, UpdateItemInput } from './items.schema.js'
import { filterItemArray, filterItemFields } from '../../lib/field-filter.js'
import { requestContext }                     from '../../lib/request-context.plugin.js'
import { logAction, AUDIT }                  from '../../lib/audit.js'

export class ItemsService {
  async findAll(query: ListItemsInput, actorRole: string) {
    const page  = query.page  ?? 1
    // FIX 13: Cap limit to prevent full-table dumps
    const limit = Math.min(query.limit ?? 25, 100)
    const skip  = (page - 1) * limit

    const where: Prisma.ItemWhereInput = {
      deletedAt: null,
      isActive:  true,
      ...(query.isActive      !== undefined && { isActive:      query.isActive }),
      ...(query.isSerialized  !== undefined && { isSerialized:  query.isSerialized }),
      ...(query.search        && {
        OR: [
          { name:    { contains: query.search, mode: 'insensitive' } },
          { sku:     { contains: query.search, mode: 'insensitive' } },
          { barcode: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    }

    if (query.categoryId) {
      const cat = await prisma.category.findUnique({ where: { id: query.categoryId } })
      if (cat) {
        const matching = await prisma.category.findMany({ where: { name: { equals: cat.name, mode: 'insensitive' }, deletedAt: null } })
        where.categoryId = { in: matching.map(m => m.id) }
      } else { where.categoryId = query.categoryId }
    }
    if (query.brandId) {
      const br = await prisma.brand.findUnique({ where: { id: query.brandId } })
      if (br) {
        const matching = await prisma.brand.findMany({ where: { name: { equals: br.name, mode: 'insensitive' }, deletedAt: null } })
        where.brandId = { in: matching.map(m => m.id) }
      } else { where.brandId = query.brandId }
    }
    if (query.supplierId) {
      const sup = await prisma.supplier.findUnique({ where: { id: query.supplierId } })
      if (sup) {
        const matching = await prisma.supplier.findMany({ where: { name: { equals: sup.name, mode: 'insensitive' }, deletedAt: null } })
        where.supplierId = { in: matching.map(m => m.id) }
      } else { where.supplierId = query.supplierId }
    }

    if (query.channelId) {
      where.inventoryBalances = { some: { channelId: query.channelId } }
    }

    const buildOrderBy = () => {
      const order = (query.sortOrder || 'asc').toLowerCase() as 'asc' | 'desc'
      const field = query.sortBy || 'name'
      
      switch (field) {
        case 'category':   return { category: { name: order } }
        case 'brand':      return { brand:    { name: order } }
        case 'supplier':   return { supplier: { name: order } }
        case 'retailPrice': return { retailPrice: order }
        case 'createdAt':   return { createdAt: order }
        case 'sku':         return { sku: order }
        case 'name':
        default:            return { name: order }
      }
    }

    const orderBy = buildOrderBy()
    const isGlobal = !query.channelId || query.channelId === ''

    const [data, total] = await Promise.all([
      prisma.item.findMany({
        where, skip, take: limit,
        orderBy: orderBy as any,
        include: {
          category: { select: { id: true, name: true } },
          brand:    { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          inventoryBalances: isGlobal 
            ? { select: { channelId: true, availableQty: true, retailPrice: true, wholesalePrice: true, weightedAvgCost: true } }
            : { where: { channelId: query.channelId }, take: 1 },
        } as any,
      }),
      prisma.item.count({ where }),
    ])

    const formattedData = data.map(item => {
      const balances = (item as any).inventoryBalances || []
      const local    = query.channelId 
        ? balances[0] 
        : (balances as any[]).find((b: any) => b.channelId === (requestContext.getStore()?.channelId)) || balances[0]

      const totalQty = (balances as any[]).reduce((sum: number, b: any) => sum + Number(b.availableQty || 0), 0)

      return {
        ...item,
        availableQty:    query.channelId ? (local?.availableQty || 0) : totalQty,
        retailPrice:     Number(local?.retailPrice    ?? item.retailPrice    ?? 0),
        wholesalePrice:  Number(local?.wholesalePrice ?? item.wholesalePrice ?? 0),
        weightedAvgCost: Number(local?.weightedAvgCost ?? item.weightedAvgCost ?? 0),
      }
    })

    return {
      data: filterItemArray(formattedData, actorRole),
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    }
  }

  async findById(id: string, actorRole: string, channelId?: string) {
    return prisma.item.findUniqueOrThrow({
      where: { id, deletedAt: null },
      include: {
        category: true, brand: true, supplier: true,
        inventoryBalances: channelId ? { where: { channelId }, take: 1 } : undefined,
      } as any,
    }).then(item => {
      const balance = (item as any).inventoryBalances?.[0]
      
      // Enforce ghost filtering for non-admins: if no balance in their channel, item doesn't exist for them
      if (channelId && !['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN'].includes(actorRole) && !balance) {
        throw Object.assign(new Error('NotFoundError: No Item found'), { statusCode: 404 })
      }

      const formatted = balance ? {
        ...item,
        retailPrice:       balance.retailPrice,
        wholesalePrice:    balance.wholesalePrice,
        minRetailPrice:    balance.minRetailPrice,
        minWholesalePrice: balance.minWholesalePrice,
        weightedAvgCost:   balance.weightedAvgCost,
      } : item

      return filterItemFields(formatted, actorRole)
    })
  }

  async findBySku(sku: string) {
    return prisma.item.findFirst({ where: { sku, deletedAt: null } })
  }

  async findByBarcode(barcode: string) {
    return prisma.item.findFirst({ where: { barcode, deletedAt: null } })
  }

  async create(data: CreateItemInput & { creatorChannelId?: string; creatorId?: string; enterpriseId?: string | null }) {
    const { creatorChannelId, creatorId, enterpriseId, ...itemData } = data

    // FIX 12: Use cryptographically random suffix — Math.random() exhausts
    // easily under bulk imports with concurrent requests.
    const sku = itemData.sku
      || `ITEM-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`

    if (!itemData.weightedAvgCost || Number(itemData.weightedAvgCost) <= 0) {
      throw {
        statusCode: 422,
        message: `Product Creation Blocked: A valid Cost Price is mandatory. You cannot create a product with zero cost as it breaks margin calculations.`
      }
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const item = await tx.item.create({
          data: {
            ...itemData,
            sku,
            enterpriseId:      enterpriseId ?? undefined,
            retailPrice:       itemData.retailPrice,
            wholesalePrice:    (itemData.wholesalePrice && Number(itemData.wholesalePrice) > 0) ? itemData.wholesalePrice : itemData.retailPrice,
            minRetailPrice:    (itemData.minRetailPrice && Number(itemData.minRetailPrice) > 0) ? itemData.minRetailPrice : itemData.retailPrice,
            minWholesalePrice: (itemData.minWholesalePrice && Number(itemData.minWholesalePrice) > 0) ? itemData.minWholesalePrice : (itemData.wholesalePrice ?? itemData.retailPrice),
            weightedAvgCost:   itemData.weightedAvgCost   ?? 0,
          },
        })

        if (creatorChannelId && creatorId) {
          await (tx as any).inventoryBalance.create({
            data: {
              itemId:            item.id,
              channelId:         creatorChannelId,
              retailPrice:       itemData.retailPrice,
              wholesalePrice:    itemData.wholesalePrice    ?? itemData.retailPrice,
              minRetailPrice:    itemData.minRetailPrice    ?? itemData.retailPrice,
              minWholesalePrice: itemData.minWholesalePrice ?? itemData.wholesalePrice ?? itemData.retailPrice,
              weightedAvgCost:   itemData.weightedAvgCost   ?? 0,
            },
          })

          if (itemData.type !== 'SERVICE') {
            await tx.stockMovement.create({
              data: {
                itemId:         item.id,
                channelId:      creatorChannelId,
                movementType:   'ADJUSTMENT_IN',
                quantityChange: 0,
                referenceId:    item.id,
                referenceType:  'adjustment',
                performedBy:    creatorId,
                notes:          'Initial channel anchoring with local pricing',
              },
            })
          }
        }

        logAction({
          action:     AUDIT.ITEM_CREATE,
          actorId:    creatorId || 'SYSTEM',
          actorRole:  'INTERNAL',
          channelId:  creatorChannelId,
          targetType: 'Item',
          targetId:   item.id,
          newValues:  item,
        })

        return item
      })
    } catch (err) {
      if ((err as any).code === 'P2002') {
        throw { statusCode: 400, message: `An item with SKU "${sku}" already exists` }
      }
      throw err
    }
  }

  async update(id: string, data: UpdateItemInput & { channelId?: string }) {
    const ctx = requestContext.getStore()
    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN'].includes(ctx?.role || '')

    // Isolation check: if not admin, user must have a balance for this item in their channel to edit it
    if (!isAdmin && data.channelId) {
      const hasBalance = await prisma.inventoryBalance.findUnique({
        where: { itemId_channelId: { itemId: id, channelId: data.channelId } }
      })
      if (!hasBalance) {
        throw { statusCode: 403, message: 'Access denied: Item not available in your channel' }
      }
    }

    const { channelId, ...itemData } = data
    const itemFields    = ['sku', 'barcode', 'name', 'description', 'categoryId', 'brandId', 'supplierId', 'unitOfMeasure', 'packSize', 'reorderLevel', 'isSerialized', 'taxClass', 'imageUrl', 'isActive']
    const balanceFields = ['retailPrice', 'wholesalePrice', 'minRetailPrice', 'minWholesalePrice', 'weightedAvgCost']

    const updateData: any  = {}
    const balanceData: any = {}

    itemFields.forEach(f => {
      if ((itemData as any)[f] !== undefined) updateData[f] = (itemData as any)[f]
    })
    balanceFields.forEach(f => {
      if ((itemData as any)[f] !== undefined) balanceData[f] = (itemData as any)[f]
    })

    if (isAdmin) {
      Object.assign(updateData, balanceData)
    }

    return prisma.$transaction(async (tx) => {
      const oldItem = await tx.item.findUnique({ where: { id } })
      const item = await tx.item.update({ where: { id }, data: updateData })

      let balanceResult: any = null
      if (channelId && Object.keys(balanceData).length > 0) {
        const oldBalance = await (tx as any).inventoryBalance.findUnique({
           where: { itemId_channelId: { itemId: id, channelId } }
        })

        balanceResult = await (tx as any).inventoryBalance.upsert({
          where:  { itemId_channelId: { itemId: id, channelId } },
          create: { itemId: id, channelId, ...balanceData },
          update: balanceData,
        })

        if (balanceData.weightedAvgCost !== undefined && Number(oldBalance?.weightedAvgCost || 0) !== Number(balanceData.weightedAvgCost)) {
        }
      }

      logAction({
        action:     AUDIT.ITEM_UPDATE,
        actorId:    ctx?.userId || 'SYSTEM',
        actorRole:  ctx?.role    || 'INTERNAL',
        channelId:  channelId   || ctx?.channelId || undefined,
        targetType: 'Item',
        targetId:   id,
        oldValues:  { ...oldItem, ...(balanceResult ? { costPrice: oldItem?.weightedAvgCost } : {}) },
        newValues:  { ...item,    ...(balanceResult ? { costPrice: balanceResult.weightedAvgCost } : {}) },
      })

      return { ...item, ...(balanceResult || {}) }
    })
  }

  async softDelete(id: string, password?: string) {
    const ctx = requestContext.getStore()
    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN'].includes(ctx?.role || '')
    const channelId = ctx?.channelId
    const userId = ctx?.userId

    if (!password) {
      throw { statusCode: 400, message: 'Password confirmation required for deletion' }
    }

    if (userId) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
      const { verifyPassword } = await import('../../lib/password.js')
      const valid = await verifyPassword(user.passwordHash, password)
      if (!valid) throw { statusCode: 401, message: 'Invalid password. Deletion aborted.' }
    }

    if (!isAdmin && channelId) {
      const hasBalance = await prisma.inventoryBalance.findUnique({
        where: { itemId_channelId: { itemId: id, channelId } }
      })
      if (!hasBalance) {
        throw { statusCode: 403, message: 'Access denied: Item not available in your channel' }
      }
    }

    const itemToDel = await prisma.item.findUnique({ where: { id } })
    const item = await prisma.item.update({
      where: { id },
      data:  { 
        deletedAt: new Date(), 
        isActive: false,
        sku: `${itemToDel?.sku}_del_${Date.now()}`
      },
    })

    logAction({
      action:     AUDIT.ITEM_DELETE,
      actorId:    ctx?.userId   || 'SYSTEM',
      actorRole:  ctx?.role     || 'INTERNAL',
      channelId:  ctx?.channelId || undefined,
      targetType: 'Item',
      targetId:   id,
    })

    return item
  }

  async recalculateWAC(itemId: string, channelId: string, incomingQty: number, incomingCost: number, referenceId?: string) {
    const balance = await (prisma as any).inventoryBalance.findUnique({
      where: { itemId_channelId: { itemId, channelId } },
    })

    const currentQty = balance?.availableQty || 0
    const currentWAC = Number(balance?.weightedAvgCost || 0)
    const totalValue = (currentQty * currentWAC) + (incomingQty * incomingCost)
    const totalQty   = currentQty + incomingQty
    const newWAC     = totalQty > 0 ? totalValue / totalQty : incomingCost

    await (prisma as any).inventoryBalance.upsert({
      where:  { itemId_channelId: { itemId, channelId } },
      create: { itemId, channelId, weightedAvgCost: newWAC },
      update: { weightedAvgCost: newWAC },
    })

    if (currentWAC !== newWAC) {
       const ctx = requestContext.getStore()
    }

    return newWAC
  }

  async ensureMetadata(channelId: string, sourceItem: any) {
    const { category, brand, supplier } = sourceItem

    let localCategoryId: string | undefined
    let localBrandId:    string | undefined
    let localSupplierId: string | undefined

    if (category) {
      try {
        const created   = await prisma.category.create({ data: { name: category.name, channelId, parentId: null } })
        localCategoryId = created.id
      } catch (err: any) {
        if (err.code === 'P2002') {
          const existing  = await prisma.category.findFirst({ where: { name: category.name, channelId } })
          localCategoryId = existing?.id
        } else { throw err }
      }
    }

    if (brand) {
      try {
        const created = await prisma.brand.create({ data: { name: brand.name, channelId } })
        localBrandId  = created.id
      } catch (err: any) {
        if (err.code === 'P2002') {
          const existing = await prisma.brand.findFirst({ where: { name: brand.name, channelId } })
          localBrandId   = existing?.id
        } else { throw err }
      }
    }

    if (supplier) {
      try {
        const created   = await prisma.supplier.create({
          data: { name: supplier.name, channelId, phone: supplier.phone, email: supplier.email, address: supplier.address },
        })
        localSupplierId = created.id
      } catch (err: any) {
        if (err.code === 'P2002') {
          const existing  = await prisma.supplier.findFirst({ where: { name: supplier.name, channelId } })
          localSupplierId = existing?.id
        } else { throw err }
      }
    }

    return { localCategoryId, localBrandId, localSupplierId }
  }

  async findAllBrands(channelId?: string, enterpriseId?: string) {
    const where: Prisma.BrandWhereInput = { deletedAt: null }
    if (channelId) {
      where.OR = [{ channelId }, { channelId: null }]
    } else if (enterpriseId) {
      where.channel = { enterpriseId, deletedAt: null }
    }
    const brands = await prisma.brand.findMany({
      where,
      orderBy: { name: 'asc' },
    })
    return this.deDuplicateByName(brands)
  }

  async createBrand(name: string, channelId?: string) {
    try {
      return await prisma.brand.create({ data: { name, channelId } })
    } catch (err) {
      if ((err as any).code === 'P2002') {
        throw { statusCode: 400, message: `Brand "${name}" already exists in this channel` }
      }
      throw err
    }
  }

  async updateBrand(id: string, channelId: string | undefined, name: string) {
    await prisma.brand.findFirstOrThrow({ where: { id, ...(channelId && { channelId }) } })
    return prisma.brand.update({ where: { id }, data: { name } })
  }

  async softDeleteBrand(id: string, channelId: string | undefined) {
    await prisma.brand.findFirstOrThrow({ where: { id, ...(channelId && { channelId }) } })
    return prisma.brand.update({ where: { id }, data: { deletedAt: new Date() } })
  }

  async findAllCategories(channelId?: string, enterpriseId?: string) {
    const where: Prisma.CategoryWhereInput = { deletedAt: null }
    if (channelId) {
      where.OR = [{ channelId }, { channelId: null }]
    } else if (enterpriseId) {
      where.channel = { enterpriseId, deletedAt: null }
    }
    const categories = await prisma.category.findMany({
      where,
      include: { children: true, _count: { select: { items: true } } },
      orderBy: { name: 'asc' },
    })
    
    const deduplicated = this.deDuplicateByName(categories)
    
    const idMapByName = new Map<string, string>()
    deduplicated.forEach(c => idMapByName.set(c.name, c.id))

    return deduplicated.map(c => {
      const parentNode = categories.find(o => o.id === c.parentId)
      const representativeParentId = parentNode ? idMapByName.get(parentNode.name) : null
      
      const childrenNames = new Set(c.children?.map(ch => ch.name) || [])
      const childrenNodes = deduplicated.filter(d => d.parentId === c.id || childrenNames.has(d.name))
      
      return {
        ...c,
        parentId: representativeParentId || null,
        children: childrenNodes.filter(cn => cn.id !== c.id)
      }
    })
  }

  async createCategory(name: string, channelId?: string, parentId?: string) {
    const existing = await prisma.category.findFirst({ where: { name, channelId } })
    if (existing) throw { statusCode: 400, message: `Category "${name}" already exists in this channel` }
    try {
      return await prisma.category.create({ data: { name, channelId, parentId: parentId ?? null } })
    } catch (err) {
      if ((err as any).code === 'P2002') {
        throw { statusCode: 400, message: `Category "${name}" already exists in this channel` }
      }
      throw err
    }
  }

  async updateCategory(id: string, channelId: string | undefined, name: string, parentId?: string | null) {
    await prisma.category.findFirstOrThrow({ where: { id, ...(channelId && { channelId }) } })
    return prisma.category.update({ where: { id }, data: { name, parentId: parentId ?? null } })
  }

  async softDeleteCategory(id: string, channelId: string | undefined) {
    await prisma.category.findFirstOrThrow({ where: { id, ...(channelId && { channelId }) } })
    return prisma.category.update({ where: { id }, data: { deletedAt: new Date() } })
  }

  async findAllSuppliers(channelId?: string, enterpriseId?: string) {
    const where: Prisma.SupplierWhereInput = { deletedAt: null }
    if (channelId) {
      where.OR = [{ channelId }, { channelId: null }]
    } else if (enterpriseId) {
      where.channel = { enterpriseId, deletedAt: null }
    }
    const suppliers = await prisma.supplier.findMany({
      where,
      orderBy: { name: 'asc' },
    })
    return this.deDuplicateByName(suppliers)
  }

  private deDuplicateByName<T extends { name: string; channelId: string | null }>(items: T[]): T[] {
    const map = new Map<string, T>()
    for (const item of items) {
      const existing = map.get(item.name)
      if (!existing || (item.channelId !== null && existing.channelId === null)) {
        map.set(item.name, item)
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  async createSupplier(data: Prisma.SupplierUncheckedCreateInput) {
    try {
      return await prisma.supplier.create({ data })
    } catch (err) {
      if ((err as any).code === 'P2002') {
        throw { statusCode: 400, message: `Supplier "${data.name}" already exists in this channel` }
      }
      throw err
    }
  }

  async updateSupplier(id: string, channelId: string | undefined, data: Prisma.SupplierUpdateInput) {
    await prisma.supplier.findFirstOrThrow({ where: { id, ...(channelId && { channelId }) } })
    return prisma.supplier.update({ where: { id }, data })
  }

  async getSerialAging(channelId: string) {
    const serials = await prisma.serial.findMany({
      where: { channelId, status: 'IN_STOCK', deletedAt: null },
      include: { item: { select: { name: true, sku: true } } }
    })
    const now = new Date()
    return serials.map(s => {
      const days = Math.floor((now.getTime() - s.createdAt.getTime()) / (1000 * 60 * 60 * 24))
      return {
        id: s.id,
        serialNo: s.serialNo,
        itemName: s.item.name,
        sku: s.item.sku,
        daysInStock: days,
        status: days > 90 ? 'CRITICAL' : days > 60 ? 'WARNING' : 'STABLE'
      }
    })
  }

  async swapSerial(serialId: string, newSerialNo: string, reason: string, performedBy: string) {
    return prisma.$transaction(async (tx) => {
      const oldSerial = await tx.serial.findUniqueOrThrow({ where: { id: serialId } })
      const updated = await tx.serial.update({
        where: { id: serialId },
        data: { serialNo: newSerialNo }
      })
      await (tx as any).serialAudit.create({
        data: {
          serialId,
          action: 'SWAP',
          oldSerialNo: oldSerial.serialNo,
          newSerialNo,
          reason,
          performedBy
        }
      })
      return updated
    })
  }

  async initializeMultiBranchStock(itemId: string, branches: Array<{ channelId: string; qty: number; cost: number }>, performedBy: string) {
    return prisma.$transaction(async (tx) => {
      for (const b of branches) {
        await (tx as any).inventoryBalance.upsert({
          where: { itemId_channelId: { itemId, channelId: b.channelId } },
          create: { itemId, channelId: b.channelId, availableQty: b.qty, weightedAvgCost: b.cost },
          update: { availableQty: { increment: b.qty }, weightedAvgCost: b.cost }
        })
        if (b.qty > 0) {
          await tx.stockMovement.create({
            data: {
              itemId,
              channelId: b.channelId,
              movementType: 'ADJUSTMENT_IN',
              quantityChange: b.qty,
              referenceId: 'INITIAL_STOCK',
              referenceType: 'adjustment',
              performedBy,
              notes: 'Multi-branch initial stock seeding'
            }
          })
        }
      }
    })
  }
  async purgeEmptyBrands(channelId?: string) {
    // Audit finding: Bulk Brands (Delete All Empty)
    const emptyBrands = await prisma.brand.findMany({
      where: {
        channelId: channelId ?? undefined,
        deletedAt: null,
        items: { none: {} }
      }
    })

    const ids = emptyBrands.map(b => b.id)
    if (ids.length === 0) return { count: 0 }

    return prisma.brand.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: new Date() }
    })
  }

  /**
   * Bulk Opening Stock Entry — handles multi-branch inventory onboarding.
   * This logic specifically follows the "Opening Stock" pattern:
   * 1. Updates inventory balances directly.
   * 2. Logs as 'OPENING_STOCK' movement.
   * 3. Does NOT affect General Ledger (Accounting) per parity audit.
   */
  async bulkOpeningStock(data: {
    itemId: string
    actorId: string
    allocations: Array<{
      channelId: string
      quantity:  number
      costPrice: number
    }>
  }) {
    const { itemId, actorId, allocations } = data

    return prisma.$transaction(async (tx) => {
      const item = await tx.item.findUniqueOrThrow({ where: { id: itemId } })

      for (const alloc of allocations) {
        // Find or Create balance record for this channel
        const balance = await (tx as any).inventoryBalance.upsert({
          where: { itemId_channelId: { itemId, channelId: alloc.channelId } },
          create: {
            itemId,
            channelId:       alloc.channelId,
            availableQty:    alloc.quantity,
            weightedAvgCost: alloc.costPrice,
            retailPrice:     item.retailPrice,
          },
          update: {
            availableQty:    { increment: alloc.quantity },
            // Update cost if it was zero or explicitly requested (simplified: update always if provided)
            ...(alloc.costPrice > 0 && { weightedAvgCost: alloc.costPrice })
          }
        })

        // Log the Movement
        await tx.stockMovement.create({
          data: {
            itemId,
            channelId:      alloc.channelId,
            quantityChange: alloc.quantity,
            movementType:   'OPENING_STOCK',
            referenceId:    'BULK-ONBOARD',
            referenceType:  'ONBOARDING',
            performedBy:    actorId,
            notes:          `Opening stock allocation of ${alloc.quantity}`
          }
        })

        // Log Cost Audit if cost changed
      }

      return { success: true, count: allocations.length }
    })
  }
}

export const itemsService = new ItemsService()
