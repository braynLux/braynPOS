import type { FastifyPluginAsync } from 'fastify'
import { customersService }        from './customers.service.js'
import { authenticate }            from '../../middleware/authenticate.js'
import { authorize }               from '../../middleware/authorize.js'
import { RATE }                    from '../../lib/rate-limit.plugin.js'
import { prisma }                  from '../../lib/prisma.js'
import { validateApprovalToken }   from '../auth/manager-approve.routes.js'
import { z }                       from 'zod'

const HQ_CUSTOMER_ROLES = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN']

export const customersRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // GET /customers
  // FIX 6: Added authorize() — was completely open to any authenticated user.
  // Customer records include credit limits, outstanding balances, phone numbers.
  app.get('/', {
    config:     RATE.READ,
    preHandler: [authorize(
      'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER',
      'CASHIER', 'SALES_PERSON', 'PROMOTER',
    )],
  }, async (request) => {
    const isHQ = HQ_CUSTOMER_ROLES.includes(request.user.role)

    const query = z.object({
      page:   z.coerce.number().min(1).optional(),
      limit:  z.coerce.number().min(1).max(100).optional(),
      search: z.string().optional(),
      tier:   z.enum(['BRONZE', 'SILVER', 'GOLD']).optional(),
      channelId: z.string().uuid().optional(),
    }).parse(request.query)

    if (!isHQ && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }

    return customersService.findAll({
      ...query,
      // FIX 10: Pass undefined (not empty string) for HQ — empty string
      // produces WHERE channelId = '' which matches no records.
      channelId: isHQ ? query.channelId : request.user.channelId!,
    })
  })

  // GET /customers/:id
  // FIX 6: Added authorize() — was open to any authenticated user.
  app.get('/:id', {
    config:     RATE.READ,
    preHandler: [authorize(
      'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER',
      'CASHIER', 'SALES_PERSON', 'PROMOTER',
    )],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const isHQ   = HQ_CUSTOMER_ROLES.includes(request.user.role)

    if (!isHQ && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }

    const customer = await customersService.findById(
      id,
      isHQ ? undefined : (request.user.channelId || undefined)
    )

    if (!isHQ && customer.channelId && customer.channelId !== request.user.channelId) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Customer does not belong to your channel' })
    }

    return customer
  })

  // POST /customers
  app.post('/', {
    config:     RATE.APPROVAL,
    preHandler: [authorize(
      'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER',
      'CASHIER', 'SALES_PERSON', 'PROMOTER',
    )],
  }, async (request, reply) => {
    const isHQ = HQ_CUSTOMER_ROLES.includes(request.user.role)
    const body = z.object({
      name:        z.string().min(1),
      phone:       z.string().min(10).max(13).regex(/^[+0-9]+$/, 'Invalid phone number format'),
      // FIX: an untouched optional email input submits '', which
      // .email().optional() rejects (it only allows undefined) — crashing
      // customer creation with a 500 whenever email is left blank.
      email:       z.string().email().optional().or(z.literal('')),
      tier:          z.enum(['BRONZE', 'SILVER', 'GOLD']).optional(),
      creditLimit:   z.coerce.number().min(0).optional(),
      channelId:     z.string().uuid().optional(),
      contactPerson: z.string().max(100).optional(),
      isThirdParty:  z.boolean().optional(),
    }).parse(request.body)

    const channelId = isHQ ? (body.channelId || request.user.channelId) : request.user.channelId
    if (!channelId) {
      throw { statusCode: 400, message: 'channelId is required to create a customer' }
    }

    const customer = await customersService.create({
      ...body,
      channelId,
    })
    reply.status(201).send(customer)
  })

  // PATCH /customers/:id
  app.patch('/:id', {
    config:     RATE.APPROVAL,
    preHandler: [authorize(
      'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER',
      'CASHIER', 'SALES_PERSON', 'PROMOTER',
    )],
  }, async (request) => {
    const { id } = request.params as { id: string }
    const isHQ   = HQ_CUSTOMER_ROLES.includes(request.user.role)

    if (!isHQ && !request.user.channelId) {
      throw { statusCode: 400, message: 'Your account has no channel assigned' }
    }

    const body = z.object({
      name:        z.string().optional(),
      phone:       z.string().min(10).max(13).regex(/^[+0-9]+$/).optional(),
      email:       z.string().email().optional().or(z.literal('')),
      tier:          z.enum(['BRONZE', 'SILVER', 'GOLD']).optional(),
      creditLimit:   z.coerce.number().min(0).optional(),
      contactPerson: z.string().max(100).optional(),
      isThirdParty:  z.boolean().optional(),
    }).parse(request.body)

    // FIX 10: Pass undefined (not '') for HQ users.
    // customersService.update does WHERE { id, channelId } —
    // passing '' means no customer is ever found for HQ edits.
    return customersService.update(
      id,
      isHQ ? undefined : (request.user.channelId || undefined),
      body
    )
  })

  // DELETE /customers/:id
  // FIX 11: Removed STOREKEEPER and PROMOTER — they should not be able
  // to delete customers even with manager approval.
  app.delete('/:id', {
    config:     RATE.APPROVAL,
    preHandler: [authorize(
      'SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN', 'MANAGER',
      'CASHIER', 'SALES_PERSON',
    )],
  }, async (request, reply) => {
    const { id }    = request.params as { id: string }
    const actor     = request.user
    const isHQ      = HQ_CUSTOMER_ROLES.includes(actor.role)
    const { approvalToken } = z.object({ approvalToken: z.string().optional() }).parse(request.body || {})

    if (!isHQ) {
      if (!actor.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      if (!approvalToken) {
        const approval = await (prisma as any).managerApproval.create({
          data: {
            action:      'customer_delete',
            contextId:   id,
            channelId:   actor.channelId || null,
            requesterId: actor.sub,
            notes:       `Request to delete customer ${id}`,
          },
        })
        return reply.status(403).send({
          error:      'Manager approval required for customer deletion',
          approvalId: approval.id,
          message:    'An approval request has been sent to your manager.',
        })
      }
      // FIX 8: Pass channelId to block cross-channel approval token replay
      const approved = await validateApprovalToken(
        approvalToken, 'customer_delete', id, actor.channelId || undefined
      )
      if (!approved) {
        return reply.status(403).send({ error: 'Invalid or expired manager approval' })
      }
    }

    return customersService.softDelete(
      id,
      isHQ ? undefined : (actor.channelId || undefined)
    )
  })
}
