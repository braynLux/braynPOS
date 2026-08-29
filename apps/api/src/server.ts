// v2.0.1 — multi-tenant fleet console, enterprise onboarding, superadmin provisioning
import 'dotenv/config'
import { buildApp } from './app.js'
import { Server } from 'socket.io'
import { setupSupportSocket } from './modules/support/support.socket.js'
import { startProactiveMonitor } from './modules/support/proactive-monitor.js'
import { startCommissionListener } from './modules/commission/commission.listener.js'
import { startNotificationWorker }  from './workers/notification.worker.js'
import { seedAccounts } from './lib/seed-accounts.js'
import { cleanupDuplicateItems } from './lib/cleanup-duplicates.js'
import { basePrisma } from './lib/prisma.js'
import { startStockRefreshWorker } from './workers/stock-refresh.worker.js'
import { purgeExpiredSecurityRecords } from './lib/pg-store.js'

const PORT = parseInt(process.env.PORT || process.env.API_PORT || '4000', 10)
const HOST = process.env.API_HOST || '0.0.0.0'

/**
 * 🛠️ Maintenance Hook: Admin Recovery
 * Allows resetting the super-admin password via environment variable if lockouts occur.
 */
async function syncAdmin() {
  const { hashPassword } = await import('./lib/password.js')
  
  // Find or Create HQ Channel (Required for Super Admin)
  let hqChannel = await basePrisma.channel.findUnique({ where: { code: 'HQ' } })
  if (!hqChannel) {
    hqChannel = await basePrisma.channel.create({
      data: { name: 'Headquarters', code: 'HQ', type: 'WAREHOUSE' }
    })
  }

  const defaultPassword = process.env.ADMIN_PASSWORD_RESET || process.env.DEFAULT_SUPERADMIN_PASSWORD || 'Admin@Brayn2026!'
  const passwordHash = await hashPassword(defaultPassword)

  const existingAdmin = await basePrisma.user.findFirst({
    where: { OR: [{ username: 'admin' }, { email: 'admin@brayn.app' }] }
  })

  if (!existingAdmin) {
    await basePrisma.user.create({
      data: {
        username: 'admin',
        email: 'admin@brayn.app',
        passwordHash,
        role: 'PLATFORM_OWNER',
        channelId: hqChannel.id,
        status: 'ACTIVE',
      },
    })
    console.log('✅ [BOOT] Default Platform Owner (admin) provisioned successfully.')
  } else {
    // If admin exists, ensure role is PLATFORM_OWNER and sync password if reset env var provided
    const shouldUpdatePassword = Boolean(process.env.ADMIN_PASSWORD_RESET)
    await basePrisma.user.update({
      where: { id: existingAdmin.id },
      data: {
        role: 'PLATFORM_OWNER',
        status: 'ACTIVE',
        ...(shouldUpdatePassword ? { passwordHash } : {}),
      },
    })
    console.log('✅ [BOOT] Platform Owner admin verified.')
  }
}

