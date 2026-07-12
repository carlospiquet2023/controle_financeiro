import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { Dashboard } from "@/components/dashboard";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { addUtcMonths, monthStartUtc, saoPauloMonth } from "@/lib/format";

export const dynamic = "force-dynamic";

const TRANSACTIONS_PER_PAGE = 20;

export default async function Home({ searchParams }: { searchParams: Promise<{ month?: string; page?: string }> }) {
  const user = await currentUser();
  if (!user?.memberships[0]) redirect("/entrar");
  const membership = user.memberships[0];
  const householdId = membership.householdId;
  const params = await searchParams;
  const requested = params.month;
  const validMonth = requested && /^20\d{2}-(0[1-9]|1[0-2])$/.test(requested) ? requested : null;
  const month = monthStartUtc(validMonth || saoPauloMonth());
  const nextMonth = addUtcMonths(month, 1);
  const forecastEnd = addUtcMonths(month, 12);
  const requestedPage = Math.max(Number.parseInt(params.page || "1", 10) || 1, 1);
  const transactionWhere: Prisma.TransactionWhereInput = { householdId, competenceDate: { gte: month, lt: nextMonth }, status: { notIn: ["CANCELED", "REFUNDED"] } };
  const transactionTotal = await db.transaction.count({ where: transactionWhere });
  const transactionPages = Math.max(Math.ceil(transactionTotal / TRANSACTIONS_PER_PAGE), 1);
  const transactionPage = Math.min(requestedPage, transactionPages);
  const transactionInclude = { card: true, category: true, responsiblePerson: true } as const;
  const [household, accounts, cards, categories, people, monthTransactions, overviewTransactions, expenseSummary, futureTransactions, openSplits, imports] = await Promise.all([
    db.household.findUniqueOrThrow({ where: { id: householdId }, select: { name: true } }),
    db.account.findMany({ where: { householdId, active: true }, orderBy: { name: "asc" } }),
    db.card.findMany({ where: { householdId, active: true }, orderBy: { name: "asc" } }),
    db.category.findMany({ where: { householdId }, orderBy: { name: "asc" } }),
    db.person.findMany({ where: { householdId, active: true }, orderBy: { name: "asc" } }),
    db.transaction.findMany({ where: transactionWhere, include: transactionInclude, orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }], skip: (transactionPage - 1) * TRANSACTIONS_PER_PAGE, take: TRANSACTIONS_PER_PAGE }),
    db.transaction.findMany({ where: { ...transactionWhere, type: "EXPENSE" }, include: transactionInclude, orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }], take: 8 }),
    db.transaction.groupBy({ by: ["cardId", "status"], where: { ...transactionWhere, type: "EXPENSE" }, _sum: { amount: true }, _count: true }),
    db.transaction.findMany({ where: { householdId, competenceDate: { gte: month, lt: forecastEnd }, type: "EXPENSE", status: { notIn: ["CANCELED", "REFUNDED"] } }, select: { amount: true, competenceDate: true } }),
    db.split.findMany({ where: { transaction: { householdId }, status: { not: "PAID" } }, include: { person: true } }),
    db.importBatch.findMany({ where: { householdId }, orderBy: { createdAt: "desc" }, take: 12 }),
  ]);
  const selectedMonth = month.toISOString().slice(0, 10);
  type ListedTransaction = Prisma.TransactionGetPayload<{ include: typeof transactionInclude }>;
  const serialize = (t: ListedTransaction) => ({ ...t, amount: Number(t.amount), totalAmount: t.totalAmount ? Number(t.totalAmount) : null, card: t.card ? { id: t.card.id, name: t.card.name, color: t.card.color } : null, category: t.category?.name ?? "Sem categoria", responsiblePerson: t.responsiblePerson?.name ?? null, dueDate: t.dueDate?.toISOString() ?? null, competenceDate: t.competenceDate.toISOString() });
  return <Dashboard userName={user.name} householdName={household.name} selectedMonth={selectedMonth} accounts={accounts.map(a => ({ ...a, openingBalance: Number(a.openingBalance) }))} cards={cards.map(c => ({ ...c, creditLimit: Number(c.creditLimit) }))} categories={categories} people={people} transactions={monthTransactions.map(serialize)} overviewTransactions={overviewTransactions.map(serialize)} transactionTotal={transactionTotal} transactionPage={transactionPage} transactionsPerPage={TRANSACTIONS_PER_PAGE} expenseSummary={expenseSummary.map(item => ({ cardId: item.cardId, status: item.status, amount: Number(item._sum.amount || 0), count: item._count }))} forecast={futureTransactions.map(t => ({ amount: Number(t.amount), competenceDate: t.competenceDate.toISOString() }))} receivables={openSplits.map(s => ({ person: s.person.name, amount: Number(s.amount) - Number(s.paidAmount) }))} imports={imports.map(item => ({ id: item.id, fileName: item.fileName, status: item.status, rowCount: item.rowCount, importedCount: item.importedCount, total: Number(item.currentMonthTotal), createdAt: item.createdAt.toISOString() }))} />;
}
