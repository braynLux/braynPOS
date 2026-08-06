-- CreateEnum
CREATE TYPE "ExpensePaymentSource" AS ENUM ('CASH', 'BANK', 'CREDITOR', 'CAPITAL');

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "paymentSource" "ExpensePaymentSource" NOT NULL DEFAULT 'CASH';

-- AlterTable
ALTER TABLE "idempotency_records" ALTER COLUMN "expiresAt" SET DEFAULT NOW() + INTERVAL '7 days';

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "packSize" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "purchaseDate" TIMESTAMP(3);
