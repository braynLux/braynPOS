import { Prisma } from '@prisma/client'
import { requestContext } from './request-context.plugin.js'

const READ_OPS   = new Set(['findFirst', 'findMany', 'findUnique', 'findUniqueOrThrow', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy'])
const WRITE_OPS  = new Set(['create', 'createMany'])
const MUTATE_OPS = new Set(['update', 'updateMany', 'upsert', 'delete', 'deleteMany'])

const ISOLATED_MODELS = new Set([
  'Purchase', 'PurchaseOrder',
  'Expense',
  'SalesSession', 'Sale',
  'StockMovement', 'StockTake',
  'Account', 'JournalEntry',
  'InventoryBalance',
  'Brand', 'Category', 'Supplier', 'Customer',
  'SalaryRun',
  'DeductionRule', 'AllowanceRule',
  'TaxConnectorConfig', 'DocumentTemplate',
  'Notification', 'Setting',
  'CommissionRule', 'CommissionEntry', 'CommissionPayout',
  'Serial',
  'Transfer',
  'SupportTicket', 'LoyaltyTransaction', 'CustomerPayment',
  'FixedAsset', 'UserTarget',
  'SyncConflict',
  // AUDIT FIX: Previously unprotected — cross-channel data breach risk
  'User',           // Users must only see/edit users in their channel
  'BankDeposit',    // Deposits are per-channel financial records
  'ManagerApproval', // Approval requests must not leak across channels
])

// Models whose create() already receives an explicit channelId from the
// service layer. Auto-injecting on create would be redundant/harmful.
const CREATE_SKIP_INJECT = new Set([
  'User',           // usersService always sets channelId explicitly
  'ManagerApproval', // created with explicit channelId
  'BankDeposit',    // created with explicit channelId
])

const GLOBAL_OPTIONAL_MODELS = new Set([
  'Brand', 'Category', 'Supplier',
  'DeductionRule', 'AllowanceRule',
  'Setting',
  'CommissionRule',
])

// Models that use fromChannelId/toChannelId instead of channelId.
// These are isolated for READ/MUTATE but must NOT have channelId
// auto-injected into create() data — they don't have that field.
const DUAL_CHANNEL_MODELS = new Set([
  'Transfer',
])

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN'])

export const multiTenantExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ctx = requestContext.getStore()
          const skip = !ctx || !ctx.channelId || ADMIN_ROLES.has(ctx.role || '') || !ISOLATED_MODELS.has(model)

          if (skip) {
            return query(args)
          }

          const channelId = ctx.channelId
          const castArgs  = args as any

          // ── READ operations ──────────────────────────────────────────
          if (READ_OPS.has(operation)) {
            // FIX: Transfer uses fromChannelId/toChannelId — handle before
            // standard channelId injection so it never gets channelId filter
            if (DUAL_CHANNEL_MODELS.has(model)) {
              castArgs.where = castArgs.where || {}
              if (
                castArgs.where.OR        === undefined &&
                castArgs.where.fromChannelId === undefined &&
                castArgs.where.toChannelId   === undefined
              ) {
                castArgs.where.OR = [
                  { fromChannelId: channelId },
                  { toChannelId:   channelId },
                ]
              }
              return query(args)
            }

            castArgs.where = castArgs.where || {}
            if (castArgs.where.channelId === undefined && castArgs.where.OR === undefined) {
              if (GLOBAL_OPTIONAL_MODELS.has(model)) {
                castArgs.where.OR = [{ channelId }, { channelId: null }]
              } else {
                castArgs.where.channelId = channelId
              }
            }
          }

          // ── WRITE operations ─────────────────────────────────────────
          else if (WRITE_OPS.has(operation)) {
            // FIX: DUAL_CHANNEL_MODELS (Transfer) must NOT get channelId
            // injected — they don't have that column. fromChannelId and
            // toChannelId are set explicitly by the service.
            if (DUAL_CHANNEL_MODELS.has(model)) {
              return query(args)
            }

            if (operation === 'create') {
              castArgs.data = castArgs.data || {}
              // Only inject channelId if not already set AND this model doesn't
              // manage its own channelId in the service layer
              if (castArgs.data.channelId === undefined && !CREATE_SKIP_INJECT.has(model)) {
                castArgs.data.channelId = channelId
              }
            } else if (operation === 'createMany') {
              if (Array.isArray(castArgs.data) && !CREATE_SKIP_INJECT.has(model)) {
                castArgs.data = castArgs.data.map((row: any) =>
                  row.channelId !== undefined ? row : { ...row, channelId }
                )
              }
            }
          }

          // ── MUTATE operations ────────────────────────────────────────
          else if (MUTATE_OPS.has(operation)) {
            // Transfer: scope updates to channels this user is party to
            if (DUAL_CHANNEL_MODELS.has(model)) {
              castArgs.where = castArgs.where || {}
              if (
                castArgs.where.OR            === undefined &&
                castArgs.where.fromChannelId === undefined &&
                castArgs.where.toChannelId   === undefined
              ) {
                castArgs.where.OR = [
                  { fromChannelId: channelId },
                  { toChannelId:   channelId },
                ]
              }
              return query(args)
            }

            castArgs.where = castArgs.where || {}
            if (castArgs.where.channelId === undefined) {
              castArgs.where.channelId = channelId
            }
          }

          return query(args)
        },
      },
    },
  })
})
