import { basePrisma as prisma } from '../../lib/prisma.js'
import { hashPassword } from '../../lib/password.js'
import { signAccessToken, signRefreshToken, REFRESH_TOKEN_TTL_MS } from '../../lib/jwt.js'
import { randomBytes } from 'crypto'
import type { OnboardEnterpriseInput, UpdateEnterpriseInput, CreateInviteInput, UpdatePlanInput } from './enterprises.schema.js'

export class EnterpriseService {
  /**
   * Validate a one-time onboarding invite code (Public check before onboarding form).
   */
  static async validateInvite(code: string) {
    const cleanCode = code.trim().toUpperCase()
    const invite = await prisma.enterpriseInvite.findUnique({
      where: { code: cleanCode },
    })

    if (!invite) {
      throw { statusCode: 404, message: 'Invalid onboarding invite code.' }
    }

    if (invite.isUsed) {
      throw { statusCode: 410, message: 'This onboarding invite code has already been redeemed.' }
    }

    if (invite.expiresAt < new Date()) {
      throw { statusCode: 410, message: 'This onboarding invite code has expired. Please request a new invite.' }
    }

    return {
      valid:        true,
      code:         invite.code,
      businessName: invite.businessName,
      plan:         invite.plan,
      expiresAt:    invite.expiresAt,
    }
  }

  /**
   * Create a new one-time onboarding invite code (Platform Owner only).
   */
  static async createInvite(input: CreateInviteInput, creatorId: string) {
    // Generate human-friendly code e.g. INV-7A9B-4C2D
    const randomHex = randomBytes(4).toString('hex').toUpperCase()
    const code = `INV-${randomHex.slice(0, 4)}-${randomHex.slice(4, 8)}`

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + (input.expiresInDays || 7))

    const invite = await prisma.enterpriseInvite.create({
      data: {
        code,
        businessName: input.businessName?.trim() || null,
        plan:         input.plan || 'STARTER',
        createdBy:    creatorId,
        expiresAt,
      },
    })

