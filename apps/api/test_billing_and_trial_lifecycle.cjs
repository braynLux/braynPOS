const http = require('http')
const { PrismaClient } = require('@prisma/client')
const jwt = require('jsonwebtoken')

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
    { expiresIn: '1h', issuer: 'brayn-api' }
  )
}

function request(path, options = {}, body = null) {
  return new Promise((resolve, reject) => {
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
        try {
          json = JSON.parse(data)
        } catch {
          json = data
        }
        resolve({ status: res.statusCode, data: json, headers: res.headers })
      })
    })

    req.on('error', reject)

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body))
    }
    req.end()
  })
}

async function run() {
  console.log('🚀 [TEST] Starting SaaS Subscriptions, Trial Lifecycle & Global Plan Matrix Verification...\n')

  let passed = 0
  let total = 0

  function assert(condition, desc, extra = '') {
    total++
    if (condition) {
      console.log(`  ✅ [${total}] ${desc}`)
      passed++
    } else {
      console.error(`  ❌ [${total}] ${desc} -- FAIL ${extra}`)
    }
  }

  try {
    // 1. Get Platform Owner token
    const adminUser = await prisma.user.findFirst({
      where: { role: 'PLATFORM_OWNER' },
    })
    if (!adminUser) {
      throw new Error('No PLATFORM_OWNER user found in DB')
    }
    const adminToken = makeToken(adminUser)
    assert(Boolean(adminToken), 'Platform Owner token generated', `User: ${adminUser.username}`)

    // 2. Generate One-Time Onboarding Invite for Test Client
    const inviteRes = await request('/enterprises/invites', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    }, {
      businessName: 'Zeta Stores Ltd',
      plan: 'PRO',
      expiresInDays: 7,
    })
    assert(inviteRes.status === 201 && inviteRes.data.code, 'Generate Onboarding Invite Code', JSON.stringify(inviteRes.data))
    const inviteCode = inviteRes.data.code

    // 3. Public Pre-flight Validate Invite
    const validateRes = await request(`/enterprises/invites/validate/${inviteCode}`)
    assert(validateRes.status === 200 && validateRes.data.valid, 'Validate invite code pre-flight', JSON.stringify(validateRes.data))

    // 4. Onboard Client with 14-Day Free Trial
    const testSlug = `zeta-${Date.now().toString().slice(-4)}`
    const onboardRes = await request('/enterprises/onboard', { method: 'POST' }, {
      inviteCode,
      name: 'Zeta Stores Ltd',
      slug: testSlug,
      email: `${testSlug}@example.com`,
      ownerUsername: `owner_${testSlug}`,
      ownerPassword: 'Password@12345!',
    })
    assert(onboardRes.status === 201 && onboardRes.data.enterprise?.id, 'Onboard client enterprise', JSON.stringify(onboardRes.data))
    const enterpriseId = onboardRes.data.enterprise.id

    // 5. Verify 14-day Free Trial is Initialized
    const billingProfile = await request(`/enterprises/${enterpriseId}/billing`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert(
      billingProfile.status === 200 &&
      billingProfile.data.billingStatus === 'TRIAL' &&
      billingProfile.data.trialEndsAt !== null,
      'Enterprise initialized in TRIAL status with trialEndsAt timestamp',
      JSON.stringify(billingProfile.data)
    )

    // 6. Extend Free Trial by 14 Days
    const extendRes = await request(`/enterprises/${enterpriseId}/extend-trial`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    }, { days: 14 })
    assert(extendRes.status === 200, 'Extend free trial by 14 days', JSON.stringify(extendRes.data))

    // 7. Record Subscription Payment
    const paymentRes = await request(`/enterprises/${enterpriseId}/payments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    }, {
      amount: 7500,
      currency: 'KES',
      paymentMethod: 'MPESA',
      reference: `MPESA-${Date.now().toString().slice(-6)}`,
      periodMonths: 1,
      notes: 'Initial monthly Pro subscription',
    })
    assert(
      paymentRes.status === 200 &&
      paymentRes.data.enterprise?.billingStatus === 'ACTIVE' &&
      paymentRes.data.enterprise?.currentPeriodEnd !== null,
      'Record payment, transition to ACTIVE subscription with periodEnd set',
      JSON.stringify(paymentRes.data)
    )

    // 8. Verify Payment History
    const historyRes = await request(`/enterprises/${enterpriseId}/billing`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert(
      historyRes.status === 200 &&
      historyRes.data.payments.length >= 1 &&
      historyRes.data.payments[0].paymentMethod === 'MPESA',
      'Verify enterprise billing history contains recorded payment receipt',
      JSON.stringify(historyRes.data)
    )

    // 9. Query Platform Billing Overview
    const overviewRes = await request('/enterprises/billing/overview', {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert(
      overviewRes.status === 200 &&
      overviewRes.data.kpis?.totalRevenueCollected >= 7500 &&
      overviewRes.data.kpis?.activeSubscriptions >= 1,
      'Query platform billing summary with aggregated revenue and active subscriptions',
      JSON.stringify(overviewRes.data.kpis)
    )

    // 10. Query Global Plan Matrix
    const matrixRes = await request('/plans/matrix')
    assert(
      matrixRes.status === 200 &&
      matrixRes.data.STARTER &&
      matrixRes.data.PRO &&
      matrixRes.data.ENTERPRISE,
      'Query global SaaS plan matrix definitions',
      Object.keys(matrixRes.data).join(', ')
    )

    // 11. Update Global Plan Definition (Platform Owner)
    const updateMatrixRes = await request('/plans/matrix/PRO', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
    }, {
      name: 'Professional Growth Suite',
      maxChannels: 6,
      maxUsers: 20,
      priceMonthly: 8000,
      priceAnnual: 80000,
      features: { aiPortal: true },
    })
    assert(
      updateMatrixRes.status === 200 &&
      updateMatrixRes.data.plan?.name === 'Professional Growth Suite' &&
      updateMatrixRes.data.plan?.maxChannels === 6,
      'Platform Owner successfully edits dynamic global Plan Matrix for PRO tier',
      JSON.stringify(updateMatrixRes.data)
    )

    // 12. Run Subscription Lifecycle Evaluator
    const evalRes = await request('/notifications/evaluate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    }, {})
    assert(evalRes.status === 200 && evalRes.data.evaluated >= 1, 'Trigger subscription lifecycle evaluator', JSON.stringify(evalRes.data))

    // 13. Query System Notifications
    const notifsRes = await request('/notifications', {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert(
      notifsRes.status === 200 && Array.isArray(notifsRes.data.notifications),
      'Fetch system notifications for Platform Owner',
      `Count: ${notifsRes.data.notifications?.length}`
    )

    // 14. Mark Notification as Read
    if (notifsRes.data.notifications.length > 0) {
      const firstNotifId = notifsRes.data.notifications[0].id
      const markReadRes = await request(`/notifications/${firstNotifId}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}` },
      }, {})
      assert(markReadRes.status === 200 && markReadRes.data.notification?.isRead === true, 'Mark system notification as read', JSON.stringify(markReadRes.data))
    }

    console.log(`\n======================================================`)
    console.log(`🎉 TEST SUMMARY: ${passed}/${total} Passed!`)
    console.log(`======================================================\n`)

    if (passed === total) {
      process.exit(0)
    } else {
      process.exit(1)
    }
  } catch (err) {
    console.error('Fatal test error:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

run()
