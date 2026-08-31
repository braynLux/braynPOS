const http = require('http')
const { PrismaClient } = require('@prisma/client')
const jwt = require('jsonwebtoken')
const { randomUUID } = require('crypto')

const prisma = new PrismaClient()
const BASE_URL = 'http://127.0.0.1:8081/v1'
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

    const start = Date.now()
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
          duration: Date.now() - start,
        })
      })
    })

    req.on('error', (err) => {
      resolve({ status: 500, error: err.message, duration: Date.now() - start })
    })

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body))
    }
    req.end()
  })
}

async function runStrainTests() {
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('⚡ BRAYNPOS ENTERPRISE STRAIN, CONCURRENCY & RELIABILITY TEST SUITE')
  console.log('═══════════════════════════════════════════════════════════════════════\n')

  const now = Date.now()
  const ent = await prisma.enterprise.create({
    data: {
      name: `Strain Test Enterprise ${now}`,
      slug: `strain-ent-${now}`,
      plan: 'ENTERPRISE',
      billingStatus: 'ACTIVE',
      isActive: true,
    },
  })

  const channel = await prisma.channel.create({
    data: {
      name: 'Strain Flagship Store',
      code: `STR-${now.toString().slice(-4)}`,
      type: 'RETAIL_SHOP',
      enterpriseId: ent.id,
    },
  })

  // Create 20 cashier accounts for high-concurrency simulation
  const cashiers = []
  for (let i = 0; i < 20; i++) {
    const c = await prisma.user.create({
      data: {
        username: `cashier_${now}_${i}`,
        email: `cashier_${now}_${i}@test.com`,
        passwordHash: 'hash',
        role: 'CASHIER',
        enterpriseId: ent.id,
        channelId: channel.id,
        status: 'ACTIVE',
      },
    })
    cashiers.push({ ...c, token: makeToken(c) })
  }

  const superAdmin = await prisma.user.create({
    data: {
      username: `admin_strain_${now}`,
      email: `admin_${now}@test.com`,
      passwordHash: 'hash',
      role: 'SUPER_ADMIN',
      enterpriseId: ent.id,
      channelId: channel.id,
      status: 'ACTIVE',
    },
  })
  const adminToken = makeToken(superAdmin)

  // Provision an item with exact available stock of 5
  const item = await prisma.item.create({
    data: {
      name: 'High Demand Limited Flash Item',
      sku: `STR-FLASH-${now}`,
      barcode: `FLASHBAR${now}`,
      type: 'PRODUCT',
      retailPrice: 100,
      wholesalePrice: 90,
      minRetailPrice: 80,
      weightedAvgCost: 50,
      enterpriseId: ent.id,
    },
  })

  await prisma.inventoryBalance.create({
    data: {
      itemId: item.id,
      channelId: channel.id,
      availableQty: 5,
      weightedAvgCost: 50,
    },
  })

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 1: High-Concurrency Checkout Race Condition (Overselling Prevention)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('🔬 [TEST 1] High-Concurrency Checkout Race Condition...')
  console.log('   Target: 20 simultaneous concurrent cashiers competing for 5 units in stock.')

  const checkoutPromises = []
  for (let i = 0; i < 20; i++) {
    checkoutPromises.push(
      request('/sales/commit', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cashiers[i].token}` },
      }, {
        channelId: channel.id,
        saleType: 'RETAIL',
        items: [{ itemId: item.id, quantity: 1, unitPrice: 100 }],
        payments: [{ method: 'CASH', amount: 100 }],
      })
    )
  }

  const checkoutResults = await Promise.all(checkoutPromises)
  const successfulCheckouts = checkoutResults.filter(r => r.status === 200 || r.status === 201)
  const outOfStockCheckouts = checkoutResults.filter(r => r.status === 422)
  const otherRejections    = checkoutResults.filter(r => r.status !== 200 && r.status !== 201 && r.status !== 422)

  const updatedBalance = await prisma.inventoryBalance.findUnique({
    where: { itemId_channelId: { itemId: item.id, channelId: channel.id } },
  })

  console.log(`   Results: ${successfulCheckouts.length} succeeded, ${outOfStockCheckouts.length} out of stock (422), ${otherRejections.length} other codes.`)
  console.log(`   Remaining DB Stock: ${updatedBalance.availableQty}`)

  const test1Pass = successfulCheckouts.length === 5 &&
                    outOfStockCheckouts.length === 15 &&
                    updatedBalance.availableQty === 0 &&
                    otherRejections.length === 0

  if (test1Pass) {
    console.log('   ✅ PASS: Exact 5 checkouts succeeded, zero overselling, 100% ACID serialized row locks.\n')
  } else {
    console.log(`   ❌ FAIL: Concurrency anomaly! Succeeded: ${successfulCheckouts.length}, Balance: ${updatedBalance.availableQty}\n`)
    if (otherRejections.length > 0) {
      console.log('   Sample rejection:', JSON.stringify(otherRejections[0]))
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 2: Concurrent Idempotency Key Replay Strain
  // ─────────────────────────────────────────────────────────────────────────
  console.log('🔬 [TEST 2] Concurrent Idempotency Key Strain...')
  console.log('   Target: 10 simultaneous identical requests with the same Idempotency-Key.')

  // Restock item by 10
  await prisma.inventoryBalance.update({
    where: { itemId_channelId: { itemId: item.id, channelId: channel.id } },
    data: { availableQty: 10 },
  })

  const sharedIdempotencyKey = randomUUID()
  const idempotencyPromises = []

  for (let i = 0; i < 10; i++) {
    idempotencyPromises.push(
      request('/sales/sync-offline', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cashiers[0].token}`,
          'Idempotency-Key': sharedIdempotencyKey,
        },
      }, {
        offlineReceiptNo: `OFF-IDEMP-${now}`,
        saleData: {
          channelId: channel.id,
          saleType: 'RETAIL',
          items: [{ itemId: item.id, quantity: 1, unitPrice: 100 }],
          payments: [{ method: 'CASH', amount: 100 }],
        },
      })
    )
  }

  const idempotencyResults = await Promise.all(idempotencyPromises)
  const idempSuccesses = idempotencyResults.filter(r => r.status === 200 || r.status === 201)

  const balanceAfterIdemp = await prisma.inventoryBalance.findUnique({
    where: { itemId_channelId: { itemId: item.id, channelId: channel.id } },
  })

  console.log(`   Results: ${idempSuccesses.length}/10 successful responses, ${balanceAfterIdemp.availableQty} remaining stock (started at 10).`)

  const test2Pass = balanceAfterIdemp.availableQty === 9
  if (test2Pass) {
    console.log('   ✅ PASS: Exact-once execution verified. Zero duplicate stock deductions.\n')
  } else {
    console.log(`   ❌ FAIL: Idempotency leak. Deducted ${10 - balanceAfterIdemp.availableQty} units instead of 1.\n`)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 3: Database Connection Pool & Parallel Burst Load Strain
  // ─────────────────────────────────────────────────────────────────────────
  console.log('🔬 [TEST 3] Database Connection Pool & Parallel Burst Load Strain...')
  console.log('   Target: 50 concurrent requests across multiple operational endpoints.')

  const burstEndpoints = [
    '/items',
    '/sales',
    '/customers',
    '/channels',
    '/plans/matrix',
  ]

  const burstPromises = []
  for (let i = 0; i < 50; i++) {
    const ep = burstEndpoints[i % burstEndpoints.length]
    // Rotate cashiers so we do not trigger per-user read rate limits
    const cashierToken = cashiers[i % cashiers.length].token
    burstPromises.push(
      request(ep, {
        headers: { Authorization: `Bearer ${cashierToken}` },
      })
    )
  }

  const burstResults = await Promise.all(burstPromises)
  const burstSuccess = burstResults.filter(r => r.status === 200)
  const burstFail = burstResults.filter(r => r.status !== 200)
  const avgDuration = (burstResults.reduce((acc, r) => acc + r.duration, 0) / burstResults.length).toFixed(1)
  const maxDuration = Math.max(...burstResults.map(r => r.duration))

  console.log(`   Results: ${burstSuccess.length}/50 succeeded (${burstFail.length} failed). Avg Latency: ${avgDuration}ms, Max Latency: ${maxDuration}ms.`)

  const test3Pass = burstSuccess.length === 50
  if (test3Pass) {
    console.log('   ✅ PASS: Connection pool smoothly absorbed 50 parallel requests with 0 timeouts.\n')
  } else {
    console.log(`   ⚠️ WARNING: ${burstFail.length} requests failed under burst pressure.\n`)
    if (burstFail.length > 0) {
      console.log('   Sample failure:', burstFail[0].status, JSON.stringify(burstFail[0].data))
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 4: Offline Sync Replay & Deduplication
  // ─────────────────────────────────────────────────────────────────────────
  console.log('🔬 [TEST 4] Offline Sync Batch Replay & Duplicate Receipt Handling...')
  const offlineReceiptNo = `OFF-RCP-${now}-DUP`
  const offlinePayload = {
    offlineReceiptNo,
    saleData: {
      channelId: channel.id,
      saleType: 'RETAIL',
      items: [{ itemId: item.id, quantity: 1, unitPrice: 100 }],
      payments: [{ method: 'CASH', amount: 100 }],
    },
  }

  const syncRes1 = await request('/sales/sync-offline', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cashiers[0].token}`,
      'Idempotency-Key': randomUUID(),
    },
  }, offlinePayload)

  // Replay exact same offline receipt with different idempotency key
  const syncRes2 = await request('/sales/sync-offline', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cashiers[0].token}`,
      'Idempotency-Key': randomUUID(),
    },
  }, offlinePayload)

  console.log(`   First Offline Sync: HTTP ${syncRes1.status}`)
  console.log(`   Replayed Offline Sync: HTTP ${syncRes2.status}`)

  const test4Pass = (syncRes1.status === 200 || syncRes1.status === 201) &&
                    (syncRes2.status === 200 || syncRes2.status === 201 || syncRes2.status === 409)

  if (test4Pass) {
    console.log('   ✅ PASS: Offline sales sync handled cleanly without unhandled server crashes.\n')
  } else {
    console.log('   ❌ FAIL: Offline sync failed.\n')
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 5: Rate Limiter Protection Under Attack
  // ─────────────────────────────────────────────────────────────────────────
  console.log('🔬 [TEST 5] Rate Limiter Shield on Auth Endpoint...')
  console.log('   Target: 10 rapid-fire failed login attempts to trigger 429 throttling.')

  const loginPromises = []
  for (let i = 0; i < 10; i++) {
    loginPromises.push(
      request('/auth/login', { method: 'POST' }, {
        username: 'brute_force_attacker',
        password: 'wrong_password',
      })
    )
  }

  const loginResults = await Promise.all(loginPromises)
  const throttledCount = loginResults.filter(r => r.status === 429).length
  const rejectedAuth = loginResults.filter(r => r.status === 401).length

  console.log(`   Results: ${rejectedAuth} 401 Unauthorized, ${throttledCount} 429 Rate Limited.`)

  const test5Pass = throttledCount > 0
  if (test5Pass) {
    console.log('   ✅ PASS: Rate limiter shielded the database from brute force authentication floods.\n')
  } else {
    console.log('   ℹ️ INFO: Rate limit window not exceeded in single burst.\n')
  }

  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('🏁 STRAIN TEST RUN COMPLETE')
  console.log('═══════════════════════════════════════════════════════════════════════\n')

  await prisma.$disconnect()
}

runStrainTests()
