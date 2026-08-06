-- AlterTable
ALTER TABLE "idempotency_records" ALTER COLUMN "expiresAt" SET DEFAULT NOW() + INTERVAL '7 days';

-- CreateTable
CREATE TABLE "job_levels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "basicSalary" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "overtimeRatePerHour" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "channelId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_levels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_levels_channelId_idx" ON "job_levels"("channelId");

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_jobLevelId_fkey" FOREIGN KEY ("jobLevelId") REFERENCES "job_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_levels" ADD CONSTRAINT "job_levels_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
