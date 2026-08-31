import type { FastifyPluginAsync } from 'fastify'
import {
  salesService, commitSale, syncOfflineSale, findSales, findSaleById,
  reverseSale, findSaleItems,
} from './sales.service.js'
import { listSalesQuery } from './sales.schema.js'
import { authenticate } from '../../middleware/authenticate.js'
import { authorize }    from '../../middleware/authorize.js'
import { z }            from 'zod'
import { RATE }         from '../../lib/rate-limit.plugin.js'

const HQ_SALES_ROLES = ['PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']
const optionalUuid = z.preprocess((value) => value === '' ? undefined : value, z.string().uuid().optional())
const nullableUuid = z.preprocess((value) => value === '' ? null : value, z.string().uuid().nullable().optional())

// ── FIX: Zod schema for commitSale body ──────────────────────────────
// Previously: `request.body as any` — no validation, any malformed body
// would throw an unstructured runtime error or corrupt data silently.
const commitSaleSchema = z.object({
  channelId:       optionalUuid,
  sessionId:       nullableUuid,
  customerId:      nullableUuid,
  saleType:        z.enum(['RETAIL', 'WHOLESALE', 'CREDIT']),
  discountAmount:  z.coerce.number().min(0).max(100_000_000).optional(),
  notes:           z.string().max(500).nullable().optional(),
  dueDate:         z.string().nullable().optional(),
  items: z.array(z.object({
    itemId:          z.string().min(1),
    serialId:        z.preprocess((value) => value === '' ? null : value, z.string().min(1).nullable().optional()),
    quantity:        z.coerce.number().int().positive().max(10_000),
    unitPrice:       z.coerce.number().positive().max(100_000_000),
    discountAmount:  z.coerce.number().min(0).max(100_000_000).optional(),
  })).min(1, 'Sale must have at least one item').max(50, 'A sale cannot exceed 50 line items'),
  payments: z.array(z.object({
    method:    z.enum(['CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'LOYALTY_POINTS', 'CREDIT']),
    amount:    z.coerce.number().positive().max(100_000_000),
    reference: z.string().max(100).nullable().optional(),
  })).min(1, 'Sale must have at least one payment').max(10, 'A sale cannot have more than 10 split payments'),
  approvalToken: z.string().max(500).nullable().optional(),
})

// ── FIX: Zod schema for syncOfflineSale body ─────────────────────────
const syncOfflineSchema = z.object({
  offlineReceiptNo: z.string().max(50).optional(),
  saleData:         commitSaleSchema,
  deviceDate:       z.string().optional(),
})

const resolveConflictSchema = z.object({
  action: z.enum(['FORCE_SYNC', 'VOID']),
  notes:  z.string().max(500).optional(),
})

export const salesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // ── List sales ──────────────────────────────────────────────────────
  app.get('/', {
    config:     RATE.READ,
    preHandler: [authorize(
      'PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER',
      'CASHIER', 'SALES_PERSON', 'PROMOTER', 'STOREKEEPER'
    )],
  }, async (request) => {
    const query = listSalesQuery.parse(request.query)
    if (!HQ_SALES_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      query.channelId = request.user.channelId
      if (request.user.role !== 'MANAGER') {
        query.performedBy = request.user.sub
      }
    }
    return findSales(query, request.user)
  })

  // ── Get sale by ID ──────────────────────────────────────────────────
  app.get('/:id', {
    config:     RATE.READ,
    preHandler: [authorize(
      'PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER',
      'CASHIER', 'SALES_PERSON', 'PROMOTER', 'STOREKEEPER'
    )],
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const sale   = await findSaleById(id)

    if (
      !HQ_SALES_ROLES.includes(request.user.role) &&
      sale?.channelId !== request.user.channelId
    ) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      reply.status(403).send({ error: 'Forbidden', message: 'You do not have access to this sale' })
      return
    }

    return sale
  })

  // ── Get sale line items ─────────────────────────────────────────────
  app.get('/:id/items', {
    config:     RATE.READ,
    preHandler: [authorize(
      'PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER',
      'CASHIER', 'SALES_PERSON', 'PROMOTER', 'STOREKEEPER'
    )],
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    if (!HQ_SALES_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      const sale = await findSaleById(id)
      if (sale?.channelId !== request.user.channelId) {
        reply.status(403).send({ error: 'Forbidden', message: 'You do not have access to this sale' })
        return
      }
    }
    return findSaleItems(id)
  })

  // ── Commit sale ─────────────────────────────────────────────────────
  app.post('/commit', {
    config:     RATE.SALE_COMMIT,
    preHandler: [authorize(
      'PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER',
      'CASHIER', 'SALES_PERSON', 'PROMOTER'
    )],
  }, async (request, reply) => {
    // FIX: Zod parse replaces unsafe `request.body as any`
    const body = commitSaleSchema.parse(request.body)

    if (!HQ_SALES_ROLES.includes(request.user.role)) {
      if (!body.channelId && !request.user.channelId) {
        return reply.status(400).send({ error: 'User is not assigned to any channel' })
      }
      if (body.channelId && body.channelId !== request.user.channelId) {
        return reply.status(403).send({ error: 'You can only commit sales for your assigned channel' })
      }
      body.channelId = body.channelId || request.user.channelId!
    } else if (!body.channelId) {
      // Admins MUST specify a channelId if not using a default
      if (!request.user.channelId) {
         return reply.status(400).send({ error: 'channelId is required for this operation' })
      }
      body.channelId = request.user.channelId
    }

    const sale = await commitSale(body as any, request.user, {
      approvalToken: body.approvalToken,
    })
    reply.status(201).send(sale)
  })

  // ── Sync offline sale ───────────────────────────────────────────────
  app.post('/sync-offline', {
    config:     RATE.OFFLINE_SYNC,
    preHandler: [authorize(
      'PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER',
      'CASHIER', 'SALES_PERSON', 'PROMOTER'
    )],
  }, async (request, reply) => {
    const idempotencyKey = request.headers['idempotency-key'] as string
    if (!idempotencyKey) {
      return reply.status(400).send({ error: 'Idempotency-Key header required' })
    }
    // FIX: Zod parse replaces unsafe `request.body as any`
    const body   = syncOfflineSchema.parse(request.body)
    if (!HQ_SALES_ROLES.includes(request.user.role)) {
      if (!body.saleData.channelId && !request.user.channelId) {
        return reply.status(400).send({ error: 'User is not assigned to any channel' })
      }
      if (body.saleData.channelId && body.saleData.channelId !== request.user.channelId) {
        return reply.status(403).send({ error: 'You can only sync sales for your assigned channel' })
      }
      body.saleData.channelId = request.user.channelId!
    } else if (!body.saleData.channelId) {
      if (!request.user.channelId) {
        return reply.status(400).send({ error: 'channelId is required for this operation' })
      }
      body.saleData.channelId = request.user.channelId
    }
    const result = await syncOfflineSale(body, request.user, idempotencyKey)
    return reply.send(result)
  })

  // ── Reverse (void) a sale ───────────────────────────────────────────
  app.post('/:id/reverse', {
    config:     RATE.APPROVAL,
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
  }, async (request) => {
    const { id }       = z.object({ id: z.string().uuid() }).parse(request.params)
    // FIX (from critical phase): use request.user.sub not request.user.id
    const { password } = z.object({ password: z.string().optional() }).parse(request.body)
    return reverseSale(id, request.user.sub, password)
  })

  // ── Suspended Sales / Held Carts ────────────────────────────────────
  app.post('/suspend', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER', 'SALES_PERSON')],
  }, async (request, reply) => {
    const body = z.object({
      channelId:    optionalUuid,
      customerData: z.any().optional(),
      cartData:     z.any(),
      notes:        z.string().max(500).optional(),
    }).parse(request.body)

    let cid = body.channelId || request.user.channelId
    if (!HQ_SALES_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      cid = request.user.channelId
    }
    if (!cid) throw { statusCode: 400, message: 'channelId is required to suspend sale' }

    const suspended = await salesService.suspendSale(cid, request.user.sub, body as any)
    reply.status(201).send(suspended)
  })

  app.get('/suspended', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER', 'SALES_PERSON')],
  }, async (request) => {
    const { channelId } = z.object({ channelId: z.string().uuid().optional() }).parse(request.query)
    let cid = channelId || request.user.channelId
    if (!HQ_SALES_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      cid = request.user.channelId
    }
    if (!cid) throw { statusCode: 400, message: 'channelId is required to list suspended sales' }

    const userId = ['CASHIER', 'SALES_PERSON'].includes(request.user.role) ? request.user.sub : undefined
    return salesService.findSuspendedSales(cid, userId)
  })

  app.post('/suspended/:id/resume', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER', 'SALES_PERSON')],
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { channelId } = z.object({ channelId: z.string().uuid().optional() }).parse(request.body ?? {})
    let cid = channelId || request.user.channelId
    if (!HQ_SALES_ROLES.includes(request.user.role)) {
      if (!request.user.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      cid = request.user.channelId
    }
    if (!cid) throw { statusCode: 400, message: 'channelId is required to resume suspended sale' }

    return salesService.resumeSale(id, cid)
  })

  // ── Sync Conflicts ─────────────────────────────────────────────────
  app.get('/conflicts', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
    handler: async (request) => {
      const { channelId } = z.object({ channelId: z.string().uuid().optional() }).parse(request.query)
      let cid = channelId || request.user.channelId
      if (!HQ_SALES_ROLES.includes(request.user.role)) {
        if (!request.user.channelId) {
          throw { statusCode: 400, message: 'Your account has no channel assigned' }
        }
        if (channelId && channelId !== request.user.channelId) {
          throw { statusCode: 403, message: 'You can only view conflicts for your assigned channel' }
        }
        cid = request.user.channelId
      }
      if (!cid) throw { statusCode: 400, message: 'channelId is required to view conflicts' }
      return salesService.findConflicts(cid)
    }
  })

  app.post('/conflicts/:id/resolve', {
    preHandler: [authorize('PLATFORM_OWNER', 'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER')],
    handler: async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
      const body = resolveConflictSchema.parse(request.body)
      return salesService.resolveConflict(id, body.action as any, request.user, body.notes)
    }
  })
}
