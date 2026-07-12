CREATE TYPE "DebtStatus" AS ENUM ('ACTIVE', 'NEGOTIATING', 'PAID', 'DEFAULTED');
CREATE TYPE "AttachmentUploadStatus" AS ENUM ('UPLOADING', 'READY', 'FAILED');
CREATE TYPE "OcrStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'PROCESSING', 'COMPLETED', 'NEEDS_REVIEW', 'FAILED');
CREATE TYPE "FinancialConnectionStatus" AS ENUM ('PENDING', 'SYNCING', 'ACTIVE', 'REAUTH_REQUIRED', 'REVOKED', 'ERROR');
CREATE TYPE "SyncJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "TransactionMatchStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'REJECTED', 'IMPORTED');
CREATE TYPE "TaxProfileType" AS ENUM ('FAMILY', 'BUSINESS');
CREATE TYPE "TaxRegime" AS ENUM ('NOT_APPLICABLE', 'MEI', 'SIMPLES_NACIONAL', 'REGULAR', 'LUCRO_PRESUMIDO', 'LUCRO_REAL');
CREATE TYPE "TaxDocumentStatus" AS ENUM ('IMPORTED', 'VALIDATED', 'NEEDS_REVIEW', 'REJECTED');
CREATE TYPE "TaxLedgerEntryKind" AS ENUM ('DEBIT', 'CREDIT', 'PRESUMED_CREDIT', 'ADJUSTMENT', 'SETTLEMENT');

