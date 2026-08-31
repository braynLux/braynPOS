/**
 * test_plan_tier_enforcement.cjs
 * Comprehensive verification script testing STARTER, PRO, and ENTERPRISE tier enforcement,
 * feature locking, branch/user quotas, and custom JSONB overrides on localhost.
 */
const { PrismaClient } = require('@prisma/client')
const argon2 = require('argon2')

const API_BASE = 'http://127.0.0.1:8081'
const prisma = new PrismaClient()

async function hashPass(password) {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 })
}

async function main() {
  console.log('🧪 Starting SaaS Plan & Feature Tier Verification Test Suite...\n')

  const now = Date.now()
  const starterSlug = `starter-test-${now}`
  const proSlug = `pro-test-${now}`
  const passHash = await hashPass('TestPass@123')

  // 1. Provision STARTER Enterprise
  const starterEnt = await prisma.enterprise.create({
    data: {
      name: 'Starter Bakery',
      slug: starterSlug,
      email: `${starterSlug}@test.com`,
      plan: 'STARTER',
      isActive: true,
    },
  })

  const starterHq = await prisma.channel.create({
    data: {
      name: 'Starter Main Shop',
      code: `ST-${now.toString().slice(-4)}`,
      type: 'RETAIL_SHOP',
      phone: '+254711111111',
      enterpriseId: starterEnt.id,
    },
  })

  const starterUser = await prisma.user.create({
    data: {
      username: `owner.${starterSlug}`,
      email: `owner@${starterSlug}.com`,
      passwordHash: passHash,
      role: 'SUPER_ADMIN',
      enterpriseId: starterEnt.id,
      channelId: starterHq.id,
      status: 'ACTIVE',
    },
  })

  // 2. Provision PRO Enterprise
  const proEnt = await prisma.enterprise.create({
    data: {
      name: 'Pro Supermarket',
      slug: proSlug,
      email: `${proSlug}@test.com`,
      plan: 'PRO',
      isActive: true,
    },
  })

  const proHq = await prisma.channel.create({
    data: {
      name: 'Pro Main Branch',
      code: `PR-${now.toString().slice(-4)}`,
      type: 'RETAIL_SHOP',
      phone: '+254722222222',
      enterpriseId: proEnt.id,
    },
  })

  const proUser = await prisma.user.create({
    data: {
      username: `owner.${proSlug}`,
      email: `owner@${proSlug}.com`,
      passwordHash: passHash,
      role: 'SUPER_ADMIN',
      enterpriseId: proEnt.id,
      channelId: proHq.id,
      status: 'ACTIVE',
    },
  })

  // Direct JWT token signing to prevent rate-limiter delays in test runner
  const jwt = require('jsonwebtoken')
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
      { expiresIn: '1h', issuer: 'brayn-api' }
    )
  }

  const entUser = await prisma.user.findFirst({ where: { username: 'superadmin.prototype' } })

  const starterToken = makeToken(starterUser)
  const proToken = makeToken(proUser)
  const entToken = makeToken(entUser)

  let passed = 0
  let failed = 0

  async function test(name, fn) {
    try {
      await fn()
      console.log(`  ✅ PASS: ${name}`)
      passed++
    } catch (err) {
      console.error(`  ❌ FAIL: ${name} — ${err.message}`)
      failed++
    }
  }

  console.log('--- TEST GROUP 1: STARTER TIER ENFORCEMENT ---')

  await test('STARTER: Can access basic items', async () => {
    const res = await fetch(`${API_BASE}/v1/items`, { headers: { Authorization: `Bearer ${starterToken}` } })
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`)
  })

  await test('STARTER: Invoicing is blocked (403 PLAN_FEATURE_LOCKED)', async () => {
    const res = await fetch(`${API_BASE}/v1/invoices`, { headers: { Authorization: `Bearer ${starterToken}` } })
    const data = await res.json()
    if (res.status !== 403 || data.error !== 'PLAN_FEATURE_LOCKED') {
      throw new Error(`Expected 403 PLAN_FEATURE_LOCKED, got ${res.status}: ${JSON.stringify(data)}`)
    }
  })

  await test('STARTER: Transfers is blocked (403 PLAN_FEATURE_LOCKED)', async () => {
    const res = await fetch(`${API_BASE}/v1/transfers`, { headers: { Authorization: `Bearer ${starterToken}` } })
    const data = await res.json()
    if (res.status !== 403 || data.error !== 'PLAN_FEATURE_LOCKED') {
      throw new Error(`Expected 403 PLAN_FEATURE_LOCKED, got ${res.status}: ${JSON.stringify(data)}`)
    }
  })

  await test('STARTER: Accounting is blocked (403 PLAN_FEATURE_LOCKED)', async () => {
    const res = await fetch(`${API_BASE}/v1/accounting/accounts`, { headers: { Authorization: `Bearer ${starterToken}` } })
    const data = await res.json()
    if (res.status !== 403 || data.error !== 'PLAN_FEATURE_LOCKED') {
      throw new Error(`Expected 403 PLAN_FEATURE_LOCKED, got ${res.status}: ${JSON.stringify(data)}`)
    }
  })

  await test('STARTER: Serials is blocked (403 PLAN_FEATURE_LOCKED)', async () => {
    const res = await fetch(`${API_BASE}/v1/serials?itemId=item1`, { headers: { Authorization: `Bearer ${starterToken}` } })
    const data = await res.json()
    if (res.status !== 403 || data.error !== 'PLAN_FEATURE_LOCKED') {
      throw new Error(`Expected 403 PLAN_FEATURE_LOCKED, got ${res.status}: ${JSON.stringify(data)}`)
    }
  })

  await test('STARTER: Creating 2nd channel is rejected by branch quota (403)', async () => {
    const res = await fetch(`${API_BASE}/v1/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${starterToken}` },
      body: JSON.stringify({
        name: 'Starter Branch 2',
        code: `ST2-${now.toString().slice(-3)}`,
        type: 'RETAIL_SHOP',
        phone: '+254711223344',
      }),
    })
    const data = await res.json()
    if (res.status !== 403) {
      throw new Error(`Expected 403, got ${res.status}: ${JSON.stringify(data)}`)
    }
  })

  console.log('\n--- TEST GROUP 2: PRO TIER ENFORCEMENT ---')

  await test('PRO: Invoicing is allowed (200 OK)', async () => {
    const res = await fetch(`${API_BASE}/v1/invoices`, { headers: { Authorization: `Bearer ${proToken}` } })
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`)
  })

  await test('PRO: Transfers is allowed (200 OK)', async () => {
    const res = await fetch(`${API_BASE}/v1/transfers`, { headers: { Authorization: `Bearer ${proToken}` } })
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`)
  })

  await test('PRO: Accounting Chart of Accounts is allowed (200 OK)', async () => {
    const res = await fetch(`${API_BASE}/v1/accounting/accounts`, { headers: { Authorization: `Bearer ${proToken}` } })
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`)
  })

  await test('PRO: Fixed Assets is blocked (403 PLAN_FEATURE_LOCKED - Enterprise only)', async () => {
    const res = await fetch(`${API_BASE}/v1/accounting/assets`, { headers: { Authorization: `Bearer ${proToken}` } })
    const data = await res.json()
    if (res.status !== 403 || data.error !== 'PLAN_FEATURE_LOCKED') {
      throw new Error(`Expected 403 PLAN_FEATURE_LOCKED, got ${res.status}: ${JSON.stringify(data)}`)
    }
  })

  await test('PRO: Payroll is blocked (403 PLAN_FEATURE_LOCKED - Enterprise only)', async () => {
    const res = await fetch(`${API_BASE}/v1/payroll/salary-runs`, {
      headers: { Authorization: `Bearer ${proToken}` },
    })
    const data = await res.json()
    if (res.status !== 403 || data.error !== 'PLAN_FEATURE_LOCKED') {
      throw new Error(`Expected 403 PLAN_FEATURE_LOCKED, got ${res.status}: ${JSON.stringify(data)}`)
    }
  })

  console.log('\n--- TEST GROUP 3: ENTERPRISE TIER (LUX Prototype) ---')

  await test('ENTERPRISE: Fixed Assets is allowed (200 OK)', async () => {
    const res = await fetch(`${API_BASE}/v1/accounting/assets`, { headers: { Authorization: `Bearer ${entToken}` } })
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`)
  })

  await test('ENTERPRISE: Payroll is allowed (200 OK)', async () => {
    const res = await fetch(`${API_BASE}/v1/payroll/salary-runs`, {
      headers: { Authorization: `Bearer ${entToken}` },
    })
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`)
  })

  console.log('\n--- TEST GROUP 4: CUSTOM JSONB ADD-ON OVERRIDES ---')

  await test('STARTER with {"invoicing": true} override can access Invoices without full upgrade', async () => {
    // Add invoicing add-on to STARTER enterprise
    await prisma.enterprise.update({
      where: { id: starterEnt.id },
      data:  { planFeatures: { invoicing: true } },
    })

    const res = await fetch(`${API_BASE}/v1/invoices`, { headers: { Authorization: `Bearer ${starterToken}` } })
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`)
  })

  console.log(`\n========================================`)
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`)
  console.log(`========================================\n`)

  await prisma.$disconnect()

  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('Test execution fatal error:', e)
  process.exit(1)
})
