/**
 * pg-store.ts
 * Postgres-backed replacements for every feature that previously required Redis.
 * Drop Redis entirely — no ioredis dependency, no external service cost.
 */
import { basePrisma as prisma } from './prisma.js'

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000

// -- JWT Token Revocation ------------------------------------------------------

export async function revokeToken(token: string, expiresAt: Date): Promise<void> {
  if (expiresAt <= new Date()) return
  await prisma.revokedToken.upsert({
    where:  { token },
    create: { token, expiresAt },
    update: {},
  })
}

export async function isTokenRevoked(token: string): Promise<boolean> {
  const row = await prisma.revokedToken.findUnique({ where: { token } })
  if (!row) return false
  return row.expiresAt > new Date()
}

// -- Manager Approval Tokens ---------------------------------------------------

interface ApprovalTokenData {
  action:     string
  contextId:  string
  channelId?: string | null
  approverId: string
  actorId:    string
}

export async function storeApprovalToken(
  tokenId: string,
  data: ApprovalTokenData,
  ttlSeconds = 120
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
  await prisma.managerApprovalToken.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  await prisma.managerApprovalToken.create({ data: { id: tokenId, ...data, expiresAt } })
}

export async function getApprovalToken(tokenId: string): Promise<ApprovalTokenData | null> {
  const row = await prisma.managerApprovalToken.findUnique({ where: { id: tokenId } })
  if (!row) return null
  if (row.expiresAt <= new Date()) {
    await prisma.managerApprovalToken.delete({ where: { id: tokenId } }).catch(() => {})
    return null
  }
  return { action: row.action, contextId: row.contextId, channelId: row.channelId, approverId: row.approverId, actorId: row.actorId }
}

export async function deleteApprovalToken(tokenId: string): Promise<void> {
  await prisma.managerApprovalToken.delete({ where: { id: tokenId } }).catch(() => {})
}

// -- Login Attempt Tracking ----------------------------------------------------

export async function recordLoginFailure(userId: string): Promise<number> {
  const windowStart = new Date(Date.now() - FIFTEEN_MINUTES_MS)
  await prisma.loginAttempt.create({ data: { userId } })
  return prisma.loginAttempt.count({ where: { userId, failedAt: { gte: windowStart } } })
}

export async function clearLoginFailures(userId: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { userId } })
}

// -- Nightly Cleanup -----------------------------------------------------------

export async function purgeExpiredSecurityRecords(): Promise<void> {
  const windowStart = new Date(Date.now() - FIFTEEN_MINUTES_MS)
  await Promise.all([
    prisma.revokedToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    prisma.loginAttempt.deleteMany({ where: { failedAt: { lt: windowStart } } }),
    prisma.managerApprovalToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
  ])
}
