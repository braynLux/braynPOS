-- AlterEnum
ALTER TYPE "JournalRefType" ADD VALUE 'CUSTOMER_REPAYMENT';

-- AlterTable
ALTER TABLE "idempotency_records" ALTER COLUMN "expiresAt" SET DEFAULT NOW() + INTERVAL '7 days';
