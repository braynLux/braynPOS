-- Link a serial to the transfer line it shipped on.
--
-- Additive and nullable: existing rows keep NULL, and transfers already in
-- flight when this deploys stay receivable via the legacy status-only path in
-- TransfersService. ON DELETE SET NULL mirrors the compensating delete in
-- TransfersService.create(), which removes transfer lines when the stock
-- transaction fails.

-- AlterTable
ALTER TABLE "serials" ADD COLUMN "transferLineId" TEXT;

-- CreateIndex
CREATE INDEX "serials_transferLineId_idx" ON "serials"("transferLineId");

-- AddForeignKey
ALTER TABLE "serials" ADD CONSTRAINT "serials_transferLineId_fkey"
  FOREIGN KEY ("transferLineId") REFERENCES "transfer_lines"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
