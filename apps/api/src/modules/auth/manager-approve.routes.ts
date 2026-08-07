import { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma.js'
import { redis } from '../../lib/redis.js'
import { verifyPassword } from '../../lib/password.js'
import { logAction, AUDIT } from '../../lib/audit.js'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate.js'

const ApproveSchema = z.object({
  action: z.enum([
    'void', 'refund', 'discount_override', 'price_below_min',
    'user_create', 'user_delete', 'user_update',
    'customer_delete', 'item_create', 'item_update', 'item_delete',
    'purchase_delete', 'expense_delete', 'credit_sale', 'negative_margin',
    'channel_create', 'channel_update', 'channel_delete',
  ]),
  // FIX: there is no separate PIN field/hash on User — this is checked
  // against the manager's actual account passwordHash below. A max(8) cap
  // rejected the request before verifyPassword ever ran for any manager
  // whose real password exceeds 8 characters — including the seeded default
  // admin password "Admin@123" (9 chars), making the entire manager-approval
  // gate (purchase/expense/customer delete, negative margin, price overrides,
  // discount overrides, etc.) unusable for realistic passwords.
  pin:       z.string().min(1).max(100),
  contextId: z.string(),
  channelId: z.string().uuid(),
  marginPercent: z.coerce.number().optional(),
})

export async function managerApproveRoutes(app: FastifyInstance) {
  app.post('/manager-approve', {
    config: {
      rateLimit: {
        max:        5,
        timeWindow: '1 minute',
        // ── FIX: Key by channelId + action + IP ──────────────────────
        // The original RATE.APPROVAL had no keyGenerator so it fell back
        // to IP-only. With multiple managers in one channel, an attacker
        // behind the same IP gets max × managerCount PIN attempts per
        // window. Keying by channelId+action dramatically reduces the
        // effective attack surface — each specific action per channel is
        // independently limited regardless of how many managers exist.
        keyGenerator: (request: any) => {
          const body = request.body as any
          return `approval-${body?.channelId ?? 'unknown'}-${body?.action ?? 'unknown'}-${request.ip}`
        },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { action, pin, contextId, channelId } = ApproveSchema.parse(request.body)
    const actor = request.user
    const isGlobalActor = ['SUPER_ADMIN', 'MANAGER_ADMIN', 'ADMIN'].includes(actor.role)
    if (!isGlobalActor && actor.channelId !== channelId) {
      return reply.status(403).send({ error: 'You can only request approvals for your assigned channel' })
    }

    const isUserMgmt       = ['user_create', 'user_delete', 'user_update'].includes(action)
    const isFinanceDelete  = ['purchase_delete', 'expense_delete'].includes(action)
    const isChannelMgmt    = ['channel_create', 'channel_update', 'channel_delete'].includes(action)
    const isCustomerDelete = action === 'customer_delete'
    const isAdminOnly      = isUserMgmt || isFinanceDelete || isChannelMgmt

    let approverRoles: string[] = []
    if (isAdminOnly) {
      approverRoles = ['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN']
    } else if (isCustomerDelete) {
      approverRoles = actor.channelId
        ? ['MANAGER', 'MANAGER_ADMIN', 'ADMIN', 'SUPER_ADMIN']
        : ['MANAGER_ADMIN', 'ADMIN', 'SUPER_ADMIN']
    } else if (action === 'negative_margin' && typeof (request.body as any).marginPercent === 'number') {
      const margin = (request.body as any).marginPercent
      // Audit finding: Stepped Authority
      // Floor Managers can authorize down to -5% margin.
      // Anything deeper requires MANAGER_ADMIN, ADMIN or SUPER_ADMIN.
      if (margin < -5) {
        approverRoles = ['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN']
      } else {
        approverRoles = ['MANAGER', 'MANAGER_ADMIN', 'ADMIN', 'SUPER_ADMIN']
      }
    } else {
      approverRoles = ['MANAGER', 'MANAGER_ADMIN', 'ADMIN', 'SUPER_ADMIN']
    }

    const where: any = {
      role:      { in: approverRoles },
      status:    'ACTIVE',
      deletedAt: null,
    }
    if (!isAdminOnly) {
      where.channelId = channelId
    }

    const managers = await prisma.user.findMany({
      where,
      select: { id: true, passwordHash: true },
    })

    if (managers.length === 0) {
      return reply.status(404).send({ error: 'No manager available in this channel' })
    }

    // Check PIN against each manager's password hash
    let approverId: string | null = null
    for (const mgr of managers) {
      const valid = await verifyPassword(mgr.passwordHash, pin)
      if (valid) { approverId = mgr.id; break }
    }

    if (!approverId) {
      return reply.status(403).send({ error: 'Invalid manager PIN' })
    }

    const approvalToken = randomUUID()
    const tokenKey      = `approval:${approvalToken}`

    // ── FIX: channelId is stored in token data and checked on consume ─
    // Previously validateApprovalToken only checked action + contextId.
    // A token issued for Channel A's purchase delete could be reused
    // against Channel B's purchase with the same contextId.
    const tokenData = JSON.stringify({
      action,
      contextId,
      channelId,  // ← persisted so validator can enforce it
      approverId,
      actorId: actor.sub,
    })

    await redis.setex(tokenKey, 120, tokenData)

    logAction({
      action:    AUDIT.MANAGER_APPROVAL,
      actorId:   actor.sub,
      actorRole: actor.role,
      approverId,
      channelId,
      targetType: 'action',
      targetId:   contextId,
      newValues: { approvedAction: action },
    })

    return reply.send({ approvalToken, expiresInSeconds: 120 })
  })
}

// ── APPROVAL TOKEN VALIDATOR ──────────────────────────────────────────
// FIX: Now accepts and validates expectedChannelId.
// Pass the channelId from the request context so cross-channel replay
// attacks (using a valid token from Channel A against Channel B) are blocked.
export async function validateApprovalToken(
  token:             string,
  action:            string,
  contextId:         string,
  expectedChannelId?: string
): Promise<{ approverId: string; actorId: string } | null> {
  const data = await redis.get(`approval:${token}`)
  if (!data) return null

  const parsed = JSON.parse(data)

  if (parsed.action !== action || parsed.contextId !== contextId) return null

  // ── FIX: Enforce channelId match if caller provides it ───────────
  if (expectedChannelId && parsed.channelId !== expectedChannelId) return null

  // Consume token — one-time use
  await redis.del(`approval:${token}`)
  return { approverId: parsed.approverId, actorId: parsed.actorId }
}
