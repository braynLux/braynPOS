import { Prisma } from '@prisma/client'
import { requestContext } from './request-context.plugin.js'

const READ_OPS   = new Set(['findFirst', 'findMany', 'findUnique', 'findUniqueOrThrow', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy'])
const WRITE_OPS  = new Set(['create', 'createMany'])
const MUTATE_OPS = new Set(['update', 'updateMany', 'upsert', 'delete', 'deleteMany'])

// Models with direct enterpriseId column
const ENTERPRISE_DIRECT_MODELS = new Set([
  'Channel',
  'User',
  'Item',
  'AuditLog',
  'SystemNotification',
  'SubscriptionPayment',
  'EnterpriseInvite',
])

// Models scoped to Channel (which belongs to an Enterprise)
const CHANNEL_SCOPED_MODELS = new Set([
  'Purchase', 'PurchaseOrder',
  'Expense', 'ExpenseCategory',
  'SalesSession', 'Sale',
  'StockMovement', 'StockTake',
  'Account', 'JournalEntry',
  'InventoryBalance',
  'Brand', 'Category', 'Supplier', 'Customer',
  'SalaryRun',
  'DeductionRule', 'AllowanceRule',
  'TaxConnectorConfig', 'DocumentTemplate',
  'Setting',
  'CommissionRule', 'CommissionEntry', 'CommissionPayout',
  'Serial',
  'SupportTicket', 'LoyaltyTransaction', 'CustomerPayment',
  'FixedAsset', 'UserTarget',
  'SyncConflict',
  'BankDeposit',
  'ManagerApproval',
  'Invoice',
  'RepairRequest',
  'ServiceChecklist',
  'Notification',
])

const DUAL_CHANNEL_MODELS = new Set([
  'Transfer',
])

const ADMIN_ROLES = new Set(['PLATFORM_OWNER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN'])

export const multiTenantExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ctx = requestContext.getStore()
          if (!ctx) return query(args)

          const castArgs = args as any
          const isPlatformOwner = ctx.role === 'PLATFORM_OWNER'
          const enterpriseId = ctx.enterpriseId

          // ── 1. Enterprise-Level Fortress Isolation ──────────────────────
          // When active in an enterprise context:
          if (enterpriseId) {
            // A. Direct Enterprise Models (Channel, User, Item, AuditLog, etc.)
            if (ENTERPRISE_DIRECT_MODELS.has(model)) {
              if (READ_OPS.has(operation) || MUTATE_OPS.has(operation)) {
                castArgs.where = castArgs.where || {}
                if (castArgs.where.enterpriseId === undefined) {
                  castArgs.where.enterpriseId = enterpriseId
                }
              } else if (WRITE_OPS.has(operation)) {
                if (operation === 'create') {
                  castArgs.data = castArgs.data || {}
                  if (castArgs.data.enterpriseId === undefined) {
                    castArgs.data.enterpriseId = enterpriseId
                  }
                } else if (operation === 'createMany') {
                  if (Array.isArray(castArgs.data)) {
                    castArgs.data = castArgs.data.map((row: any) =>
                      row.enterpriseId !== undefined ? row : { ...row, enterpriseId }
                    )
                  }
                }
              }
            }

            // B. Channel-Scoped Models (Sale, Account, Customer, Purchase, etc.)
            else if (CHANNEL_SCOPED_MODELS.has(model)) {
              if (READ_OPS.has(operation) || MUTATE_OPS.has(operation)) {
                castArgs.where = castArgs.where || {}
                // Ensure query is strictly bounded by enterprise-owned channels
                if (castArgs.where.channel === undefined) {
                  castArgs.where.channel = { enterpriseId }
                } else if (typeof castArgs.where.channel === 'object' && castArgs.where.channel !== null) {
                  castArgs.where.channel.enterpriseId = enterpriseId
                }
              }
            }

            // C. Dual-Channel Models (Transfer)
            else if (DUAL_CHANNEL_MODELS.has(model)) {
              if (READ_OPS.has(operation) || MUTATE_OPS.has(operation)) {
                castArgs.where = castArgs.where || {}
                if (castArgs.where.OR === undefined && castArgs.where.fromChannel === undefined && castArgs.where.toChannel === undefined) {
                  castArgs.where.OR = [
                    { fromChannel: { enterpriseId } },
                    { toChannel:   { enterpriseId } },
                  ]
                }
              }
            }
          }

          // ── 2. Staff Channel-Level Isolation (Non-Admins) ───────────────
          const skipChannel = !ctx.channelId || ADMIN_ROLES.has(ctx.role || '') || !CHANNEL_SCOPED_MODELS.has(model)
          if (skipChannel) {
            return query(args)
          }

          const channelId = ctx.channelId

          if (READ_OPS.has(operation)) {
            castArgs.where = castArgs.where || {}
            if (castArgs.where.channelId === undefined && castArgs.where.channel?.id === undefined) {
              castArgs.where.channelId = channelId
            }
          } else if (WRITE_OPS.has(operation)) {
            if (operation === 'create') {
              castArgs.data = castArgs.data || {}
              if (castArgs.data.channelId === undefined) {
                castArgs.data.channelId = channelId
              }
            } else if (operation === 'createMany') {
              if (Array.isArray(castArgs.data)) {
                castArgs.data = castArgs.data.map((row: any) =>
                  row.channelId !== undefined ? row : { ...row, channelId }
                )
              }
            }
          } else if (MUTATE_OPS.has(operation)) {
            castArgs.where = castArgs.where || {}
            if (castArgs.where.channelId === undefined && castArgs.where.channel?.id === undefined) {
              castArgs.where.channelId = channelId
            }
          }

          return query(args)
        },
      },
    },
  })
})
