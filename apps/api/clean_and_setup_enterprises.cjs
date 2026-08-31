const { PrismaClient } = require('@prisma/client')
const argon2 = require('argon2')

const prisma = new PrismaClient()

async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  })
}

async function cleanAndSetup() {
  const allEnts = await prisma.enterprise.findMany({
    include: {
      channels: { select: { id: true, name: true, code: true } },
      users: { select: { id: true, username: true, role: true } },
    },
  })

  // We only keep the 3 desired enterprises:
  // 1. Prototype (slug: 'prototype')
  // 2. Apex (slug: 'apex-pro-retail')
  // 3. Boutique (slug: 'boutique-starter')
  const toKeepSlugs = new Set(['prototype', 'apex-pro-retail', 'boutique-starter'])

  const toDelete = allEnts.filter(e => !toKeepSlugs.has(e.slug))

  console.log(`Deleting ${toDelete.length} excess enterprises...`)

  for (const tent of toDelete) {
    console.log(`Deleting: ${tent.name} (Slug: ${tent.slug}, ID: ${tent.id})...`)
    const channelIds = (await prisma.channel.findMany({ where: { enterpriseId: tent.id }, select: { id: true } })).map(c => c.id)

    if (channelIds.length > 0) {
      await prisma.saleItem.deleteMany({ where: { sale: { channelId: { in: channelIds } } } }).catch(() => {})
      await prisma.payment.deleteMany({ where: { sale: { channelId: { in: channelIds } } } }).catch(() => {})
      await prisma.sale.deleteMany({ where: { channelId: { in: channelIds } } }).catch(() => {})
      await prisma.stockMovement.deleteMany({ where: { channelId: { in: channelIds } } }).catch(() => {})
      await prisma.inventoryBalance.deleteMany({ where: { channelId: { in: channelIds } } }).catch(() => {})
      await prisma.customerPayment.deleteMany({ where: { channelId: { in: channelIds } } }).catch(() => {})
      await prisma.loyaltyTransaction.deleteMany({ where: { channelId: { in: channelIds } } }).catch(() => {})
      await prisma.customer.deleteMany({ where: { channelId: { in: channelIds } } }).catch(() => {})
    }

    await prisma.item.deleteMany({ where: { enterpriseId: tent.id } }).catch(() => {})
    await prisma.user.deleteMany({ where: { enterpriseId: tent.id } }).catch(() => {})
    await prisma.channel.deleteMany({ where: { enterpriseId: tent.id } }).catch(() => {})
    await prisma.subscriptionPayment.deleteMany({ where: { enterpriseId: tent.id } }).catch(() => {})
    await prisma.systemNotification.deleteMany({ where: { enterpriseId: tent.id } }).catch(() => {})
    await prisma.enterpriseInvite.deleteMany({ where: { enterpriseId: tent.id } }).catch(() => {})
    await prisma.enterprise.delete({ where: { id: tent.id } }).catch(() => {})
  }

  // Ensure Prototype Enterprise exists and is ENTERPRISE tier
  let prototypeEnt = await prisma.enterprise.findUnique({ where: { slug: 'prototype' }, include: { channels: true, users: true } })
  if (!prototypeEnt) {
    prototypeEnt = await prisma.enterprise.create({
      data: {
        name: 'LUX Prototype Enterprise',
        slug: 'prototype',
        plan: 'ENTERPRISE',
        billingStatus: 'ACTIVE',
        subscriptionPrice: 15000,
        billingCycle: 'MONTHLY',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        isActive: true,
      },
      include: { channels: true, users: true },
    })
  } else {
    prototypeEnt = await prisma.enterprise.update({
      where: { id: prototypeEnt.id },
      data: {
        plan: 'ENTERPRISE',
        billingStatus: 'ACTIVE',
        subscriptionPrice: 15000,
        billingCycle: 'MONTHLY',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        isActive: true,
      },
      include: { channels: true, users: true },
    })
  }

  const hash = await hashPassword('admin123')

  // Ensure Prototype channel and user
  let protoChannel = prototypeEnt.channels[0]
  if (!protoChannel) {
    protoChannel = await prisma.channel.create({
      data: {
        name: 'LUX Flagship HQ',
        code: 'LUX-HQ',
        type: 'RETAIL_SHOP',
        isMainWarehouse: true,
        enterpriseId: prototypeEnt.id,
      },
    })
  }

  let protoUser = await prisma.user.findFirst({
    where: { enterpriseId: prototypeEnt.id, username: 'superadmin.prototype' },
  })
  if (!protoUser) {
    await prisma.user.create({
      data: {
        username: 'superadmin.prototype',
        email: 'superadmin@prototype.lux',
        passwordHash: hash,
        role: 'SUPER_ADMIN',
        enterpriseId: prototypeEnt.id,
        channelId: protoChannel.id,
        status: 'ACTIVE',
      },
    })
  }

  // 2. Ensure PRO Enterprise
  let proEnt = await prisma.enterprise.findUnique({ where: { slug: 'apex-pro-retail' }, include: { channels: true, users: true } })
  if (!proEnt) {
    proEnt = await prisma.enterprise.create({
      data: {
        name: 'Apex Retailers (Pro Plan)',
        slug: 'apex-pro-retail',
        plan: 'PRO',
        billingStatus: 'ACTIVE',
        subscriptionPrice: 7500,
        billingCycle: 'MONTHLY',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isActive: true,
      },
      include: { channels: true, users: true },
    })
  }

  let proChan = proEnt.channels[0]
  if (!proChan) {
    proChan = await prisma.channel.create({
      data: {
        name: 'Apex City Branch',
        code: 'APEX-01',
        type: 'RETAIL_SHOP',
        enterpriseId: proEnt.id,
      },
    })
  }

  let proAdmin = await prisma.user.findFirst({ where: { enterpriseId: proEnt.id, username: 'admin_pro' } })
  if (!proAdmin) {
    await prisma.user.create({
      data: {
        username: 'admin_pro',
        email: 'admin_pro@apex.com',
        passwordHash: hash,
        role: 'SUPER_ADMIN',
        enterpriseId: proEnt.id,
        channelId: proChan.id,
        status: 'ACTIVE',
      },
    })
  }

  // 3. Ensure STARTER / Basic Enterprise
  let basicEnt = await prisma.enterprise.findUnique({ where: { slug: 'boutique-starter' }, include: { channels: true, users: true } })
  if (!basicEnt) {
    basicEnt = await prisma.enterprise.create({
      data: {
        name: 'Boutique Corner (Basic/Starter)',
        slug: 'boutique-starter',
        plan: 'STARTER',
        billingStatus: 'TRIAL',
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        subscriptionPrice: 3000,
        billingCycle: 'MONTHLY',
        isActive: true,
      },
      include: { channels: true, users: true },
    })
  }

  let basicChan = basicEnt.channels[0]
  if (!basicChan) {
    basicChan = await prisma.channel.create({
      data: {
        name: 'Boutique Storefront',
        code: 'BTQ-01',
        type: 'RETAIL_SHOP',
        enterpriseId: basicEnt.id,
      },
    })
  }

  let basicAdmin = await prisma.user.findFirst({ where: { enterpriseId: basicEnt.id, username: 'admin_basic' } })
  if (!basicAdmin) {
    await prisma.user.create({
      data: {
        username: 'admin_basic',
        email: 'admin_basic@boutique.com',
        passwordHash: hash,
        role: 'SUPER_ADMIN',
        enterpriseId: basicEnt.id,
        channelId: basicChan.id,
        status: 'ACTIVE',
      },
    })
  }

  console.log('\n======================================================')
  console.log('✅ ENTERPRISE WORKSPACES STRICTLY CURATED')
  console.log('======================================================')
  const finalEnts = await prisma.enterprise.findMany({
    where: { deletedAt: null },
    include: {
      channels: { select: { id: true, name: true, code: true } },
      users: { select: { id: true, username: true, email: true, role: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  for (const ent of finalEnts) {
    console.log(`\n🏢 ${ent.name}`)
    console.log(`   • Plan: ${ent.plan} | Billing Status: ${ent.billingStatus}`)
    console.log(`   • Slug: ${ent.slug}`)
    console.log(`   • ID: ${ent.id}`)
    console.log(`   • Branches (${ent.channels.length}): ${ent.channels.map(c => `${c.name} [${c.code}]`).join(', ')}`)
    console.log(`   • Users (${ent.users.length}): ${ent.users.map(u => `${u.username} (${u.role})`).join(', ')}`)
  }

  const globalAdmin = await prisma.user.findFirst({ where: { role: 'PLATFORM_OWNER' } })
  if (globalAdmin) {
    console.log(`\n👑 Platform Owner Global Account:`)
    console.log(`   • Username: ${globalAdmin.username}`)
    console.log(`   • Email: ${globalAdmin.email}`)
    console.log(`   • Role: ${globalAdmin.role}`)
  }

  await prisma.$disconnect()
}

cleanAndSetup().catch(err => {
  console.error('Error during curation:', err)
  process.exit(1)
})
