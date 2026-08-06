-- AlterTable
ALTER TABLE "idempotency_records" ALTER COLUMN "expiresAt" SET DEFAULT NOW() + INTERVAL '7 days';

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channelId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_categories_channelId_idx" ON "expense_categories"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_channelId_name_key" ON "expense_categories"("channelId", "name");

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