    return invite
  }

  /**
   * List all onboarding invite codes with redemption details (Platform Owner only).
   */
  static async listInvites() {
    return prisma.enterpriseInvite.findMany({
      include: {
        enterprise: {
          select: {
            id:   true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  /**
   * Revoke an unused onboarding invite (Platform Owner only).
   */
  static async revokeInvite(id: string) {
    const invite = await prisma.enterpriseInvite.findUnique({ where: { id } })
    if (!invite) {
      throw { statusCode: 404, message: 'Invite code not found' }
    }
    if (invite.isUsed) {
      throw { statusCode: 400, message: 'Cannot revoke an already redeemed invite code.' }
    }

    await prisma.enterpriseInvite.delete({ where: { id } })
    return { message: 'Invite code revoked successfully' }
  }

  /**
   * Onboard a new enterprise tenant using a valid one-time invite code.
   * Creates the Enterprise, a default HQ Channel, and the primary Owner User (role: MANAGER_ADMIN)
   * in a single atomic transaction.
   */
  static async onboard(input: OnboardEnterpriseInput) {
    const cleanInviteCode = input.inviteCode.trim().toUpperCase()
    const slug = input.slug.toLowerCase().trim()
    const ownerEmail = (input.ownerEmail || input.email).toLowerCase().trim()

    // 1. Check invite code validity
    const invite = await prisma.enterpriseInvite.findUnique({
      where: { code: cleanInviteCode },
    })

    if (!invite) {
      throw { statusCode: 403, message: 'Invalid or missing onboarding invitation code.' }
    }
    if (invite.isUsed) {
      throw { statusCode: 410, message: 'This onboarding invitation code has already been used.' }
    }
    if (invite.expiresAt < new Date()) {
      throw { statusCode: 410, message: 'This onboarding invitation code has expired.' }
    }

    // 2. Check uniqueness
    const existingEnterprise = await prisma.enterprise.findUnique({
      where: { slug },
    })
    if (existingEnterprise) {
      throw { statusCode: 409, message: 'Enterprise slug already taken. Please choose another one.' }
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username: input.ownerUsername.trim() },
          { email: ownerEmail },
        ],
      },
    })
    if (existingUser) {
      throw { statusCode: 409, message: 'Username or email already exists.' }
    }

    const passwordHash = await hashPassword(input.ownerPassword)

    // 3. Atomic Provisioning & Invite Redemption
    const result = await prisma.$transaction(async (tx) => {
      const trialEndsAt = new Date()
      trialEndsAt.setDate(trialEndsAt.getDate() + 14)

      const enterprise = await tx.enterprise.create({
        data: {
          name:          input.name.trim(),
          slug,
          email:         input.email.toLowerCase().trim(),
          phone:         input.phone,
          plan:          invite.plan || 'STARTER',
          billingStatus: 'TRIAL',
          trialEndsAt,
        },
      })

      // Generate a unique channel code for this enterprise
      const channelCode = `HQ-${slug.slice(0, 6).toUpperCase()}`
      const channel = await tx.channel.create({
        data: {
          enterpriseId:    enterprise.id,
          name:            'Headquarters',
          code:            channelCode,
          type:            'WAREHOUSE',
          isMainWarehouse: true,
        },
      })

      // Primary business owner is MANAGER_ADMIN
      const owner = await tx.user.create({
        data: {
          enterpriseId: enterprise.id,
          channelId:    channel.id,
          username:     input.ownerUsername.trim(),
          email:        ownerEmail,
          passwordHash,
          role:         'MANAGER_ADMIN',
          status:       'ACTIVE',
        },
      })

      // Automatically provision default Super Admin account for Platform Owner direct access
      const defaultSuperAdminPassword = process.env.DEFAULT_SUPERADMIN_PASSWORD || 'Admin@Brayn2026!'
      const superAdminPasswordHash = await hashPassword(defaultSuperAdminPassword)
      await tx.user.create({
        data: {
          enterpriseId: enterprise.id,
          channelId:    channel.id,
          username:     `superadmin.${slug}`,
          email:        `superadmin@${slug}.brayn.app`,
          passwordHash: superAdminPasswordHash,
          role:         'SUPER_ADMIN',
          status:       'ACTIVE',
        },
      })

      // Mark invite as used
      await tx.enterpriseInvite.update({
        where: { id: invite.id },
        data: {
          isUsed:       true,
          usedAt:       new Date(),
          enterpriseId: enterprise.id,
        },
      })

      // Generate tokens
      const accessToken = signAccessToken({
        sub:          owner.id,
        username:     owner.username,
        email:        owner.email,
        role:         owner.role,
        channelId:    channel.id,
        enterpriseId: enterprise.id,
        mfaVerified:  true,
      })

      const refreshToken = signRefreshToken(owner.id)

      await tx.refreshToken.create({
        data: {
          token:     refreshToken,
          userId:    owner.id,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        },
      })

      return {
        enterprise,
        channel,
        user: {
          id:           owner.id,
          username:     owner.username,
          email:        owner.email,
          role:         owner.role,
          enterpriseId: enterprise.id,
          channelId:    channel.id,
        },
        accessToken,
        refreshToken,
      }
    })

    return result
  }

  /**
   * List all enterprises (Platform Owner only).
   */
  static async findAll() {
    return prisma.enterprise.findMany({
      where: { deletedAt: null },
      include: {
        _count: {
          select: {
            channels: true,
            users:    true,
            items:    true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  /**
   * Get enterprise by ID with channel details.
   */
  static async findById(id: string) {
    const enterprise = await prisma.enterprise.findUnique({
      where: { id },
      include: {
        channels: {
          where: { deletedAt: null },
          select: {
            id:              true,
            name:            true,
            code:            true,
            type:            true,
            isMainWarehouse: true,
            createdAt:       true,
          },
        },
        _count: {
          select: {
            users: true,
            items: true,
          },
        },
      },
    })

    if (!enterprise || enterprise.deletedAt) {
      throw { statusCode: 404, message: 'Enterprise not found' }
    }

    return enterprise
  }

  /**
   * Update enterprise metadata/settings.
   */
  static async update(id: string, input: UpdateEnterpriseInput) {
    return prisma.enterprise.update({
      where: { id },
      data:  input,
    })
  }

  /**
   * Soft-delete an enterprise and deactivate all its users.
   */
  static async softDelete(id: string) {
    await prisma.$transaction([
      prisma.enterprise.update({
        where: { id },
        data:  { deletedAt: new Date(), isActive: false },
      }),
      prisma.user.updateMany({
        where: { enterpriseId: id },
        data:  { status: 'INACTIVE', deletedAt: new Date() },
      }),
    ])

    return { message: 'Enterprise deactivated successfully' }
  }

  /**
   * Switch into an enterprise workspace (Platform Owner / Super Admin Impersonation).
   * Generates a scoped session token for the target enterprise and its default channel.
   */
  static async switchWorkspace(enterpriseId: string, actor: any) {
    const enterprise = await prisma.enterprise.findUnique({
      where: { id: enterpriseId },
      include: {
        channels: {
          where: { deletedAt: null },
          orderBy: { isMainWarehouse: 'desc' },
          take: 1,
        },
      },
    })

    if (!enterprise || enterprise.deletedAt) {
      throw { statusCode: 404, message: 'Enterprise not found or deleted' }
    }

    if (!enterprise.isActive) {
      throw { statusCode: 403, message: 'Cannot enter a suspended enterprise workspace.' }
    }

    const defaultChannel = enterprise.channels[0]
    if (!defaultChannel) {
      throw { statusCode: 404, message: 'Enterprise has no active channels or warehouses' }
    }

    // Generate tokens scoped to this enterprise and default channel
    const accessToken = signAccessToken({
      sub:          actor.sub,
      username:     actor.username,
      email:        actor.email,
      role:         actor.role,
      channelId:    defaultChannel.id,
      enterpriseId: enterprise.id,
      mfaVerified:  true,
    })

    const refreshToken = signRefreshToken(actor.sub)

    return {
      enterprise: {
        id:   enterprise.id,
        name: enterprise.name,
        slug: enterprise.slug,
        plan: enterprise.plan,
      },
      channel: {
        id:              defaultChannel.id,
        name:            defaultChannel.name,
        code:            defaultChannel.code,
        type:            defaultChannel.type,
        isMainWarehouse: defaultChannel.isMainWarehouse,
      },
      accessToken,
      refreshToken,
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PLATFORM OWNER — FLEET MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Suspend an enterprise — sets isActive = false and deactivates all users.
   * Data is preserved; users are blocked from login.
   */
  static async suspendEnterprise(id: string) {
    const enterprise = await prisma.enterprise.findUnique({ where: { id } })
    if (!enterprise || enterprise.deletedAt) {
      throw { statusCode: 404, message: 'Enterprise not found' }
    }
    if (!enterprise.isActive) {
      throw { statusCode: 400, message: 'Enterprise is already suspended' }
    }

    await prisma.$transaction([
      prisma.enterprise.update({
        where: { id },
        data:  { isActive: false },
      }),
      prisma.user.updateMany({
        where: { enterpriseId: id, status: 'ACTIVE' },
        data:  { status: 'INACTIVE' },
      }),
    ])

    return { message: `${enterprise.name} has been suspended. All users are now blocked.` }
  }

  /**
   * Reactivate a suspended enterprise — sets isActive = true and reactivates all users.
   */
  static async reactivateEnterprise(id: string) {
    const enterprise = await prisma.enterprise.findUnique({ where: { id } })
    if (!enterprise || enterprise.deletedAt) {
      throw { statusCode: 404, message: 'Enterprise not found' }
    }
    if (enterprise.isActive) {
      throw { statusCode: 400, message: 'Enterprise is already active' }
    }

    await prisma.$transaction([
      prisma.enterprise.update({
        where: { id },
        data:  { isActive: true },
      }),
      prisma.user.updateMany({
        where: { enterpriseId: id, status: 'INACTIVE', deletedAt: null },
        data:  { status: 'ACTIVE' },
      }),
    ])

    return { message: `${enterprise.name} has been reactivated. All users restored.` }
  }

  /**
   * Update an enterprise's subscription plan.
   */
  static async updatePlan(id: string, input: UpdatePlanInput) {
    const enterprise = await prisma.enterprise.findUnique({ where: { id } })
    if (!enterprise || enterprise.deletedAt) {
      throw { statusCode: 404, message: 'Enterprise not found' }
    }

    const updated = await prisma.enterprise.update({
      where: { id },
      data:  {
        plan: input.plan,
        ...(input.planFeatures !== undefined ? { planFeatures: input.planFeatures } : {}),
      },
    })

    return {
      message:      `Plan updated to ${input.plan}`,
      previous:     enterprise.plan,
      current:      updated.plan,
      planFeatures: updated.planFeatures,
    }
  }

  /**
   * Get fleet-wide statistics across all enterprises.
   */
  static async getFleetStats() {
    const [enterprises, channelCount, userCount, recentOnboards] = await Promise.all([
      prisma.enterprise.findMany({
        where: { deletedAt: null },
        select: {
          id: true, name: true, slug: true, plan: true, isActive: true, createdAt: true,
          _count: { select: { channels: true, users: true, items: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.channel.count({ where: { enterpriseId: { not: null }, deletedAt: null } }),
      prisma.user.count({ where: { enterpriseId: { not: null }, deletedAt: null } }),
      prisma.enterprise.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, slug: true, plan: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ])

    const totalEnterprises = enterprises.length
    const activeCount      = enterprises.filter(e => e.isActive).length
    const suspendedCount   = totalEnterprises - activeCount

    const planDistribution = enterprises.reduce((acc, e) => {
      acc[e.plan] = (acc[e.plan] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    return {
      totalEnterprises,
      activeCount,
      suspendedCount,
      totalChannels: channelCount,
      totalUsers:    userCount,
      planDistribution,
      recentOnboards,
      enterprises,
    }
  }

  /**
   * Get cross-enterprise security overview.
   */
  static async getSecurityOverview() {
    const [recentLogins, lockedAccounts, totalActiveUsers, recentAuditActions] = await Promise.all([
      // Last 20 logins across all enterprises
      prisma.user.findMany({
        where: { lastLoginAt: { not: null }, deletedAt: null },
        select: {
          id: true, username: true, role: true, lastLoginAt: true, status: true,
          enterprise: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { lastLoginAt: 'desc' },
        take: 20,
      }),
      // Locked/Inactive accounts
      prisma.user.findMany({
        where: { status: 'INACTIVE', deletedAt: null },
        select: {
          id: true, username: true, role: true, email: true,
          enterprise: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
      // Total active users
      prisma.user.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      // Recent platform-level audit actions
      prisma.auditLog.findMany({
        where: {
          action: {
            in: ['WORKSPACE_SWITCH', 'ENTERPRISE_SUSPEND', 'ENTERPRISE_REACTIVATE', 'PLAN_CHANGE',
                 'LOGIN', 'LOGIN_FAILED', 'ACCOUNT_LOCKED', 'USER_CREATE', 'USER_DELETE'],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ])

    return {
      recentLogins,
      lockedAccounts,
      lockedCount:      lockedAccounts.length,
      totalActiveUsers,
      recentAuditActions,
    }
  }
}
