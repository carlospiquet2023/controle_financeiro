CREATE TABLE "SharedLedgerLink" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "SharedLedgerLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SharedLedgerComment" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SharedLedgerComment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SharedLedgerLink_tokenHash_key" ON "SharedLedgerLink"("tokenHash");
CREATE INDEX "SharedLedgerLink_householdId_month_active_idx" ON "SharedLedgerLink"("householdId", "month", "active");
CREATE INDEX "SharedLedgerComment_linkId_transactionId_createdAt_idx" ON "SharedLedgerComment"("linkId", "transactionId", "createdAt");
ALTER TABLE "SharedLedgerLink" ADD CONSTRAINT "SharedLedgerLink_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SharedLedgerLink" ADD CONSTRAINT "SharedLedgerLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SharedLedgerComment" ADD CONSTRAINT "SharedLedgerComment_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "SharedLedgerLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SharedLedgerComment" ADD CONSTRAINT "SharedLedgerComment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
