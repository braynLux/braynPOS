import { beforeAll, afterAll, afterEach } from 'vitest'
import { prisma } from '../lib/prisma.js'
import { execSync } from 'child_process'
import dotenv from 'dotenv'
import path from 'path'

// Load test environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') })

beforeAll(async () => {
  // Ensure the test database is fully synced with the current schema.prisma
  try {
    console.log('Pushing schema to test database...')
    execSync('pnpm exec prisma db push --skip-generate', {
      stdio: 'inherit',
      env: process.env,
    })
  } catch (err) {
    console.error('Failed to sync test database schema:', err)
    // Don't exit process, let Vitest handle it
  }
})

// Run cleanup AFTER each test so that:
// 1. The test's own beforeEach can create seed data without it being wiped first.
// 2. Data is still cleaned up between tests (afterEach of test N runs before beforeEach of test N+1)
afterEach(async () => {
  const tableNames = [
    'payments', 'sale_items', 'sales',
    'inventory_balances', 'stock_movements',
    'serials', 'transfer_lines', 'transfers',
    'items', 'categories', 'brands', 'suppliers',
    'support_messages', 'support_tickets',
    'sales_sessions', 'users', 'channels', 'audit_logs',
    'manager_approvals',
    'notifications', 'idempotency_records', 'settings'
  ]

  for (const table of tableNames) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`)
    } catch {
      // Ignore if table doesn't exist yet
    }
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})
