-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "contactPerson" TEXT,
ADD COLUMN     "isThirdParty" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "idempotency_records" ALTER COLUMN "expiresAt" SET DEFAULT NOW() + INTERVAL '7 days';

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "discountAmount" DECIMAL(14,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "customerOrderNo" TEXT,
ADD COLUMN     "quotationRefNo" TEXT,
ADD COLUMN     "selectedBankId" TEXT,
ADD COLUMN     "taxExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "terms" TEXT;

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "supplierInvoiceNo" TEXT;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_selectedBankId_fkey" FOREIGN KEY ("selectedBankId") REFERENCES "channel_banks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
