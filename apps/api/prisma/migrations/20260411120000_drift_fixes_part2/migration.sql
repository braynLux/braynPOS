-- Create cost_audits table
CREATE TABLE IF NOT EXISTS "cost_audits" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "oldCost" DECIMAL(12,4) NOT NULL,
    "newCost" DECIMAL(12,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceId" TEXT,
    "performedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cost_audits_pkey" PRIMARY KEY ("id")
);
ALTER TABLE IF EXISTS "cost_audits" ADD COLUMN IF NOT EXISTS "channelId" TEXT;
CREATE INDEX IF NOT EXISTS "cost_audits_itemId_channelId_idx" ON "cost_audits"("itemId", "channelId");
ALTER TABLE "cost_audits" DROP CONSTRAINT IF EXISTS "cost_audits_itemId_fkey";
ALTER TABLE "cost_audits" ADD CONSTRAINT "cost_audits_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_audits" DROP CONSTRAINT IF EXISTS "cost_audits_channelId_fkey";
ALTER TABLE "cost_audits" ADD CONSTRAINT "cost_audits_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create fixed_assets table
CREATE TABLE IF NOT EXISTS "fixed_assets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "purchasePrice" DECIMAL(14,4) NOT NULL,
    "depreciationRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "currentValue" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "channelId" TEXT NOT NULL,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);
ALTER TABLE IF EXISTS "fixed_assets" ADD COLUMN IF NOT EXISTS "channelId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "fixed_assets_code_key" ON "fixed_assets"("code");
CREATE INDEX IF NOT EXISTS "fixed_assets_channelId_idx" ON "fixed_assets"("channelId");
ALTER TABLE "fixed_assets" DROP CONSTRAINT IF EXISTS "fixed_assets_channelId_fkey";
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create suspended_sales table
CREATE TABLE IF NOT EXISTS "suspended_sales" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customerData" JSONB,
    "cartData" JSONB NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "suspended_sales_pkey" PRIMARY KEY ("id")
);
ALTER TABLE IF EXISTS "suspended_sales" ADD COLUMN IF NOT EXISTS "channelId" TEXT;
ALTER TABLE "suspended_sales" DROP CONSTRAINT IF EXISTS "suspended_sales_channelId_fkey";
ALTER TABLE "suspended_sales" ADD CONSTRAINT "suspended_sales_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create sync_conflicts table
CREATE TABLE IF NOT EXISTS "sync_conflicts" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "salePayload" JSONB NOT NULL,
    "totalAmount" DECIMAL(14,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolutionNotes" TEXT,
    "channelId" TEXT NOT NULL,
    "branchId" TEXT,
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saleId" TEXT,
    CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("id")
);
ALTER TABLE IF EXISTS "sync_conflicts" ADD COLUMN IF NOT EXISTS "channelId" TEXT;
ALTER TABLE IF EXISTS "sync_conflicts" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;
ALTER TABLE IF EXISTS "sync_conflicts" ADD COLUMN IF NOT EXISTS "salePayload" JSONB;
ALTER TABLE IF EXISTS "sync_conflicts" ADD COLUMN IF NOT EXISTS "totalAmount" DECIMAL(14,4);
ALTER TABLE IF EXISTS "sync_conflicts" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE IF EXISTS "sync_conflicts" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE IF EXISTS "sync_conflicts" ALTER COLUMN "saleId" DROP NOT NULL;
ALTER TABLE IF EXISTS "sync_conflicts" DROP COLUMN IF EXISTS "resolved";
ALTER TABLE IF EXISTS "sync_conflicts" DROP COLUMN IF EXISTS "resolvedAt";
ALTER TABLE IF EXISTS "sync_conflicts" DROP COLUMN IF EXISTS "description";
CREATE INDEX IF NOT EXISTS "sync_conflicts_channelId_status_idx" ON "sync_conflicts"("channelId", "status");
ALTER TABLE "sync_conflicts" DROP CONSTRAINT IF EXISTS "sync_conflicts_channelId_fkey";
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_conflicts" DROP CONSTRAINT IF EXISTS "sync_conflicts_resolvedBy_fkey";
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sync_conflicts" DROP CONSTRAINT IF EXISTS "sync_conflicts_saleId_fkey";
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create user_targets table
CREATE TABLE IF NOT EXISTS "user_targets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "targetValue" DECIMAL(14,4) NOT NULL,
    "currentValue" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_targets_pkey" PRIMARY KEY ("id")
);
ALTER TABLE IF EXISTS "user_targets" ADD COLUMN IF NOT EXISTS "channelId" TEXT;
ALTER TABLE "user_targets" DROP CONSTRAINT IF EXISTS "user_targets_userId_fkey";
ALTER TABLE "user_targets" ADD CONSTRAINT "user_targets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_targets" DROP CONSTRAINT IF EXISTS "user_targets_channelId_fkey";
ALTER TABLE "user_targets" ADD CONSTRAINT "user_targets_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create service_checklists table
CREATE TABLE IF NOT EXISTS "service_checklists" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_checklists_pkey" PRIMARY KEY ("id")
);
ALTER TABLE IF EXISTS "service_checklists" ADD COLUMN IF NOT EXISTS "channelId" TEXT;
ALTER TABLE "service_checklists" DROP CONSTRAINT IF EXISTS "service_checklists_channelId_fkey";
ALTER TABLE "service_checklists" ADD CONSTRAINT "service_checklists_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create serial_audits table
CREATE TABLE IF NOT EXISTS "serial_audits" (
    "id" TEXT NOT NULL,
    "serialId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldSerialNo" TEXT,
    "newSerialNo" TEXT,
    "reason" TEXT NOT NULL,
    "performedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "serial_audits_pkey" PRIMARY KEY ("id")
);

-- Create channel_banks table
CREATE TABLE IF NOT EXISTS "channel_banks" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "paybill" TEXT,
    "branch" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "channel_banks_pkey" PRIMARY KEY ("id")
);
ALTER TABLE IF EXISTS "channel_banks" ADD COLUMN IF NOT EXISTS "channelId" TEXT;
ALTER TABLE "channel_banks" DROP CONSTRAINT IF EXISTS "channel_banks_channelId_fkey";
ALTER TABLE "channel_banks" ADD CONSTRAINT "channel_banks_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create repair_requests table
CREATE TABLE IF NOT EXISTS "repair_requests" (
    "id" TEXT NOT NULL,
    "repairNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "problemCategory" TEXT,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "estimatedCost" DECIMAL(14,4),
    "actualCost" DECIMAL(14,4),
    "assignedTo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "repair_requests_pkey" PRIMARY KEY ("id")
);
ALTER TABLE IF EXISTS "repair_requests" ADD COLUMN IF NOT EXISTS "channelId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "repair_requests_repairNo_key" ON "repair_requests"("repairNo");
ALTER TABLE "repair_requests" DROP CONSTRAINT IF EXISTS "repair_requests_customerId_fkey";
ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "repair_requests" DROP CONSTRAINT IF EXISTS "repair_requests_channelId_fkey";
ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "repair_requests" DROP CONSTRAINT IF EXISTS "repair_requests_assignedTo_fkey";
ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
