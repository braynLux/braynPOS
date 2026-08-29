import { prisma, type TransactionClient } from '../../lib/prisma.js'
import { hashPassword } from '../../lib/password.js'
import { logAction, AUDIT } from '../../lib/audit.js'
import { Prisma, type UserRole } from '@prisma/client'

const GLOBAL_ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER_ADMIN']

interface ListUsersQuery {
  page?: number
  limit?: number
  role?: UserRole
  channelId?: string
  search?: string
}

export class UsersService {
  async findAll(query: ListUsersQuery, actor: { id: string; role: string; channelId: string | null; enterpriseId?: string | null }) {
    const page = query.page ?? 1
    const limit = query.limit ?? 25
    const skip = (page - 1) * limit

    const isPlatformOwner = actor.role === 'PLATFORM_OWNER'
    const isGlobalActor   = GLOBAL_ADMIN_ROLES.includes(actor.role) || isPlatformOwner
    const enterpriseId    = actor.enterpriseId

    if (!isGlobalActor) {
      if (!actor.channelId) {
        throw { statusCode: 403, message: 'User is not assigned to any channel' }
      }
      query.channelId = actor.channelId
    }

    const where: Prisma.UserWhereInput = {
      ...(enterpriseId && !isPlatformOwner && { enterpriseId }),
      ...(query.role && { role: query.role }),
      ...(query.channelId && { channelId: query.channelId }),
      ...(query.search && {
        OR: [
          { username: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
      // Non-global roles cannot see SUPER_ADMINs
      ...(!isGlobalActor && { NOT: { role: 'SUPER_ADMIN' } }),
    }

    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, username: true, email: true, role: true,
          channelId: true, status: true, mfaEnabled: true,
          lastLoginAt: true, createdAt: true,
          channel: { select: { id: true, name: true, code: true } },
          staffProfile: { select: { grossSalary: true, hireDate: true } },
        },
      }),
      prisma.user.count({ where }),
    ])

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }
  }

  async findById(id: string, actor: { id: string; role: string; channelId: string | null; enterpriseId?: string | null }) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: {
        id: true, username: true, email: true, role: true,
        channelId: true, status: true, mfaEnabled: true,
        lastLoginAt: true, createdAt: true, updatedAt: true,
        enterpriseId: true,
        channel: { select: { id: true, name: true, code: true } },
        staffProfile: true,
      },
    })

    const isPlatformOwner = actor.role === 'PLATFORM_OWNER'
    const isGlobalActor   = GLOBAL_ADMIN_ROLES.includes(actor.role) || isPlatformOwner
    const enterpriseId    = actor.enterpriseId

    // Enterprise boundary check
    if (enterpriseId && !isPlatformOwner && user.enterpriseId && user.enterpriseId !== enterpriseId) {
      throw { statusCode: 403, message: 'Forbidden: Cannot access users from other enterprises' }
    }

    // Channel boundary check for branch staff
    if (!isGlobalActor && user.id !== actor.id) {
      if (user.channelId !== actor.channelId) {
        throw { statusCode: 403, message: 'Forbidden: Cannot access users from other channels' }
      }
    }

    return user
  }

  async create(
    data: {
      username:   string
      email:      string
      password:   string
      role:       UserRole
      channelId?: string | null
      status?:    'ACTIVE' | 'PENDING' | 'INACTIVE'
    },
    actor: { id?: string; role: string; channelId: string | null; enterpriseId?: string | null }
  ) {
    const isPlatformOwner = actor.role === 'PLATFORM_OWNER'
    const isGlobalActor   = GLOBAL_ADMIN_ROLES.includes(actor.role) || isPlatformOwner
    if (!isGlobalActor) {
      if (!actor.channelId) {
        throw { statusCode: 400, message: 'Your account has no channel assigned' }
      }
      data.channelId = actor.channelId
    }

    const passwordHash = await hashPassword(data.password)

    try {
      return await prisma.$transaction(async (tx: TransactionClient) => {
        const enterpriseId = actor.enterpriseId

        // Scoped admin caps per enterprise
        if (data.role === 'SUPER_ADMIN') {
          const count = await tx.user.count({
            where: { role: 'SUPER_ADMIN', enterpriseId: enterpriseId || null, deletedAt: null },
          })
          if (count >= 1) {
            throw {
              statusCode: 400,
              message: 'Enterprise limit reached: Maximum 1 Super Admin allowed per enterprise.',
            }
          }
        } else if (data.role === 'MANAGER_ADMIN' || data.role === 'ADMIN') {
          const count = await tx.user.count({
            where: { role: data.role, enterpriseId: enterpriseId || null, deletedAt: null },
          })
          if (count >= 2) {
            throw {
              statusCode: 400,
              message: `Enterprise limit reached: Maximum 2 ${data.role} users allowed per enterprise.`,
            }
          }
        }

        const user = await tx.user.create({
          data: {
            username:     data.username,
            email:        data.email.trim().toLowerCase(),
            passwordHash,
            role:         data.role,
            enterpriseId: enterpriseId || null,
            channelId:    data.channelId ?? null,
            status:       data.status    || 'ACTIVE',
          },
          select: {
            id: true, username: true, email: true, role: true,
            channelId: true, status: true, createdAt: true,
          },
        })

        logAction({
          action:     AUDIT.USER_CREATE,
          actorId:    actor.role === 'SYSTEM' ? 'SYSTEM' : actor.id || 'SYSTEM',
          actorRole:  actor.role,
          channelId:  data.channelId || undefined,
          targetType: 'User',
          targetId:   user.id,
          newValues:  { username: user.username, role: user.role },
        })

        return user
      })
    } catch (err: any) {
      if (err.code === 'P2002') {
        const fields           = err.meta?.target || []
        const isEmailConflict  = fields.includes('email')
        const isUsernameConflict = fields.includes('username')

        let message = `Conflict: User with this ${fields.join(', ')} already exists`

        if (isEmailConflict || isUsernameConflict) {
          const existing = await prisma.$queryRaw<Array<{ id: string; deletedAt: Date | null }>>`
            SELECT id, "deletedAt" FROM users
            WHERE ${isEmailConflict ? Prisma.sql`email = ${data.email}` : Prisma.sql`username = ${data.username}`}
            LIMIT 1
          `
          if (existing[0]?.deletedAt) {
            const field = isEmailConflict ? 'email' : 'username'
            message = `Conflict: A user with this ${field} was previously deleted. Restore them or use a different ${field}.`
          }
        }

        const error = new Error(message) as any
        error.statusCode = 409
        error.code       = 'CONFLICT'
        throw error
      }
      throw err
    }
  }

  async update(id: string, data: Prisma.UserUpdateInput, actor: { id: string; role: string; channelId: string | null; enterpriseId?: string | null }) {
    if (typeof data.email === 'string') {
      data.email = data.email.trim().toLowerCase()
    }
    const existing = await this.findById(id, actor)
    const enterpriseId = actor.enterpriseId

    // Scoped admin caps per enterprise
    if (data.role === 'SUPER_ADMIN') {
      if (existing.role !== 'SUPER_ADMIN') {
        await prisma.$transaction(async (tx: TransactionClient) => {
          const count = await tx.user.count({
            where: { role: 'SUPER_ADMIN', enterpriseId: enterpriseId || null, deletedAt: null },
          })
          if (count >= 1) {
            throw {
              statusCode: 400,
              message: 'Enterprise limit reached: Maximum 1 Super Admin allowed per enterprise.',
            }
          }
        })
      }
    } else if (data.role === 'MANAGER_ADMIN' || data.role === 'ADMIN') {
      if (existing.role !== data.role) {
        await prisma.$transaction(async (tx: TransactionClient) => {
          const count = await tx.user.count({
            where: { role: data.role as UserRole, enterpriseId: enterpriseId || null, deletedAt: null },
          })
          if (count >= 2) {
            throw {
              statusCode: 400,
              message: `Enterprise limit reached: Maximum 2 ${String(data.role)} users allowed per enterprise.`,
            }
          }
        })
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true, username: true, email: true, role: true,
        channelId: true, status: true, updatedAt: true,
      },
    })

    if (data.role && data.role !== existing.role) {
      logAction({
        action:     AUDIT.USER_ROLE_CHANGE,
        actorId:    actor.id,
        actorRole:  actor.role,
        channelId:  existing.channelId || undefined,
        targetType: 'User',
        targetId:   id,
        oldValues:  { role: existing.role },
        newValues:  { role: user.role },
      })
    } else {
      logAction({
        action:     AUDIT.USER_UPDATE,
        actorId:    actor.id,
        actorRole:  actor.role,
        channelId:  existing.channelId || undefined,
        targetType: 'User',
        targetId:   id,
      })
    }

    return user
  }

  async updateSalary(userId: string, grossSalary: number) {
    return prisma.staffProfile.upsert({
      where: { userId },
      create: { userId, grossSalary, jobTitle: 'Staff', hireDate: new Date() },
      update: { grossSalary },
    })
  }

  async softDelete(id: string, actor: { id: string; role: string; channelId: string | null; enterpriseId?: string | null }) {
    const existing = await this.findById(id, actor)

    const user = await prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: 'INACTIVE',
      },
      select: { id: true, username: true, email: true, channelId: true },
    })

    logAction({
      action:     AUDIT.USER_DELETE,
      actorId:    actor.id,
      actorRole:  actor.role,
      channelId:  user.channelId || undefined,
      targetType: 'User',
      targetId:   id,
    })

    return { message: 'User deleted successfully' }
  }

  async resetPassword(id: string, newPassword: string) {
    const passwordHash = await hashPassword(newPassword)

    await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data:  { passwordHash },
      }),
      prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data:  { revokedAt: new Date() },
      }),
    ])

    logAction({
      action:     AUDIT.PASSWORD_CHANGED,
      actorId:    'SYSTEM', // Admin reset
      actorRole:  'ADMIN',
      targetType: 'User',
      targetId:   id,
    })

    return { message: 'Password reset successfully. The user must log in again.' }
  }

  async changePassword(id: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { passwordHash: true }
    })

    const { verifyPassword } = await import('../../lib/password.js')
    const isValid = await verifyPassword(user.passwordHash, currentPassword)
    
    if (!isValid) {
      const error = new Error('Invalid current password')
      Object.assign(error, { statusCode: 403 })
      throw error
    }

    const passwordHash = await hashPassword(newPassword)

    await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data:  { passwordHash },
      }),
      prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data:  { revokedAt: new Date() },
      }),
    ])

    logAction({
      action:     AUDIT.PASSWORD_CHANGED,
      actorId:    id,
      actorRole:  'USER',
      targetType: 'User',
      targetId:   id,
    })

    return { message: 'Password changed successfully. Please log in again.' }
  }
}

export const usersService = new UsersService()
