// One-off script to reset the seeded admin user's password in a database
// where the account already exists but its password is unknown (e.g. it was
// created by prisma/seed.ts in NODE_ENV=production without SEED_ADMIN_PASSWORD
// set, which falls back to a random, unrecoverable password).
//
// Usage:
//   DATABASE_URL="<production connection string>" \
//   ADMIN_PASSWORD="Admin@123" \
//   pnpm --filter api exec tsx scripts/reset-admin-password.ts
//
// ADMIN_PASSWORD defaults to "Admin@123" if not set. Change it after first login.

import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'

const prisma = new PrismaClient()

async function main() {
  const password = process.env.ADMIN_PASSWORD || 'Admin@123'
  const username = process.env.ADMIN_USERNAME || 'admin'

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  })

  const user = await prisma.user.update({
    where: { username },
    data: { passwordHash },
  })

  console.log(`Password reset for user "${user.username}" (${user.email}).`)
}

main()
  .catch((e) => {
    console.error('Failed to reset admin password:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
