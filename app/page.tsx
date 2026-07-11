import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { asMonthStart } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await currentUser();
  if (!user?.memberships[0]) redirect("/entrar");
  const membership = user.memberships[0];
  const householdId = membership.householdId;
  const requested = (await searchParams).month;
  const validMonth = requested && /^20\d{2}-(0[1-9]|1[0-2])$/.test(requested) ? requested : null;
  const month = validMonth ? new Date(`${validMonth}-01T12:00:00`) : asMonthStart();
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const forecastEnd = new Date(month.getFullYear() + 1, month.getMonth(), 1);
  const [household, accounts, cards, categories, people, monthTransactions, futureTransactions, openSplits, imports] = await Promise.all([
    db.household.findUniqueOrThrow({ where: { id: householdId }, select: { name: true } }),
    db.account.findMany({ where: { householdId, active: true }, orderBy: { name: "asc" } }),
    db.card.findMany({ where: { householdId, active: true }, orderBy: { name: "asc" } }),
    db.category.findMany({ where: { householdId }, orderBy: { name: "asc" } }),
    db.person.findMany({ where: { householdId, active: true }, orderBy: { name: "asc" } }),
    db.transaction.findMany({ where: { householdId, competenceDate: { gte: month, lt: nextMonth } }, include: { card: true, category: true, responsiblePerson: true }, orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }], take: 100 }),
    db.transaction.findMany({ where: { householdId, competenceDate: { gte: month, lt: forecastEnd }, type: "EXPENSE", status: { notIn: ["CANCELED", "REFUNDED"] } }, select: { amount: true, competenceDate: true } }),
    db.split.findMany({ where: { transaction: { householdId }, status: { not: "PAID" } }, include: { person: true } }),
    db.importBatch.findMany({ where: { householdId }, orderBy: { createdAt: "desc" }, take: 12 }),
  ]);
  const selectedMonth = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-01`;
  return <Dashboard userName={user.name} householdName={household.name} selectedMonth={selectedMonth} accounts={accounts.map(a => ({ ...a, openingBalance: Number(a.openingBalance) }))} cards={cards.map(c => ({ ...c, creditLimit: Number(c.creditLimit) }))} categories={categories} people={people} transactions={monthTransactions.map(t => ({ ...t, amount: Number(t.amount), totalAmount: t.totalAmount ? Number(t.totalAmount) : null, card: t.card ? { id: t.card.id, name: t.card.name, color: t.card.color } : null, category: t.category?.name ?? "Sem categoria", responsiblePerson: t.responsiblePerson?.name ?? null, dueDate: t.dueDate?.toISOString() ?? null, competenceDate: t.competenceDate.toISOString() }))} forecast={futureTransactions.map(t => ({ amount: Number(t.amount), competenceDate: t.competenceDate.toISOString() }))} receivables={openSplits.map(s => ({ person: s.person.name, amount: Number(s.amount) - Number(s.paidAmount) }))} imports={imports.map(item => ({ id: item.id, fileName: item.fileName, status: item.status, rowCount: item.rowCount, importedCount: item.importedCount, total: Number(item.currentMonthTotal), createdAt: item.createdAt.toISOString() }))} />;
}