async function ensureDatabaseSchema() {
  try {
    console.log('🔄 [BOOT] Ensuring multi-tenant & security database schema...')
    
    // 1. Enum
    await basePrisma.$executeRawUnsafe(`ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PLATFORM_OWNER';`).catch(() => {})

    // 2. Enterprise table
    await basePrisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "enterprises" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "slug" TEXT NOT NULL UNIQUE,
        "email" TEXT NOT NULL,
        "phone" TEXT,
        "logoUrl" TEXT,
        "plan" TEXT NOT NULL DEFAULT 'STARTER',
        "planFeatures" JSONB,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3)
      );
    `).catch(() => {})

    // 3. Columns
    await basePrisma.$executeRawUnsafe(`ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "enterpriseId" TEXT;`).catch(() => {})
    await basePrisma.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "enterpriseId" TEXT;`).catch(() => {})
    await basePrisma.$executeRawUnsafe(`ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "enterpriseId" TEXT;`).catch(() => {})
    await basePrisma.$executeRawUnsafe(`ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "enterpriseId" TEXT;`).catch(() => {})

    // 4. Security tables
    await basePrisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'revoked_tokens' AND column_name = 'id') THEN
          DROP TABLE IF EXISTS "revoked_tokens" CASCADE;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'manager_approval_tokens' AND column_name = 'token') THEN
          DROP TABLE IF EXISTS "manager_approval_tokens" CASCADE;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'login_attempts' AND column_name = 'key') THEN
          DROP TABLE IF EXISTS "login_attempts" CASCADE;
        END IF;
      END $$;
    `).catch(() => {})

    await basePrisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "revoked_tokens" (
        "token" TEXT NOT NULL PRIMARY KEY,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `).catch(() => {})

    await basePrisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "manager_approval_tokens" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "action" TEXT NOT NULL,
        "contextId" TEXT NOT NULL,
        "channelId" TEXT,
        "approverId" TEXT NOT NULL,
        "actorId" TEXT NOT NULL,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `).catch(() => {})

    await basePrisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "login_attempts" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `).catch(() => {})

    await basePrisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "enterprise_invites" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "code" TEXT NOT NULL UNIQUE,
        "businessName" TEXT,
        "plan" TEXT NOT NULL DEFAULT 'STARTER',
        "createdBy" TEXT NOT NULL,
        "isUsed" BOOLEAN NOT NULL DEFAULT false,
        "usedAt" TIMESTAMP(3),
        "enterpriseId" TEXT,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `).catch(() => {})

    console.log('✅ [BOOT] Database schema verified & up to date.')
  } catch (err: any) {
    console.error('⚠️ [BOOT] Database schema verification error:', err?.message || err)
  }
}

async function start() {
  console.log('🚀 [BOOT] Starting BraynPOS API restoration sequence...')
  console.log('🔗 [BOOT] PORT:', PORT)
  console.log('🔗 [BOOT] HOST:', HOST)

  try {
    // 1. Ensure all tables and columns exist
    await ensureDatabaseSchema()

    // 2. Seed system ledger accounts
    await seedAccounts().catch(e => console.error('Ledger Seed Error:', e))
    
    // 3. Auto-cleanup duplicates from double-click race conditions
    await cleanupDuplicateItems().catch(e => console.error('Cleanup Error:', e))
    
    // 4. Wrap syncAdmin in a race to prevent silent DB hangs
    console.log('⌚ [BOOT] Syncing Admin (Maintenance Hook)...')
    const syncPromise = syncAdmin()
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('TIMEOUT: Database connection stalled during syncAdmin')), 10000)
    )
    await Promise.race([syncPromise, timeoutPromise])
    console.log('✅ [BOOT] syncAdmin completed.')
  } catch (err: any) {
    console.warn(`⚠️ [BOOT] Database bootstrap sequence failed or timed out: ${err.message}. Continuing...`)
  }

  console.log('🏗️ [BOOT] Building Fastify app...')
  const app = await buildApp()
  console.log('✅ [BOOT] Fastify app built.')

  // FIX: Set up Socket.io and all handlers BEFORE app.listen() to
  // eliminate the race condition where connections arrive before handlers are wired.
  const io = new Server(app.server, {
    cors: {
      origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:3000'],
      credentials: true
    }
  })

  setupSupportSocket(io)
  const { setupNotificationSocket } = await import('./modules/notifications/notifications.socket.js')
  setupNotificationSocket(io)

  const { setupApprovalSocket } = await import('./modules/users/approval.socket.js')
  setupApprovalSocket(io)
  
  const { setupInventorySocket } = await import('./modules/inventory/inventory.socket.js')
  setupInventorySocket(io)

  startProactiveMonitor()
  startCommissionListener()
  const { startLoyaltyListener } = await import('./modules/loyalty/loyalty.listener.js')
  startLoyaltyListener()
  startNotificationWorker()
  startStockRefreshWorker()

  // Schedule hourly cleanup for expired tokens & attempts
  const cleanupTimer = setInterval(() => {
    purgeExpiredSecurityRecords().catch(err => console.error('[Cleanup Error]:', err))
  }, 3600_000)
  cleanupTimer.unref()

  // FIX: listen() comes LAST — after all handlers are ready
  try {
    console.log('👂 [BOOT] Starting listener...')
    await app.listen({ port: PORT, host: HOST })
    app.log.info(`🚀 BRAYN API v2.0 running on http://${HOST}:${PORT}`)
    app.log.info(`🔌 Socket.io initialized`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }

  // Graceful shutdown
  const signals = ['SIGINT', 'SIGTERM'] as const
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal} — shutting down gracefully...`)
      clearInterval(cleanupTimer)
      await app.close()
      await basePrisma.$disconnect()
      process.exit(0)
    })
  }
}

start()
 
