import type { FastifyPluginAsync } from 'fastify'
import { itemsService }           from './items.service.js'
import { csvImportService }       from './csv-import.service.js'
import {
  createItemSchema, updateItemSchema,
  listItemsQuery,  stockAdjustmentSchema,
} from './items.schema.js'
import { authenticate }           from '../../middleware/authenticate.js'
import { authorize }              from '../../middleware/authorize.js'
import { requirePlanFeature }     from '../../middleware/plan-guard.js'
import { prisma }                 from '../../lib/prisma.js'
import { validateApprovalToken }  from '../auth/manager-approve.routes.js'
import { RATE }                   from '../../lib/rate-limit.plugin.js'
import { z }                      from 'zod'
import { eventBus }               from '../../lib/event-bus.js'
import { logAction, AUDIT }       from '../../lib/audit.js'
import '@fastify/multipart'
import { MultipartFile } from '@fastify/multipart'

const HQ_ITEM_ROLES = ['PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export const itemsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // GET /items
  app.get('/', {
    config:     RATE.READ,
    preHandler: [authorize(
      'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER',
      'CASHIER', 'SALES_PERSON', 'STOREKEEPER', 'PROMOTER',
    )],
  }, async (request) => {
    const query = listItemsQuery.parse(request.query)
    // Removed debug log for query
    
    if (!HQ_ITEM_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      query.channelId = request.user.channelId
    }
    return itemsService.findAll(query, request.user.role)
  })

  // PATCH /items/settings
  app.patch('/settings', {
    preHandler: [authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
    schema: { body: { type: 'object' } },
  }, async (request) => {
    const body = request.body as Record<string, any>
    const { settingsService } = await import('../dashboard/settings.service.js')
    if (!HQ_ITEM_ROLES.includes(request.user.role) && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    // FIX 2: use .sub consistently — .id and .sub are both userId but .sub is canonical
    return settingsService.bulkUpdate(body, request.user.sub, request.user.channelId ?? null)
  })

  // GET /items/:id
  // FIX 7: Added authorize() — was open to any authenticated user.
  // filterItemFields hides cost prices for low-privilege roles, but
  // that's a field filter not an access guard — the DB was still queried.
  app.get('/:id', {
    config:     RATE.READ,
    preHandler: [authorize(
      'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER',
      'CASHIER', 'SALES_PERSON', 'STOREKEEPER', 'PROMOTER',
    )],
  }, async (request) => {
    const { id } = request.params as { id: string }
    if (!HQ_ITEM_ROLES.includes(request.user.role) && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    return itemsService.findById(id, request.user.role, request.user.channelId ?? undefined)
  })

  // GET /items/barcode/:barcode
  // FIX 7: Added authorize() — was open to any authenticated user.
  app.get('/barcode/:barcode', {
    config:     RATE.READ,
    preHandler: [authorize(
      'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER',
      'CASHIER', 'SALES_PERSON', 'STOREKEEPER', 'PROMOTER',
    )],
  }, async (request) => {
    const { barcode } = request.params as { barcode: string }
    if (!HQ_ITEM_ROLES.includes(request.user.role) && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    const item = await itemsService.findByBarcode(barcode)
    if (!item) throw { statusCode: 404, message: 'Item not found' }
    return itemsService.findById(item.id, request.user.role, request.user.channelId ?? undefined)
  })

  // POST /items
  app.post('/', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { approvalToken, ...rest } = z.object({
      approvalToken: z.string().optional(),
    }).passthrough().parse(request.body)

    const body = createItemSchema.parse(rest)
    if (!HQ_ITEM_ROLES.includes(request.user.role) && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }

    const sanitizedBody = {
      ...body,
      brandId:    body.brandId    === '' ? null : body.brandId,
      categoryId: body.categoryId === '' ? null : body.categoryId,
      supplierId: body.supplierId === '' ? null : body.supplierId,
    }

    let creatorChannelId = request.user.channelId || undefined
    if (!creatorChannelId && request.user.enterpriseId) {
      const defaultChannel = await prisma.channel.findFirst({
        where: { enterpriseId: request.user.enterpriseId, deletedAt: null },
        select: { id: true }
      })
      creatorChannelId = defaultChannel?.id
    }

    const item = await itemsService.create({
      ...sanitizedBody,
      creatorChannelId,
      creatorId:        request.user.sub,
      enterpriseId:     request.user.enterpriseId ?? null,
    })
    reply.status(201).send(item)
  })

  // PATCH /items/:id
  app.patch('/:id', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id } = request.params as { id: string }
    const body   = updateItemSchema.parse(request.body)
    if (!HQ_ITEM_ROLES.includes(request.user.role) && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }

    const sanitizedBody = {
      ...body,
      brandId:    body.brandId    === '' ? null : body.brandId,
      categoryId: body.categoryId === '' ? null : body.categoryId,
      supplierId: body.supplierId === '' ? null : body.supplierId,
    }

    return itemsService.update(id, {
      ...sanitizedBody,
      channelId: request.user.channelId || undefined,
    })
  })

  // DELETE /items/:id
  app.delete('/:id', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { id }            = request.params as { id: string }
    const { password, approvalToken } = z.object({ 
      password:      z.string().optional(),
      approvalToken: z.string().optional() 
    }).parse(request.body || {})

    if (request.user.role === 'MANAGER') {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      if (!approvalToken) {
        const approval = await prisma.managerApproval.create({
          data: {
            action:      'item_delete',
            contextId:   id,
            channelId:   request.user.channelId || undefined,
            // FIX 2: use .sub not .id
            requesterId: request.user.sub,
          },
        })
        return reply.status(403).send({
          error:      'Administrator Manager approval required for item deletion',
          approvalId: approval.id,
          message:    'An approval request has been sent to the Administrator Manager.',
        })
      }
      // FIX 8: Pass channelId to block cross-channel approval token replay
      const approved = await validateApprovalToken(
        approvalToken, 'item_delete', id, request.user.channelId || undefined
      )
      if (!approved) {
        return reply.status(403).send({ error: 'Invalid or expired Administrator Manager approval' })
      }
    }

    return itemsService.softDelete(id, password)
  })

  // POST /items/stock-adjustment
  app.post('/stock-adjustment', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER', 'STOREKEEPER')],
  }, async (request) => {
    const body = stockAdjustmentSchema.parse(request.body)
    const isHQ = HQ_ITEM_ROLES.includes(request.user.role)
    if (!isHQ && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    if (!isHQ && body.channelId !== request.user.channelId) {
      throw { statusCode: 403, message: 'You can only adjust stock for your assigned channel' }
    }

    const item       = await prisma.item.findUniqueOrThrow({ where: { id: body.itemId } })
    if (item.type === 'SERVICE') {
      throw { statusCode: 400, message: 'Stock adjustments are not allowed for Service items' }
    }
    const unitPrice  = Number(item.retailPrice)
    const totalValue      = Math.abs(body.quantity) * Number(item.retailPrice)
    const THRESHOLD_QTY   = 50
    const THRESHOLD_VALUE = 500
    const isOverThreshold = Math.abs(body.quantity) > THRESHOLD_QTY || totalValue > THRESHOLD_VALUE
    const needsApproval   = isOverThreshold && !body.isOpening && !['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN'].includes(request.user.role)

    if (needsApproval) {
      const approval = await prisma.managerApproval.create({
        data: {
          action:      'STOCK_ADJUSTMENT',
          contextId:   body.itemId,
          channelId:   body.channelId,
          // FIX 2: use .sub not .id
          requesterId: request.user.sub,
          notes:       `Threshold Exceeded: Qty=${body.quantity}, Value=${totalValue}. Reason: ${body.reason}`,
        },
      })
      return {
        message:    'Adjustment exceeds threshold and requires Manager Approval',
        approvalId: approval.id,
        status:     'PENDING_APPROVAL',
      }
    }

    let movementType: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'OPENING_STOCK'
    if (body.isOpening) {
      // SUPER_ADMIN bypasses all opening stock window restrictions
      if (request.user.role !== 'SUPER_ADMIN') {
        const { settingsService } = await import('../dashboard/settings.service.js')
        const advancedSettings = await settingsService.getByKey('advancedSettings', request.user.channelId) as any
        if (!advancedSettings?.globalOpeningStockActive) {
          throw { statusCode: 403, message: 'Global opening stock window is closed' }
        }
        const channel = await prisma.channel.findUniqueOrThrow({ where: { id: body.channelId } })
        const flags   = (channel.featureFlags as any) || {}
        if (!flags.openingStockWindowActive) {
          throw { statusCode: 403, message: 'Opening stock window is not active for this channel' }
        }
      }
      movementType = 'OPENING_STOCK'
    } else {
      movementType = body.quantity > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT'
    }

    // Reason codes that represent a genuine inventory write-off — the item is
    // physically gone and its value is a real loss, not a data correction.
    // SYSTEM_CORRECTION and INITIAL_WALKTHROUGH (opening/reconciliation
    // entries, like bulkOpeningStock) deliberately do NOT post to the ledger.
    const SHRINKAGE_REASON_CODES = ['DAMAGED_IN_STORE', 'EXPIRED', 'THEFT_INVESTIGATION']
    const isShrinkage = !body.isOpening
      && movementType === 'ADJUSTMENT_OUT'
      && SHRINKAGE_REASON_CODES.includes(body.reasonCode ?? '')

    // FIX 3: Update inventory_balances in a transaction with the stockMovement.
    // Previously only a stockMovement record was written — availableQty
    // was never updated so stock levels never changed from adjustments.
    //
    // FIX 4: Loss-type adjustments (damage, expiry, theft) never posted to
    // the ledger at all — Shrinkage Loss / Inventory Valuation, the same
    // accounts transfer shortages already use, stayed unaffected regardless
    // of how much inventory value was actually written off.
    await prisma.$transaction(async (tx) => {
      await tx.stockMovement.create({
        data: {
          itemId:         body.itemId,
          channelId:      body.channelId,
          movementType:   movementType as any,
          quantityChange: body.quantity,
          referenceId:    body.itemId,
          referenceType:  'adjustment',
          // FIX 2: use .sub not .id
          performedBy:    request.user.sub,
          notes:          `[${body.reasonCode || 'MANUAL'}] ${body.reason}`,
        },
      })

      // Upsert: create balance if missing, increment if it exists
      const balance = await (tx as any).inventoryBalance.upsert({
        where: { itemId_channelId: { itemId: body.itemId, channelId: body.channelId } },
        create: { itemId: body.itemId, channelId: body.channelId, availableQty: body.quantity },
        update: { availableQty: { increment: body.quantity } },
      })

      if (isShrinkage) {
        const unitCost = Number(balance.weightedAvgCost ?? item.weightedAvgCost ?? 0)
        const shrinkageValue = Math.abs(body.quantity) * unitCost
        if (shrinkageValue > 0) {
          const { buildStockAdjustmentShrinkageJournalEntry } = await import('../../lib/ledger.js')
          await buildStockAdjustmentShrinkageJournalEntry(
            tx as any, body.itemId, `Stock adjustment: ${item.name} (${body.reasonCode})`,
            shrinkageValue, body.channelId, request.user.sub
          )
        }
      }
    })

    // Emit event for real-time UI updates
    const updatedBalance = await prisma.inventoryBalance.findUnique({
      where: { itemId_channelId: { itemId: body.itemId, channelId: body.channelId } }
    })
    
    eventBus.emit('inventory.updated', {
      itemId:       body.itemId,
      channelId:    body.channelId,
      availableQty: Number(updatedBalance?.availableQty || 0),
      movementType: movementType
    })

    logAction({
      action:     AUDIT.STOCK_ADJUST,
      actorId:    request.user.sub,
      actorRole:  request.user.role,
      channelId:  body.channelId,
      targetType: 'Item',
      targetId:   body.itemId,
      newValues:  { quantityChange: body.quantity, reasonCode: body.reasonCode, notes: body.reason },
    })

    return { message: 'Stock adjustment recorded', movementType, quantity: body.quantity }
  })

  // POST /items/bulk-opening-stock
  app.post('/bulk-opening-stock', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request) => {
    const schema = z.object({
      itemId: z.string().uuid(),
      allocations: z.array(z.object({
        channelId: z.string().uuid(),
        quantity:  z.number().positive(),
        costPrice: z.number().nonnegative(),
      }))
    })

    const body = schema.parse(request.body)
    const isHQ = HQ_ITEM_ROLES.includes(request.user.role)
    if (!isHQ && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    if (!isHQ && body.allocations.some(a => a.channelId !== request.user.channelId)) {
      throw { statusCode: 403, message: 'You can only allocate opening stock for your assigned channel' }
    }

    const item = await prisma.item.findUniqueOrThrow({ where: { id: body.itemId } })
    if (item.type === 'SERVICE') {
      throw { statusCode: 400, message: 'Bulk opening stock is not allowed for Service items' }
    }

    return itemsService.bulkOpeningStock({
      ...body,
      actorId: request.user.sub
    })
  })

  // ── Brands ──────────────────────────────────────────────────────────
  app.get('/brands', { config: RATE.READ }, async (request) => {
    const isHQ = HQ_ITEM_ROLES.includes(request.user.role)
    if (!isHQ && !request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
    return itemsService.findAllBrands(isHQ ? undefined : request.user.channelId!, request.user.enterpriseId ?? undefined)
  })

  app.post('/brands', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(request.body)
    if (!HQ_ITEM_ROLES.includes(request.user.role) && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    let channelId = request.user.channelId || undefined
    if (!channelId && request.user.enterpriseId) {
      const defaultChannel = await prisma.channel.findFirst({
        where: { enterpriseId: request.user.enterpriseId, deletedAt: null },
        select: { id: true }
      })
      channelId = defaultChannel?.id
    }
    const brand = await itemsService.createBrand(name, channelId)
    reply.status(201).send(brand)
  })

  app.patch('/brands/:id', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id } = request.params as { id: string }
    const isHQ   = HQ_ITEM_ROLES.includes(request.user.role)
    if (!isHQ && !request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
    const { name } = z.object({ name: z.string().min(1) }).parse(request.body)
    return itemsService.updateBrand(id, isHQ ? undefined : request.user.channelId!, name)
  })

  app.delete('/brands/:id', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id } = request.params as { id: string }
    const isHQ   = HQ_ITEM_ROLES.includes(request.user.role)
    if (!isHQ && !request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
    return itemsService.softDeleteBrand(id, isHQ ? undefined : request.user.channelId!)
  })

  // ── Categories ───────────────────────────────────────────────────────
  app.get('/categories', { config: RATE.READ }, async (request) => {
    const isHQ = HQ_ITEM_ROLES.includes(request.user.role)
    if (!isHQ && !request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
    return itemsService.findAllCategories(isHQ ? undefined : request.user.channelId!, request.user.enterpriseId ?? undefined)
  })

  app.post('/categories', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { name, parentId } = z.object({
      name:     z.string().min(1),
      parentId: z.string().optional(),
    }).parse(request.body)
    if (!HQ_ITEM_ROLES.includes(request.user.role) && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    let channelId = request.user.channelId || undefined
    if (!channelId && request.user.enterpriseId) {
      const defaultChannel = await prisma.channel.findFirst({
        where: { enterpriseId: request.user.enterpriseId, deletedAt: null },
        select: { id: true }
      })
      channelId = defaultChannel?.id
    }
    try {
      const category = await itemsService.createCategory(name, channelId, parentId)
      reply.status(201).send(category)
    } catch (err: unknown) {
      if ((err as any)?.code === 'P2002') {
        return reply.status(409).send({ error: `A category named "${name}" already exists.` })
      }
      throw err
    }
  })

  app.patch('/categories/:id', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const { id }             = request.params as { id: string }
    const { name, parentId } = z.object({
      name:     z.string().min(1),
      parentId: z.string().optional().nullable(),
    }).parse(request.body)
    const isHQ = HQ_ITEM_ROLES.includes(request.user.role)
    if (!isHQ && !request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
    try {
      return itemsService.updateCategory(id, isHQ ? undefined : request.user.channelId!, name, parentId)
    } catch (err: unknown) {
      if ((err as any)?.code === 'P2002') {
        return reply.status(409).send({ error: `A category named "${name}" already exists.` })
      }
      throw err
    }
  })

  app.delete('/categories/:id', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id } = request.params as { id: string }
    const isHQ   = HQ_ITEM_ROLES.includes(request.user.role)
    if (!isHQ && !request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
    return itemsService.softDeleteCategory(id, isHQ ? undefined : request.user.channelId!)
  })

  // ── Suppliers ────────────────────────────────────────────────────────
  app.get('/suppliers', { config: RATE.READ }, async (request) => {
    const isHQ = HQ_ITEM_ROLES.includes(request.user.role)
    if (!isHQ && !request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
    return itemsService.findAllSuppliers(isHQ ? undefined : request.user.channelId!, request.user.enterpriseId ?? undefined)
  })

  app.post('/suppliers', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request, reply) => {
    const body = z.object({
      name:         z.string().min(1, 'Supplier name is required'),
      contactName:  z.string().optional(),
      phone:        z.string().min(8).max(20).regex(/^[+0-9\s-]+$/, 'Invalid phone number format').optional().or(z.literal('')),
      email:        z.string().email().optional().or(z.literal('')),
      address:      z.string().optional(),
      taxPin:       z.string().optional(),
      paymentTerms: z.string().optional(),
    }).parse(request.body)
    if (!HQ_ITEM_ROLES.includes(request.user.role) && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }
    let channelId = request.user.channelId || undefined
    if (!channelId && request.user.enterpriseId) {
      const defaultChannel = await prisma.channel.findFirst({
        where: { enterpriseId: request.user.enterpriseId, deletedAt: null },
        select: { id: true }
      })
      channelId = defaultChannel?.id
    }
    const supplier = await itemsService.createSupplier({ ...body, channelId })
    reply.status(201).send(supplier)
  })

  app.patch('/suppliers/:id', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id } = request.params as { id: string }
    const isHQ   = HQ_ITEM_ROLES.includes(request.user.role)
    if (!isHQ && !request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
    const body   = z.object({
      name:         z.string().min(1).optional(),
      contactName:  z.string().optional(),
      phone:        z.string().min(10).max(13).regex(/^[+0-9]+$/).optional(),
      email:        z.string().email().optional().or(z.literal('')),
      address:      z.string().optional(),
      taxPin:       z.string().optional(),
      paymentTerms: z.string().optional(),
    }).parse(request.body)
    return itemsService.updateSupplier(id, isHQ ? undefined : request.user.channelId!, body)
  })

  app.delete('/suppliers/:id', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id } = request.params as { id: string }
    const isHQ   = HQ_ITEM_ROLES.includes(request.user.role)
    if (!isHQ && !request.user.channelId) throw { statusCode: 400, message: 'Your account has no channel assigned' }
    return itemsService.updateSupplier(
      id,
      isHQ ? undefined : request.user.channelId!,
      { deletedAt: new Date() } as never
    )
  })

  // POST /items/import
  app.post('/import', {
    config:     RATE.APPROVAL,
    preHandler: [
      authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER'),
      requirePlanFeature('catalog'),
    ],
  }, async (request) => {
    const data = await request.file()
    if (!data || !data.file) throw { statusCode: 400, message: 'CSV/Excel file required' }
    const buffer = await data.toBuffer()

    const channelIdField = (data.fields?.channelId as any)?.value as string | undefined
    const channelId = channelIdField || request.user.channelId || undefined
    if (!channelId) {
      throw { statusCode: 400, message: 'channelId is required — specify which channel these items belong to' }
    }

    return csvImportService.importItems(buffer, channelId, request.user.enterpriseId, request.user.sub)
  })

  // POST /items/bulk-import (Dynamic JSON import from UI onboarding wizard)
  app.post('/bulk-import', {
    config:     RATE.APPROVAL,
    preHandler: [
      authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN', 'MANAGER'),
      requirePlanFeature('catalog'),
    ],
  }, async (request) => {
    const { channelId, duplicateMode, items } = z.object({
      channelId: z.string().min(1),
      duplicateMode: z.enum(['UPDATE', 'SKIP']).optional().default('UPDATE'),
      items: z.array(z.object({
        name: z.string().min(1),
        buyingPrice: z.union([z.number(), z.string()]).optional(),
        costPrice: z.union([z.number(), z.string()]).optional(),
        weightedAvgCost: z.union([z.number(), z.string()]).optional(),
        sellingPrice: z.union([z.number(), z.string()]).optional(),
        retailPrice: z.union([z.number(), z.string()]).optional(),
        wholesalePrice: z.union([z.number(), z.string()]).optional(),
        minRetailPrice: z.union([z.number(), z.string()]).optional(),
        openingStock: z.union([z.number(), z.string()]).optional(),
        quantity: z.union([z.number(), z.string()]).optional(),
        availableQty: z.union([z.number(), z.string()]).optional(),
        sku: z.string().optional(),
        barcode: z.union([z.string(), z.number()]).optional().transform(v => v !== undefined && v !== null ? String(v) : undefined),
        category: z.string().optional(),
        categoryName: z.string().optional(),
        brand: z.string().optional(),
        brandName: z.string().optional(),
        supplier: z.string().optional(),
        supplierName: z.string().optional(),
        reorderLevel: z.union([z.number(), z.string()]).optional(),
        unitOfMeasure: z.string().optional(),
        description: z.string().optional(),
        taxClass: z.enum(['STANDARD', 'ZERO_RATED', 'EXEMPT']).optional(),
      })).min(1, 'At least one item row is required'),
    }).parse(request.body)

    return csvImportService.importDynamicItems(items, {
      channelId,
      enterpriseId: request.user.enterpriseId,
      actorId: request.user.sub,
      duplicateMode,
    })
  })
}
