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
import { redis } from './lib/redis.js'

const PORT = parseInt(process.env.PORT || process.env.API_PORT || '4000', 10)
const HOST = process.env.API_HOST || '0.0.0.0'

/**
 * 🛠️ Maintenance Hook: Admin Recovery
 * Allows resetting the super-admin password via environment variable if lockouts occur.
 */
async function syncAdmin() {
  const resetPass = process.env.ADMIN_PASSWORD_RESET
  if (!resetPass) return

  const { hashPassword } = await import('./lib/password.js')
  
  // Find or Create HQ Channel (Required for Super Admin)
  let hqChannel = await basePrisma.channel.findUnique({ where: { code: 'HQ' } })
  if (!hqChannel) {
    hqChannel = await basePrisma.channel.create({
      data: { name: 'Headquarters', code: 'HQ', type: 'WAREHOUSE' }
    })
  }

  const passwordHash = await hashPassword(resetPass)
  // FIX: Use email-based lookup instead of hardcoded static ID for security
  await basePrisma.user.upsert({
    where: { email: 'admin@brayn.app' },
    create: {
      username: 'admin',
      email: 'admin@brayn.app',
      passwordHash,
      role: 'SUPER_ADMIN',
      channelId: hqChannel.id,
      status: 'ACTIVE',
    },
    update: {
      passwordHash,
      status: 'ACTIVE',
    },
  })
  
  console.log('✅ [MAINTENANCE] Admin user synced/reset successfully.')
}

async function start() {
  console.log('🚀 [BOOT] Starting BraynPOS API restoration sequence...')
  console.log('🔗 [BOOT] PORT:', PORT)
  console.log('🔗 [BOOT] HOST:', HOST)

  try {
    // Seed system ledger accounts first
    await seedAccounts().catch(e => console.error('Ledger Seed Error:', e))
    
    // Auto-cleanup duplicates from double-click race conditions
    await cleanupDuplicateItems().catch(e => console.error('Cleanup Error:', e))
    
    // Wrap syncAdmin in a race to prevent silent DB hangs
    console.log('⌚ [BOOT] Syncing Admin (Maintenance Hook)...')
    const syncPromise = syncAdmin()
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('TIMEOUT: Database connection stalled during syncAdmin')), 10000)
    )
    await Promise.race([syncPromise, timeoutPromise])
    console.log('✅ [BOOT] syncAdmin completed.')
  } catch (err: any) {
    console.warn(`⚠️ [BOOT] syncAdmin failed or timed out: ${err.message}. Continuing...`)
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

  // ── Last-resort guard for unhandled async failures ──────────────────
  // Node terminates the process on an unhandled rejection by default, and
  // async EventEmitter listeners are an easy way to produce one: the emitter
  // neither awaits nor catches the promise a listener returns, so a single
  // failed background alert or notification could take the whole API down
  // mid-request. Individual listeners are guarded at their own call sites;
  // this only exists so that an unguarded one added later degrades to a log
  // line instead of an outage. It deliberately does not exit — a rejected
  // side-effect promise says nothing about whether the server can keep
  // serving traffic.
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'Unhandled promise rejection — surfaced but not fatal')
  })

  // An uncaught exception leaves the process in an genuinely unknown state, so
  // this one logs and re-throws the default behaviour by exiting: the platform
  // restarts us, which is safer than continuing on corrupt state.
  process.on('uncaughtException', (err) => {
    app.log.fatal({ err }, 'Uncaught exception — exiting for restart')
    process.exit(1)
  })

  // Graceful shutdown
  const signals = ['SIGINT', 'SIGTERM'] as const
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal} — shutting down gracefully...`)
      await app.close()
      await basePrisma.$disconnect()
      await redis.quit()
      process.exit(0)
    })
  }
}

start()
 
