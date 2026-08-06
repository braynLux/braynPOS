import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()

// ── System Chart of Accounts ────────────────────────────────────────
// MUST use these stable IDs — referenced in lib/ledger.ts
const SYSTEM_ACCOUNTS = [
  { id: 'acc-1010', code: '1010', name: 'Cash on Hand',              type: 'ASSET' as const,     isSystem: true },
  { id: 'acc-1020', code: '1020', name: 'Bank Account',              type: 'ASSET' as const,     isSystem: true },
  { id: 'acc-1200', code: '1200', name: 'Accounts Receivable',       type: 'ASSET' as const,     isSystem: true },
  { id: 'acc-1500', code: '1500', name: 'Inventory Valuation',       type: 'ASSET' as const,     isSystem: true },
  { id: 'acc-2000', code: '2000', name: 'Accounts Payable',          type: 'LIABILITY' as const, isSystem: true },
  { id: 'acc-2100', code: '2100', name: 'Tax Payable',               type: 'LIABILITY' as const, isSystem: true },
  { id: 'acc-3000', code: '3000', name: 'Retained Earnings',         type: 'EQUITY' as const,    isSystem: true },
  { id: 'acc-4000', code: '4000', name: 'Sales Revenue',             type: 'REVENUE' as const,   isSystem: true },
  { id: 'acc-5000', code: '5000', name: 'Cost of Goods Sold',        type: 'EXPENSE' as const,   isSystem: true },
  { id: 'acc-5100', code: '5100', name: 'Shrinkage & Transit Loss',  type: 'EXPENSE' as const,   isSystem: true },
  { id: 'acc-5200', code: '5200', name: 'Payroll Expense',           type: 'EXPENSE' as const,   isSystem: true },
  { id: 'acc-5300', code: '5300', name: 'General Expenses',          type: 'EXPENSE' as const,   isSystem: true },
]

