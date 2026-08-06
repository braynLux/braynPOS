/*
  Warnings:

  - Made the column `vatOverride` on table `sales` required. This step will fail if there are existing NULL values in that column.
  - Made the column `channelId` on table `sync_conflicts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `errorMessage` on table `sync_conflicts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `salePayload` on table `sync_conflicts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `totalAmount` on table `sync_conflicts` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('QUOTATION', 'PROFORMA', 'INVOICE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- DropIndex
DROP INDEX "sync_conflicts_saleId_idx";

-- AlterTable
ALTER TABLE "idempotency_records" ALTER COLUMN "expiresAt" SET DEFAULT NOW() + INTERVAL '7 days';

-- AlterTable
ALTER TABLE "repair_requests" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sales" ALTER COLUMN "vatOverride" SET NOT NULL;

-- AlterTable
ALTER TABLE "service_checklists" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sync_conflicts" ALTER COLUMN "channelId" SET NOT NULL,
ALTER COLUMN "errorMessage" SET NOT NULL,
ALTER COLUMN "salePayload" SET NOT NULL,
ALTER COLUMN "totalAmount" SET NOT NULL;

-- AlterTable
ALTER TABLE "user_targets" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'INVOICE',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "channelId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "subtotal" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "notes" TEXT,
    "convertedFromId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "voidedAt" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitPrice" DECIMAL(12,4) NOT NULL,
    "lineTotal" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNo_key" ON "invoices"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_convertedFromId_key" ON "invoices"("convertedFromId");

-- CreateIndex
CREATE INDEX "invoices_channelId_createdAt_idx" ON "invoices"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "invoices_customerId_idx" ON "invoices"("customerId");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoices_type_idx" ON "invoices"("type");

-- CreateIndex
CREATE INDEX "invoice_lines_invoiceId_idx" ON "invoice_lines"("invoiceId");

-- CreateIndex
CREATE INDEX "inventory_balances_weightedAvgCost_idx" ON "inventory_balances"("weightedAvgCost");

-- CreateIndex
CREATE INDEX "sale_items_saleId_costPriceSnapshot_idx" ON "sale_items"("saleId", "costPriceSnapshot");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_convertedFromId_fkey" FOREIGN KEY ("convertedFromId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
