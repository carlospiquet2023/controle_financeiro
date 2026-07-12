import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { Dashboard } from "@/components/dashboard";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { addUtcMonths, monthStartUtc, saoPauloMonth } from "@/lib/format";

export const dynamic = "force-dynamic";

const TRANSACTIONS_PER_PAGE = 20;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; page?: string }>;
}) {
  const user = await currentUser();
  if (!user?.memberships[0]) redirect("/entrar");
  const membership = user.memberships[0];
  const householdId = membership.householdId;
  const params = await searchParams;
  const requested = params.month;
  const validMonth =
    requested && /^20\d{2}-(0[1-9]|1[0-2])$/.test(requested) ? requested : null;
  const month = monthStartUtc(validMonth || saoPauloMonth());
  const nextMonth = addUtcMonths(month, 1);
  const forecastEnd = addUtcMonths(month, 12);
  const requestedPage = Math.max(
    Number.parseInt(params.page || "1", 10) || 1,
    1,
  );
  const transactionWhere: Prisma.TransactionWhereInput = {
    householdId,
    competenceDate: { gte: month, lt: nextMonth },
    status: { notIn: ["CANCELED", "REFUNDED"] },
  };
  const transactionTotal = await db.transaction.count({
    where: transactionWhere,
  });
  const transactionPages = Math.max(
    Math.ceil(transactionTotal / TRANSACTIONS_PER_PAGE),
    1,
  );
  const transactionPage = Math.min(requestedPage, transactionPages);
  const transactionInclude = {
    card: true,
    category: true,
    responsiblePerson: true,
    attachments: { orderBy: { createdAt: "desc" as const } },
    sharedComments: { orderBy: { createdAt: "desc" as const }, take: 3 },
  } as const;
  const [
    household,
    accounts,
    cards,
    categories,
    people,
    monthTransactions,
    overviewTransactions,
    expenseSummary,
    futureTransactions,
    openSplits,
    imports,
    sharedLinks,
    budgets,
    categoryExpenseSummary,
    financialSummary,
    monthClose,
    debts,
    accountActivity,
    transfers,
    financialConnections,
    transactionMatches,
    unmatchedExternalTransactions,
    taxDocuments,
    taxSimulations,
    taxLedger,
    taxCashbacks,
    dueAlerts,
  ] = await Promise.all([
    db.household.findUniqueOrThrow({
      where: { id: householdId },
      select: { name: true },
    }),
    db.account.findMany({
      where: { householdId, active: true },
      orderBy: { name: "asc" },
    }),
    db.card.findMany({
      where: { householdId, active: true },
      orderBy: { name: "asc" },
    }),
    db.category.findMany({ where: { householdId }, orderBy: { name: "asc" } }),
    db.person.findMany({
      where: { householdId, active: true },
      orderBy: { name: "asc" },
    }),
    db.transaction.findMany({
      where: transactionWhere,
      include: transactionInclude,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      skip: (transactionPage - 1) * TRANSACTIONS_PER_PAGE,
      take: TRANSACTIONS_PER_PAGE,
    }),
    db.transaction.findMany({
      where: { ...transactionWhere, type: "EXPENSE" },
      include: transactionInclude,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 8,
    }),
    db.transaction.groupBy({
      by: ["cardId", "status"],
      where: { ...transactionWhere, type: "EXPENSE" },
      _sum: { amount: true },
      _count: true,
    }),
    db.transaction.findMany({
      where: {
        householdId,
        competenceDate: { gte: month, lt: forecastEnd },
        type: "EXPENSE",
        status: { notIn: ["CANCELED", "REFUNDED"] },
      },
      select: { amount: true, competenceDate: true },
    }),
    db.split.findMany({
      where: {
        transaction: {
          householdId,
          status: { notIn: ["CANCELED", "REFUNDED"] },
        },
        status: { in: ["OPEN", "PARTIALLY_PAID"] },
      },
      include: {
        person: true,
        transaction: { select: { description: true, competenceDate: true } },
      },
      orderBy: { dueDate: "asc" },
    }),
    db.importBatch.findMany({
      where: { householdId },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    db.sharedLedgerLink.findMany({
      where: {
        householdId,
        month: { gte: month, lt: nextMonth },
        active: true,
      },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    db.monthlyBudget.findMany({
      where: { householdId, month },
      select: { categoryId: true, amount: true },
    }),
    db.transaction.groupBy({
      by: ["categoryId"],
      where: { ...transactionWhere, type: "EXPENSE" },
      _sum: { amount: true },
    }),
    db.transaction.groupBy({
      by: ["type", "status"],
      where: transactionWhere,
      _sum: { amount: true },
      _count: true,
    }),
    db.financialMonthClose.findUnique({
      where: { householdId_month: { householdId, month } },
    }),
    db.debt.findMany({
      where: { householdId },
      include: { payments: { orderBy: { paidAt: "desc" }, take: 5 } },
      orderBy: [{ status: "asc" }, { outstandingBalance: "desc" }],
    }),
    db.transaction.groupBy({
      by: ["accountId", "type"],
      where: { householdId, accountId: { not: null }, status: "PAID" },
      _sum: { amount: true },
    }),
    db.accountTransfer.findMany({
      where: { householdId },
      include: {
        fromAccount: { select: { name: true } },
        toAccount: { select: { name: true } },
      },
      orderBy: { transferredAt: "desc" },
      take: 20,
    }),
    db.financialConnection.findMany({
      where: { householdId },
      include: {
        accounts: {
          include: { _count: { select: { transactions: true } } },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.transactionMatch.findMany({
      where: { householdId, status: "SUGGESTED" },
      include: {
        externalTransaction: {
          include: {
            externalAccount: {
              include: { connection: { select: { connectorName: true } } },
            },
          },
        },
        transaction: {
          select: {
            id: true,
            description: true,
            amount: true,
            competenceDate: true,
          },
        },
      },
      orderBy: { confidence: "desc" },
      take: 50,
    }),
    db.externalTransaction.findMany({
      where: {
        match: null,
        externalAccount: {
          connection: { householdId, status: { not: "REVOKED" } },
        },
      },
      include: {
        externalAccount: {
          include: { connection: { select: { connectorName: true } } },
        },
      },
      orderBy: { transactionDate: "desc" },
      take: 50,
    }),
    db.taxDocument.findMany({
      where: { householdId },
      include: {
        _count: { select: { items: true } },
        transaction: {
          select: { id: true, category: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.taxSimulation.findMany({
      where: { householdId },
      include: {
        ruleVersion: { select: { code: true, name: true, sourceUrl: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.taxLedgerEntry.findMany({
      where: { householdId },
      orderBy: { competenceDate: "desc" },
      take: 100,
    }),
    db.taxCashback.findMany({
      where: { householdId },
      orderBy: { competenceDate: "desc" },
      take: 24,
    }),
    db.transaction.findMany({
      where: {
        ...transactionWhere,
        type: "EXPENSE",
        dueDate: { not: null },
        status: { in: ["PENDING", "PLANNED", "PARTIALLY_PAID", "OVERDUE"] },
      },
      select: { id: true, description: true, amount: true, dueDate: true },
      orderBy: { dueDate: "asc" },
    }),
  ]);
  const selectedMonth = month.toISOString().slice(0, 10);
  type ListedTransaction = Prisma.TransactionGetPayload<{
    include: typeof transactionInclude;
  }>;
  const serialize = (t: ListedTransaction) => ({
    ...t,
    amount: Number(t.amount),
    totalAmount: t.totalAmount ? Number(t.totalAmount) : null,
    card: t.card
      ? { id: t.card.id, name: t.card.name, color: t.card.color }
      : null,
    category: t.category?.name ?? "Sem categoria",
    responsiblePerson: t.responsiblePerson?.name ?? null,
    dueDate: t.dueDate?.toISOString() ?? null,
    competenceDate: t.competenceDate.toISOString(),
    attachments: t.attachments.map((item) => ({
      id: item.id,
      fileName: item.fileName,
      contentType: item.contentType,
      kind: item.kind,
      createdAt: item.createdAt.toISOString(),
      ocrStatus: item.ocrStatus,
      ocrProvider: item.ocrProvider,
      confidence: item.confidence ? Number(item.confidence) : null,
      extractedData: item.extractedData,
      ocrError: item.ocrError,
    })),
    sharedComments: t.sharedComments.map((comment) => ({
      id: comment.id,
      authorName: comment.authorName,
      message: comment.message,
      createdAt: comment.createdAt.toISOString(),
    })),
  });
  const currentBalance = (accountId: string, openingBalance: number) => {
    const income = accountActivity
      .filter((item) => item.accountId === accountId && item.type === "INCOME")
      .reduce((sum, item) => sum + Number(item._sum.amount || 0), 0);
    const expense = accountActivity
      .filter((item) => item.accountId === accountId && item.type === "EXPENSE")
      .reduce((sum, item) => sum + Number(item._sum.amount || 0), 0);
    const incoming = transfers
      .filter((item) => item.toAccountId === accountId)
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const outgoing = transfers
      .filter((item) => item.fromAccountId === accountId)
      .reduce((sum, item) => sum + Number(item.amount), 0);
    return openingBalance + income - expense + incoming - outgoing;
  };
  return (
    <Dashboard
      userName={user.name}
      membershipRole={membership.role}
      householdName={household.name}
      selectedMonth={selectedMonth}
      accounts={accounts.map((a) => ({
        ...a,
        openingBalance: Number(a.openingBalance),
        currentBalance: currentBalance(a.id, Number(a.openingBalance)),
      }))}
      cards={cards.map((c) => ({ ...c, creditLimit: Number(c.creditLimit) }))}
      categories={categories}
      people={people}
      transactions={monthTransactions.map(serialize)}
      overviewTransactions={overviewTransactions.map(serialize)}
      transactionTotal={transactionTotal}
      transactionPage={transactionPage}
      transactionsPerPage={TRANSACTIONS_PER_PAGE}
      expenseSummary={expenseSummary.map((item) => ({
        cardId: item.cardId,
        status: item.status,
        amount: Number(item._sum.amount || 0),
        count: item._count,
      }))}
      forecast={futureTransactions.map((t) => ({
        amount: Number(t.amount),
        competenceDate: t.competenceDate.toISOString(),
      }))}
      receivables={openSplits.map((s) => ({
        id: s.id,
        person: s.person.name,
        description: s.transaction.description,
        amount: Number(s.amount),
        paidAmount: Number(s.paidAmount),
        outstanding: Number(s.amount) - Number(s.paidAmount),
        dueDate: s.dueDate?.toISOString() ?? null,
        status: s.status,
      }))}
      imports={imports.map((item) => ({
        id: item.id,
        fileName: item.fileName,
        status: item.status,
        rowCount: item.rowCount,
        importedCount: item.importedCount,
        total: Number(item.currentMonthTotal),
        createdAt: item.createdAt.toISOString(),
      }))}
      sharedLinks={sharedLinks.map((item) => ({
        id: item.id,
        createdAt: item.createdAt.toISOString(),
      }))}
      budgets={budgets.map((item) => ({
        categoryId: item.categoryId,
        amount: Number(item.amount),
      }))}
      categoryActuals={categoryExpenseSummary.map((item) => ({
        categoryId: item.categoryId,
        amount: Number(item._sum.amount || 0),
      }))}
      financialSummary={financialSummary.map((item) => ({
        type: item.type,
        status: item.status,
        amount: Number(item._sum.amount || 0),
        count: item._count,
      }))}
      monthClose={
        monthClose
          ? {
              closedAt: monthClose.closedAt.toISOString(),
              snapshot: monthClose.snapshot,
            }
          : null
      }
      debts={debts.map((item) => ({
        ...item,
        originalAmount: Number(item.originalAmount),
        outstandingBalance: Number(item.outstandingBalance),
        monthlyInterestRate: Number(item.monthlyInterestRate),
        installmentAmount: Number(item.installmentAmount),
        minimumPayment: item.minimumPayment
          ? Number(item.minimumPayment)
          : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        payments: item.payments.map((payment) => ({
          id: payment.id,
          amount: Number(payment.amount),
          paidAt: payment.paidAt.toISOString(),
          notes: payment.notes,
        })),
      }))}
      transfers={transfers.map((item) => ({
        id: item.id,
        fromAccountId: item.fromAccountId,
        fromAccount: item.fromAccount.name,
        toAccountId: item.toAccountId,
        toAccount: item.toAccount.name,
        amount: Number(item.amount),
        transferredAt: item.transferredAt.toISOString(),
        description: item.description,
      }))}
      financialConnections={financialConnections.map((item) => ({
        id: item.id,
        provider: item.provider,
        connectorName: item.connectorName,
        status: item.status,
        consentExpiresAt: item.consentExpiresAt?.toISOString() ?? null,
        lastSyncAt: item.lastSyncAt?.toISOString() ?? null,
        errorMessage: item.errorMessage,
        accounts: item.accounts.map((account) => ({
          id: account.id,
          name: account.name,
          type: account.type,
          currency: account.currency,
          balance: account.balance ? Number(account.balance) : null,
          creditLimit: account.creditLimit ? Number(account.creditLimit) : null,
          transactionCount: account._count.transactions,
        })),
      }))}
      transactionMatches={transactionMatches.map((item) => ({
        id: item.id,
        confidence: Number(item.confidence),
        external: {
          id: item.externalTransaction.id,
          description: item.externalTransaction.description,
          amount: Number(item.externalTransaction.amount),
          date: item.externalTransaction.transactionDate.toISOString(),
          account: item.externalTransaction.externalAccount.name,
          institution:
            item.externalTransaction.externalAccount.connection.connectorName,
        },
        internal: item.transaction
          ? {
              id: item.transaction.id,
              description: item.transaction.description,
              amount: Number(item.transaction.amount),
              date: item.transaction.competenceDate.toISOString(),
            }
          : null,
      }))}
      unmatchedExternalTransactions={unmatchedExternalTransactions.map(
        (item) => ({
          id: item.id,
          description: item.description,
          amount: Number(item.amount),
          date: item.transactionDate.toISOString(),
          type: item.type,
          status: item.status,
          account: item.externalAccount.name,
          institution: item.externalAccount.connection.connectorName,
        }),
      )}
      taxDocuments={taxDocuments.map((item) => ({
        id: item.id,
        fileName: item.fileName,
        documentType: item.documentType,
        accessKey: item.accessKey,
        issuerName: item.issuerName,
        issuedAt: item.issuedAt?.toISOString() ?? null,
        totalAmount: Number(item.totalAmount),
        cbsAmount: Number(item.cbsAmount),
        ibsStateAmount: Number(item.ibsStateAmount),
        ibsCityAmount: Number(item.ibsCityAmount),
        selectiveTaxAmount: Number(item.selectiveTaxAmount),
        status: item.status,
        itemCount: item._count.items,
        createdAt: item.createdAt.toISOString(),
        transactionId: item.transaction?.id ?? null,
        categoryName: item.transaction?.category?.name ?? null,
      }))}
      taxSimulations={taxSimulations.map((item) => ({
        id: item.id,
        mode: item.mode,
        operationDate: item.operationDate.toISOString(),
        input: item.input,
        result: item.result,
        createdAt: item.createdAt.toISOString(),
        ruleVersion: item.ruleVersion,
      }))}
      taxLedger={taxLedger.map((item) => ({
        id: item.id,
        kind: item.kind,
        competenceDate: item.competenceDate.toISOString(),
        description: item.description,
        cbsAmount: Number(item.cbsAmount),
        ibsAmount: Number(item.ibsAmount),
        selectiveTaxAmount: Number(item.selectiveTaxAmount),
        sourceReference: item.sourceReference,
      }))}
      taxCashbacks={taxCashbacks.map((item) => ({
        competenceDate: item.competenceDate.toISOString(),
        estimatedAmount: Number(item.estimatedAmount),
        receivedAmount: Number(item.receivedAmount),
        inputs: item.inputs as Record<string, unknown> | null,
      }))}
      dueAlerts={dueAlerts.map((item) => ({
        id: item.id,
        description: item.description,
        amount: Number(item.amount),
        dueDate: item.dueDate!.toISOString(),
      }))}
    />
  );
}
