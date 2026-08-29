-- ==========================================================================
-- Migration: 20260827180000_enterprise_multi_tenant_and_zero_redis
-- Adds:
--  1. Enterprise model & relations (channels, users, items, audit_logs)
--  2. PLATFORM_OWNER to UserRole enum
--  3. Zero-Redis Postgres tables (revoked_tokens, manager_approval_tokens, login_attempts)
-- ==========================================================================

-- 1. Add PLATFORM_OWNER to UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PLATFORM_OWNER';

-- 2. Create Enterprise table
CREATE TABLE IF NOT EXISTS "enterprises" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "logoUrl" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'STARTER',
    "planFeatures" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "enterprises_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "enterprises_slug_key" ON "enterprises"("slug");
CREATE INDEX IF NOT EXISTS "enterprises_slug_idx" ON "enterprises"("slug");
CREATE INDEX IF NOT EXISTS "enterprises_email_idx" ON "enterprises"("email");

-- 3. Add enterpriseId columns & foreign keys
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "enterpriseId" TEXT;
CREATE INDEX IF NOT EXISTS "channels_enterpriseId_idx" ON "channels"("enterpriseId");
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'channels_enterpriseId_fkey') THEN
        ALTER TABLE "channels" ADD CONSTRAINT "channels_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "enterpriseId" TEXT;
CREATE INDEX IF NOT EXISTS "users_enterpriseId_idx" ON "users"("enterpriseId");
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_enterpriseId_fkey') THEN
        ALTER TABLE "users" ADD CONSTRAINT "users_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "enterpriseId" TEXT;
CREATE INDEX IF NOT EXISTS "items_enterpriseId_idx" ON "items"("enterpriseId");
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_enterpriseId_fkey') THEN
        ALTER TABLE "items" ADD CONSTRAINT "items_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "enterpriseId" TEXT;
CREATE INDEX IF NOT EXISTS "audit_logs_enterpriseId_idx" ON "audit_logs"("enterpriseId");
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_enterpriseId_fkey') THEN
        ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 4. Clean up any mismatched security tables from legacy attempts
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'revoked_tokens' AND column_name = 'id') THEN
        DROP TABLE IF EXISTS "revoked_tokens" CASCADE;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'manager_approval_tokens' AND column_name = 'token') THEN
        DROP TABLE IF EXISTS "manager_approval_tokens" CASCADE;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'login_attempts' AND column_name = 'key') THEN
        DROP TABLE IF EXISTS "login_attempts" CASCADE;
    END IF;
END $$;

-- Create Zero-Redis security infrastructure tables matching Prisma schema EXACTLY
CREATE TABLE IF NOT EXISTS "revoked_tokens" (
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revoked_tokens_pkey" PRIMARY KEY ("token")
);
CREATE INDEX IF NOT EXISTS "revoked_tokens_expiresAt_idx" ON "revoked_tokens"("expiresAt");

CREATE TABLE IF NOT EXISTS "manager_approval_tokens" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "channelId" TEXT,
    "approverId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manager_approval_tokens_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "manager_approval_tokens_expiresAt_idx" ON "manager_approval_tokens"("expiresAt");

CREATE TABLE IF NOT EXISTS "login_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "login_attempts_userId_failedAt_idx" ON "login_attempts"("userId", "failedAt");

-- 5. Create Enterprise Invites table (One-Time Invite Codes)
CREATE TABLE IF NOT EXISTS "enterprise_invites" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "businessName" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'STARTER',
    "createdBy" TEXT NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "enterpriseId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enterprise_invites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_invites_code_key" ON "enterprise_invites"("code");
CREATE INDEX IF NOT EXISTS "enterprise_invites_code_idx" ON "enterprise_invites"("code");
CREATE INDEX IF NOT EXISTS "enterprise_invites_isUsed_idx" ON "enterprise_invites"("isUsed");
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enterprise_invites_enterpriseId_fkey') THEN
        ALTER TABLE "enterprise_invites" ADD CONSTRAINT "enterprise_invites_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
