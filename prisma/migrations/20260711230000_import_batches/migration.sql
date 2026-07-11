CREATE TYPE "ImportStatus" AS ENUM ('IMPORTED', 'ROLLED_BACK');

CREATE TABLE "ImportBatch" (
  "id" TEXT PRIMARY KEY,
  "householdId" TEXT NOT NULL,
  "actorId" TEXT,
  "fileName" TEXT NOT NULL,
  "sourceKey" TEXT,
  "sourceHash" TEXT NOT NULL,
  "competenceDate" TIMESTAMP(3) NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "importedCount" INTEGER NOT NULL,
  "currentMonthTotal" DECIMAL(14,2) NOT NULL,
  "status" "ImportStatus" NOT NULL DEFAULT 'IMPORTED',
  "reconciliation" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rolledBackAt" TIMESTAMP(3),
  CONSTRAINT "ImportBatch_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE
);

ALTER TABLE "Transaction" ADD COLUMN "importBatchId" TEXT;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL;

CREATE INDEX "Transaction_importBatchId_idx" ON "Transaction"("importBatchId");
CREATE INDEX "ImportBatch_householdId_createdAt_idx" ON "ImportBatch"("householdId", "createdAt");
CREATE INDEX "ImportBatch_householdId_sourceHash_idx" ON "ImportBatch"("householdId", "sourceHash");