// ── Export stable account IDs for use in ledger.ts ──────────────────
export const ACCOUNT_IDS = Object.fromEntries(
  SYSTEM_ACCOUNTS.map(a => [a.code, a.id])
) as Record<string, string>

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? undefined : 'Admin@123')
  const adminPasswordHashOptions = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 }

  console.log('🌱 Seeding BRAYN Hybrid Edition database...')

  // ── Upsert system accounts ──────────────────────────────────────
  for (const acct of SYSTEM_ACCOUNTS) {
    await prisma.account.upsert({
      where: { id: acct.id },
      create: acct,
      update: {},
    })
    console.log(`  ✓ Account ${acct.code}: ${acct.name}`)
  }

  // ── Seed default channel (Main Warehouse) ───────────────────────
  const defaultChannel = await prisma.channel.upsert({
    where: { code: 'HQ' },
    create: {
      name: 'Headquarters',
      code: 'HQ',
      type: 'WAREHOUSE',
      isMainWarehouse: true,
    },
    update: {},
  })
  console.log(`  ✓ Channel: ${defaultChannel.name} (${defaultChannel.code})`)

  // ── Seed super admin user ───────────────────────────────────────
  // Password: Admin@123 (hashed with argon2 — replace in production)
  const adminUser = await prisma.user.upsert({
    where: { id: 'usr-super-admin' },
    create: {
      id: 'usr-super-admin',
      username: 'admin',
      email: 'admin@brayn.app',
      passwordHash: await argon2.hash(adminPassword || randomUUID(), adminPasswordHashOptions),
      role: 'SUPER_ADMIN',
      channelId: defaultChannel.id,
    },
    update: adminPassword
      ? { passwordHash: await argon2.hash(adminPassword, adminPasswordHashOptions) }
      : {},
  })
  console.log(`  ✓ Admin user: ${adminUser.username} (${adminUser.email})`)

  // ── Seed document template for receipts ─────────────────────────
  await prisma.documentTemplate.upsert({
    where: { id: 'tpl-receipt-default' },
    create: {
      id: 'tpl-receipt-default',
      name: 'Default Receipt',
      type: 'receipt',
      content: JSON.stringify({
        header: '{{channelName}}',
        showLogo: true,
        showAddress: true,
        footer: 'Thank you for shopping with us!',
        paperSize: '80mm',
      }),
    },
    update: {},
  })
  console.log('  ✓ Default receipt template')

  // ── Seed sample categories and items ───────────────────────────
  const catElectronics = await prisma.category.upsert({
    where: { id: 'c0a80101-0000-4000-8000-000000000001' },
    create: { 
      id: 'c0a80101-0000-4000-8000-000000000001',
      name: 'Electronics' 
    },
    update: {},
  })

  const itemLaptop = await prisma.item.upsert({
    where: { id: 'c0a80101-0000-4000-8000-000000000002' },
    create: {
      id: 'c0a80101-0000-4000-8000-000000000002',
      sku: 'LP-GEN-001',
      name: 'Generic Business Laptop',
      categoryId: catElectronics.id,
      retailPrice: 45000,
      wholesalePrice: 42000,
      minRetailPrice: 40000,
      weightedAvgCost: 35000,
      isSerialized: false,
    },
    update: {},
  })

  const itemMouse = await prisma.item.upsert({
    where: { id: 'c0a80101-0000-4000-8000-000000000003' },
    create: {
      id: 'c0a80101-0000-4000-8000-000000000003',
      sku: 'MS-OPT-002',
      name: 'Optical Wireless Mouse',
      categoryId: catElectronics.id,
      retailPrice: 1500,
      wholesalePrice: 1200,
      minRetailPrice: 1100,
      weightedAvgCost: 800,
      isSerialized: false,
    },
    update: {},
  })

  // ── Seed inventory balances for HQ ─────────────────────────────
  await (prisma as any).inventoryBalance.upsert({
    where: { 
      itemId_channelId: { itemId: itemLaptop.id, channelId: defaultChannel.id } 
    },
    create: {
      itemId: itemLaptop.id,
      channelId: defaultChannel.id,
      availableQty: 50,
      retailPrice: itemLaptop.retailPrice,
      wholesalePrice: itemLaptop.wholesalePrice,
      minRetailPrice: itemLaptop.minRetailPrice,
      minWholesalePrice: itemLaptop.minWholesalePrice,
      weightedAvgCost: itemLaptop.weightedAvgCost,
    },
    update: {
      availableQty: 50,
      retailPrice: itemLaptop.retailPrice,
      wholesalePrice: itemLaptop.wholesalePrice,
      minRetailPrice: itemLaptop.minRetailPrice,
      minWholesalePrice: itemLaptop.minWholesalePrice,
      weightedAvgCost: itemLaptop.weightedAvgCost,
    },
  })

  await (prisma as any).inventoryBalance.upsert({
    where: { 
      itemId_channelId: { itemId: itemMouse.id, channelId: defaultChannel.id } 
    },
    create: {
      itemId: itemMouse.id,
      channelId: defaultChannel.id,
      availableQty: 200,
      retailPrice: itemMouse.retailPrice,
      wholesalePrice: itemMouse.wholesalePrice,
      minRetailPrice: itemMouse.minRetailPrice,
      minWholesalePrice: itemMouse.minWholesalePrice,
      weightedAvgCost: itemMouse.weightedAvgCost,
    },
    update: {
      availableQty: 200,
      retailPrice: itemMouse.retailPrice,
      wholesalePrice: itemMouse.wholesalePrice,
      minRetailPrice: itemMouse.minRetailPrice,
      minWholesalePrice: itemMouse.minWholesalePrice,
      weightedAvgCost: itemMouse.weightedAvgCost,
    },
  })

  // ── Seed an open sales session ──────────────────────────────────
  await prisma.salesSession.upsert({
    where: { id: 'c0a80101-0000-4000-8000-000000000004' },
    create: {
      id: 'c0a80101-0000-4000-8000-000000000004',
      userId: adminUser.id,
      channelId: defaultChannel.id,
      openedAt: new Date(),
      status: 'OPEN',
      openingFloat: 5000,
    },
    update: { status: 'OPEN' },
  })
  console.log('  ✓ Sample items, inventory, and session seeded')

  console.log('\n✅ Seed complete!')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