CREATE TABLE "LoginThrottle" (
  "id" TEXT NOT NULL,
  "emailHash" TEXT NOT NULL,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SplitPayment" (
  "id" TEXT NOT NULL,
  "splitId" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  CONSTRAINT "SplitPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MonthlyBudget" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "month" DATE NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MonthlyBudget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialMonthClose" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "closedById" TEXT NOT NULL,
  "month" DATE NOT NULL,
  "snapshot" JSONB NOT NULL,
  "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialMonthClose_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Debt" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "creditor" TEXT,
  "originalAmount" DECIMAL(14,2) NOT NULL,
  "outstandingBalance" DECIMAL(14,2) NOT NULL,
  "monthlyInterestRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
  "installmentAmount" DECIMAL(14,2) NOT NULL,
  "minimumPayment" DECIMAL(14,2),
  "dueDay" INTEGER,
  "remainingInstallments" INTEGER,
  "status" "DebtStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Debt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DebtPayment" (
  "id" TEXT NOT NULL,
  "debtId" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  CONSTRAINT "DebtPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountTransfer" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "fromAccountId" TEXT NOT NULL,
  "toAccountId" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "transferredAt" TIMESTAMP(3) NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountTransfer_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Attachment" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Attachment" ADD COLUMN "uploadStatus" "AttachmentUploadStatus" NOT NULL DEFAULT 'READY';
ALTER TABLE "Attachment" ADD COLUMN "ocrStatus" "OcrStatus" NOT NULL DEFAULT 'NOT_REQUESTED';
ALTER TABLE "Attachment" ADD COLUMN "ocrProvider" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "extractedText" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "extractedData" JSONB;
ALTER TABLE "Attachment" ADD COLUMN "confidence" DECIMAL(5,4);
ALTER TABLE "Attachment" ADD COLUMN "processedAt" TIMESTAMP(3);
ALTER TABLE "Attachment" ADD COLUMN "ocrError" TEXT;

CREATE TABLE "EconomicIndicator" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "value" DECIMAL(18,6) NOT NULL,
  "source" TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EconomicIndicator_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialConnection" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'PLUGGY',
  "externalItemId" TEXT NOT NULL,
  "connectorId" TEXT,
  "connectorName" TEXT,
  "status" "FinancialConnectionStatus" NOT NULL DEFAULT 'PENDING',
  "consentExpiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "lastSyncAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalAccount" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "subtype" TEXT,
  "name" TEXT NOT NULL,
  "numberMasked" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "balance" DECIMAL(14,2),
  "creditLimit" DECIMAL(14,2),
  "raw" JSONB,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalTransaction" (
  "id" TEXT NOT NULL,
  "externalAccountId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "merchant" TEXT,
  "category" TEXT,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "transactionDate" TIMESTAMP(3) NOT NULL,
  "raw" JSONB,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SyncJob" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "status" "SyncJobStatus" NOT NULL DEFAULT 'PENDING',
  "trigger" TEXT NOT NULL,
  "cursor" TEXT,
  "result" JSONB,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsentRecord" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "externalConsentId" TEXT NOT NULL,
  "products" JSONB NOT NULL,
  "permissions" JSONB,
  "grantedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookEvent" (
  "id" TEXT NOT NULL,
  "householdId" TEXT,
  "provider" TEXT NOT NULL,
  "externalEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TransactionMatch" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "externalTransactionId" TEXT NOT NULL,
  "transactionId" TEXT,
  "confidence" DECIMAL(5,4) NOT NULL,
  "status" "TransactionMatchStatus" NOT NULL DEFAULT 'SUGGESTED',
  "reasons" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransactionMatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxProfile" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "type" "TaxProfileType" NOT NULL,
  "name" TEXT NOT NULL,
  "document" TEXT,
  "taxRegime" "TaxRegime" NOT NULL DEFAULT 'NOT_APPLICABLE',
  "cnae" TEXT,
  "state" TEXT,
  "cityCode" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxRuleVersion" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "validFrom" DATE NOT NULL,
  "validTo" DATE,
  "sourceUrl" TEXT NOT NULL,
  "rules" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxRuleVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxDocument" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "taxProfileId" TEXT,
  "transactionId" TEXT,
  "sourceKey" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "accessKey" TEXT,
  "issuerName" TEXT,
  "issuerDocument" TEXT,
  "issuedAt" TIMESTAMP(3),
  "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "cbsAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ibsStateAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ibsCityAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "selectiveTaxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "status" "TaxDocumentStatus" NOT NULL DEFAULT 'IMPORTED',
  "calculationSource" TEXT,
  "ruleVersion" TEXT,
  "rawSummary" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxDocumentItem" (
  "id" TEXT NOT NULL,
  "taxDocumentId" TEXT NOT NULL,
  "itemNumber" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "productCode" TEXT,
  "classification" TEXT,
  "taxTreatment" TEXT,
  "quantity" DECIMAL(14,4),
  "grossAmount" DECIMAL(14,2) NOT NULL,
  "taxBase" DECIMAL(14,2),
  "cbsRate" DECIMAL(9,4),
  "ibsStateRate" DECIMAL(9,4),
  "ibsCityRate" DECIMAL(9,4),
  "selectiveTaxRate" DECIMAL(9,4),
  "cbsAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ibsStateAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ibsCityAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "selectiveTaxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "creditAllowed" BOOLEAN,
  CONSTRAINT "TaxDocumentItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxSimulation" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "ruleVersionId" TEXT NOT NULL,
  "mode" "TaxProfileType" NOT NULL,
  "operationDate" DATE NOT NULL,
  "input" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxSimulation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxLedgerEntry" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "kind" "TaxLedgerEntryKind" NOT NULL,
  "competenceDate" DATE NOT NULL,
  "description" TEXT NOT NULL,
  "cbsAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ibsAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "selectiveTaxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "sourceReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxCashback" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "competenceDate" DATE NOT NULL,
  "estimatedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "receivedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "inputs" JSONB,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxCashback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoginThrottle_emailHash_key" ON "LoginThrottle"("emailHash");
CREATE INDEX "SplitPayment_splitId_paidAt_idx" ON "SplitPayment"("splitId", "paidAt");
CREATE UNIQUE INDEX "MonthlyBudget_householdId_month_categoryId_key" ON "MonthlyBudget"("householdId", "month", "categoryId");
CREATE INDEX "MonthlyBudget_householdId_month_idx" ON "MonthlyBudget"("householdId", "month");
CREATE UNIQUE INDEX "FinancialMonthClose_householdId_month_key" ON "FinancialMonthClose"("householdId", "month");
CREATE INDEX "FinancialMonthClose_householdId_closedAt_idx" ON "FinancialMonthClose"("householdId", "closedAt");
CREATE INDEX "Debt_householdId_status_idx" ON "Debt"("householdId", "status");
CREATE INDEX "DebtPayment_debtId_paidAt_idx" ON "DebtPayment"("debtId", "paidAt");
CREATE INDEX "AccountTransfer_householdId_transferredAt_idx" ON "AccountTransfer"("householdId", "transferredAt");
CREATE INDEX "AccountTransfer_fromAccountId_idx" ON "AccountTransfer"("fromAccountId");
CREATE INDEX "AccountTransfer_toAccountId_idx" ON "AccountTransfer"("toAccountId");
CREATE UNIQUE INDEX "EconomicIndicator_code_date_key" ON "EconomicIndicator"("code", "date");
CREATE INDEX "EconomicIndicator_code_date_idx" ON "EconomicIndicator"("code", "date");
CREATE UNIQUE INDEX "FinancialConnection_provider_externalItemId_key" ON "FinancialConnection"("provider", "externalItemId");
CREATE INDEX "FinancialConnection_householdId_status_idx" ON "FinancialConnection"("householdId", "status");
CREATE UNIQUE INDEX "ExternalAccount_connectionId_externalId_key" ON "ExternalAccount"("connectionId", "externalId");
CREATE INDEX "ExternalAccount_connectionId_type_idx" ON "ExternalAccount"("connectionId", "type");
CREATE UNIQUE INDEX "ExternalTransaction_externalAccountId_externalId_key" ON "ExternalTransaction"("externalAccountId", "externalId");
CREATE INDEX "ExternalTransaction_externalAccountId_transactionDate_idx" ON "ExternalTransaction"("externalAccountId", "transactionDate");
CREATE INDEX "SyncJob_connectionId_createdAt_idx" ON "SyncJob"("connectionId", "createdAt");
CREATE UNIQUE INDEX "ConsentRecord_connectionId_externalConsentId_key" ON "ConsentRecord"("connectionId", "externalConsentId");
CREATE INDEX "ConsentRecord_connectionId_revokedAt_idx" ON "ConsentRecord"("connectionId", "revokedAt");
CREATE UNIQUE INDEX "WebhookEvent_provider_externalEventId_key" ON "WebhookEvent"("provider", "externalEventId");
CREATE INDEX "WebhookEvent_provider_receivedAt_idx" ON "WebhookEvent"("provider", "receivedAt");
CREATE INDEX "WebhookEvent_householdId_receivedAt_idx" ON "WebhookEvent"("householdId", "receivedAt");
CREATE UNIQUE INDEX "TransactionMatch_externalTransactionId_key" ON "TransactionMatch"("externalTransactionId");
CREATE INDEX "TransactionMatch_householdId_status_idx" ON "TransactionMatch"("householdId", "status");
CREATE INDEX "TransactionMatch_transactionId_idx" ON "TransactionMatch"("transactionId");
CREATE INDEX "TaxProfile_householdId_type_active_idx" ON "TaxProfile"("householdId", "type", "active");
CREATE UNIQUE INDEX "TaxRuleVersion_code_key" ON "TaxRuleVersion"("code");
CREATE UNIQUE INDEX "TaxDocument_householdId_sourceHash_key" ON "TaxDocument"("householdId", "sourceHash");
CREATE UNIQUE INDEX "TaxDocument_transactionId_key" ON "TaxDocument"("transactionId");
CREATE INDEX "TaxDocument_householdId_issuedAt_idx" ON "TaxDocument"("householdId", "issuedAt");
CREATE UNIQUE INDEX "TaxDocumentItem_taxDocumentId_itemNumber_key" ON "TaxDocumentItem"("taxDocumentId", "itemNumber");
CREATE INDEX "TaxSimulation_householdId_createdAt_idx" ON "TaxSimulation"("householdId", "createdAt");
CREATE INDEX "TaxLedgerEntry_householdId_competenceDate_kind_idx" ON "TaxLedgerEntry"("householdId", "competenceDate", "kind");
CREATE UNIQUE INDEX "TaxCashback_householdId_competenceDate_key" ON "TaxCashback"("householdId", "competenceDate");

ALTER TABLE "SplitPayment" ADD CONSTRAINT "SplitPayment_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "Split"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonthlyBudget" ADD CONSTRAINT "MonthlyBudget_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonthlyBudget" ADD CONSTRAINT "MonthlyBudget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinancialMonthClose" ADD CONSTRAINT "FinancialMonthClose_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "Debt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountTransfer" ADD CONSTRAINT "AccountTransfer_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountTransfer" ADD CONSTRAINT "AccountTransfer_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountTransfer" ADD CONSTRAINT "AccountTransfer_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinancialConnection" ADD CONSTRAINT "FinancialConnection_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalAccount" ADD CONSTRAINT "ExternalAccount_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "FinancialConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalTransaction" ADD CONSTRAINT "ExternalTransaction_externalAccountId_fkey" FOREIGN KEY ("externalAccountId") REFERENCES "ExternalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "FinancialConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "FinancialConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransactionMatch" ADD CONSTRAINT "TransactionMatch_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransactionMatch" ADD CONSTRAINT "TransactionMatch_externalTransactionId_fkey" FOREIGN KEY ("externalTransactionId") REFERENCES "ExternalTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransactionMatch" ADD CONSTRAINT "TransactionMatch_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaxProfile" ADD CONSTRAINT "TaxProfile_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxDocument" ADD CONSTRAINT "TaxDocument_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxDocument" ADD CONSTRAINT "TaxDocument_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "TaxProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaxDocument" ADD CONSTRAINT "TaxDocument_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaxDocumentItem" ADD CONSTRAINT "TaxDocumentItem_taxDocumentId_fkey" FOREIGN KEY ("taxDocumentId") REFERENCES "TaxDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxSimulation" ADD CONSTRAINT "TaxSimulation_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxSimulation" ADD CONSTRAINT "TaxSimulation_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "TaxRuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxLedgerEntry" ADD CONSTRAINT "TaxLedgerEntry_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxCashback" ADD CONSTRAINT "TaxCashback_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
