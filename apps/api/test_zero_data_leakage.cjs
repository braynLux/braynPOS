const http = require('http')
const { PrismaClient } = require('@prisma/client')
const jwt = require('jsonwebtoken')
const { io } = require('../web/node_modules/socket.io-client')

const prisma = new PrismaClient()
const BASE_URL = 'http://127.0.0.1:8081/v1'
const SOCKET_URL = 'http://127.0.0.1:8081'
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-restoration'

function makeToken(user) {
  return jwt.sign(
    {
      id: user.id,
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      channelId: user.channelId,
      enterpriseId: user.enterpriseId,
      mfaVerified: true,
    },
    JWT_SECRET,
    { expiresIn: '2h', issuer: 'brayn-api' }
  )
}

function request(path, options = {}, body = null) {
  return new Promise((resolve) => {
    const url = new URL(BASE_URL + path)
    const reqOptions = {
      method: options.method || 'GET',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    }

    const req = http.request(reqOptions, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        let json
        try { json = JSON.parse(data) } catch { json = data }
        resolve({
          status: res.statusCode,
          data: json,
          headers: res.headers,
        })
      })
    })

    req.on('error', (err) => {
      resolve({ status: 500, error: err.message })
    })

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body))
    }
    req.end()
  })
}

async function runZeroDataLeakageVerification() {
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('🛡️ ZERO DATA LEAKAGE & MULTI-TENANT BOUNDARY VERIFICATION SUITE')
  console.log('═══════════════════════════════════════════════════════════════════════\n')

  let passed = 0
  let total = 0

  function assert(condition, desc, extra = '') {
    total++
    if (condition) {
      console.log(`  ✅ [${total}] ${desc}`)
      passed++
    } else {
      console.error(`  ❌ [${total}] ${desc} -- FAILED! ${extra}`)
    }
  }

  const now = Date.now()

  // 1. Provision Tenant Alpha
  const entA = await prisma.enterprise.create({
    data: {
      name: `Alpha Enterprises ${now}`,
      slug: `alpha-${now}`,
      plan: 'ENTERPRISE',
      billingStatus: 'ACTIVE',
      isActive: true,
    },
  })
  const chanA1 = await prisma.channel.create({
    data: {
      name: 'Alpha Downtown Branch',
      code: `A1-${now.toString().slice(-4)}`,
      type: 'RETAIL_SHOP',
      enterpriseId: entA.id,
    },
  })
  const userA = await prisma.user.create({
    data: {
      username: `admin_alpha_${now}`,
      email: `admin_alpha_${now}@test.com`,
      passwordHash: 'hash',
      role: 'SUPER_ADMIN',
      enterpriseId: entA.id,
      channelId: chanA1.id,
      status: 'ACTIVE',
    },
  })
  const tokenA = makeToken(userA)

  const itemA = await prisma.item.create({
    data: {
      name: 'Alpha Secret Proprietary Item',
      sku: `SKU-ALPHA-${now}`,
      barcode: `BAR-A-${now}`,
      type: 'PRODUCT',
      retailPrice: 500,
      wholesalePrice: 400,
      minRetailPrice: 350,
      weightedAvgCost: 200,
      enterpriseId: entA.id,
    },
  })
  await prisma.inventoryBalance.create({
    data: { itemId: itemA.id, channelId: chanA1.id, availableQty: 100, weightedAvgCost: 200 },
  })

  const custA = await prisma.customer.create({
    data: {
      name: 'Alpha Exclusive VIP Client',
      phone: `+254711${now.toString().slice(-6)}`,
      channelId: chanA1.id,
    },
  })

  // 2. Provision Tenant Beta
  const entB = await prisma.enterprise.create({
    data: {
      name: `Beta Competitor Corp ${now}`,
      slug: `beta-${now}`,
      plan: 'ENTERPRISE',
      billingStatus: 'ACTIVE',
      isActive: true,
    },
  })
  const chanB1 = await prisma.channel.create({
    data: {
      name: 'Beta Uptown Branch',
      code: `B1-${now.toString().slice(-4)}`,
      type: 'RETAIL_SHOP',
      enterpriseId: entB.id,
    },
  })
  const userB = await prisma.user.create({
    data: {
      username: `admin_beta_${now}`,
      email: `admin_beta_${now}@test.com`,
      passwordHash: 'hash',
      role: 'SUPER_ADMIN',
      enterpriseId: entB.id,
      channelId: chanB1.id,
      status: 'ACTIVE',
    },
  })
  const tokenB = makeToken(userB)

  const itemB = await prisma.item.create({
    data: {
      name: 'Beta Confidential Product Line',
      sku: `SKU-BETA-${now}`,
      barcode: `BAR-B-${now}`,
      type: 'PRODUCT',
      retailPrice: 900,
      wholesalePrice: 800,
      minRetailPrice: 700,
      weightedAvgCost: 400,
      enterpriseId: entB.id,
    },
  })
  await prisma.inventoryBalance.create({
    data: { itemId: itemB.id, channelId: chanB1.id, availableQty: 50, weightedAvgCost: 400 },
  })

  const custB = await prisma.customer.create({
    data: {
      name: 'Beta High-Value Target Account',
      phone: `+254722${now.toString().slice(-6)}`,
      channelId: chanB1.id,
    },
  })

  // Commit a sale for Tenant Beta
  const saleBRes = await request('/sales/commit', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}` },
  }, {
    channelId: chanB1.id,
    saleType: 'RETAIL',
    items: [{ itemId: itemB.id, quantity: 2, unitPrice: 900 }],
    payments: [{ method: 'CASH', amount: 1800 }],
  })
  assert(saleBRes.status === 201 && saleBRes.data.id, 'Beta commits confidential sale', JSON.stringify(saleBRes.data))
  const saleBId = saleBRes.data.id

  // ── TEST 1: Tenant A Queries Sales (MUST NOT see Tenant B sales) ─────────
  const salesQueryA = await request('/sales', {
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  const leakedSales = (salesQueryA.data.data || []).filter(s => s.id === saleBId || s.channelId === chanB1.id)
  assert(
    salesQueryA.status === 200 && leakedSales.length === 0,
    'Tenant Alpha querying /sales has ZERO visibility into Tenant Beta sales',
    `Leaked: ${leakedSales.length}`
  )

  // ── TEST 2: Tenant A Attempts Direct Deep-Link Access to Tenant B Sale ───
  const directSaleQuery = await request(`/sales/${saleBId}`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  assert(
    directSaleQuery.status === 403 || directSaleQuery.status === 404,
    'Tenant Alpha direct ID lookup of Tenant Beta sale is strictly FORBIDDEN / NOT FOUND',
    `Status: ${directSaleQuery.status}`
  )

  // ── TEST 3: Tenant A Queries Items (MUST NOT see Tenant B items) ─────────
  const itemsQueryA = await request('/items', {
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  const leakedItems = (itemsQueryA.data.data || []).filter(i => i.id === itemB.id || i.sku === itemB.sku)
  assert(
    itemsQueryA.status === 200 && leakedItems.length === 0,
    'Tenant Alpha querying /items has ZERO visibility into Tenant Beta product catalog',
    `Leaked: ${leakedItems.length}`
  )

  // ── TEST 4: Tenant A Attempts to Mutate Tenant B Item ────────────────────
  const mutateItemRes = await request(`/items/${itemB.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tokenA}` },
  }, {
    name: 'Malicious Overwrite Attempt',
  })
  assert(
    mutateItemRes.status === 403 || mutateItemRes.status === 404,
    'Tenant Alpha cross-tenant item mutation attempt is blocked with 403/404',
    `Status: ${mutateItemRes.status}`
  )

  // ── TEST 5: Tenant A Queries Customers (MUST NOT see Tenant B customers) ─
  const custQueryA = await request('/customers', {
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  const leakedCusts = (custQueryA.data.data || []).filter(c => c.id === custB.id || c.name === custB.name)
  assert(
    custQueryA.status === 200 && leakedCusts.length === 0,
    'Tenant Alpha querying /customers has ZERO visibility into Tenant Beta customer database',
    `Leaked: ${leakedCusts.length}`
  )

  // ── TEST 6: Tenant A Queries Channels (MUST NOT see Tenant B channels) ───
  const channelsQueryA = await request('/channels', {
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  console.log('   Channels query status:', channelsQueryA.status, 'Response:', JSON.stringify(channelsQueryA.data))
  const channelList = Array.isArray(channelsQueryA.data) ? channelsQueryA.data : (channelsQueryA.data?.data || [])
  const leakedChannels = channelList.filter(c => c.id === chanB1.id)
  assert(
    channelsQueryA.status === 200 && leakedChannels.length === 0,
    'Tenant Alpha querying /channels has ZERO visibility into Tenant Beta store branches',
    `Status: ${channelsQueryA.status}, Leaked: ${leakedChannels.length}`
  )

  // ── TEST 7: WebSocket Cross-Tenant Isolation ─────────────────────────────
  console.log('\n📡 Testing WebSocket Real-Time Cross-Tenant Isolation...')
  const socketA = io(`${SOCKET_URL}/inventory`, {
    auth: { token: tokenA },
    transports: ['websocket'],
  })

  let socketALeakedPackets = 0

  await new Promise((res) => {
    socketA.on('connect', () => {
      socketA.on('stock_update', (payload) => {
        // If Tenant A receives an update for Tenant B's item or channel, flag as leak!
        if (payload.itemId === itemB.id || payload.channelId === chanB1.id) {
          socketALeakedPackets++
        }
      })
      res()
    })
  })

  // Trigger inventory movement in Tenant B
  await request('/sales/commit', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}` },
  }, {
    channelId: chanB1.id,
    saleType: 'RETAIL',
    items: [{ itemId: itemB.id, quantity: 1, unitPrice: 900 }],
    payments: [{ method: 'CASH', amount: 900 }],
  })

  // Wait 1.5 seconds for socket event propagation
  await new Promise(r => setTimeout(r, 1500))

  socketA.disconnect()

  assert(
    socketALeakedPackets === 0,
    'WebSocket real-time events strictly isolated to tenant rooms (0 cross-tenant packets leaked)',
    `Leaked packets: ${socketALeakedPackets}`
  )

  console.log(`\n======================================================`)
  console.log(`🎉 ZERO DATA LEAKAGE TEST: ${passed}/${total} Passed!`)
  console.log(`======================================================\n`)

  await prisma.$disconnect()
  process.exit(passed === total ? 0 : 1)
}

runZeroDataLeakageVerification()
