import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { asMonthStart } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  if (!user?.memberships[0]) redirect("/entrar");
  const householdId = user.memberships[0].householdId;
  const month = asMonthStart(); const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const forecastEnd = new Date(month.getFullYear() + 1, month.getMonth() + 1, 1);
  const [accounts, cards, categories, monthTransactions, futureTransactions, openSplits] = await Promise.all([
    db.account.findMany({ where: { householdId, active: true }, orderBy: { name: "asc" } }),
    db.card.findMany({ where: { householdId, active: true }, orderBy: { name: "asc" } }),
    db.category.findMany({ where: { householdId }, orderBy: { name: "asc" } }),
    db.transaction.findMany({ where: { householdId, competenceDate: { gte: month, lt: nextMonth } }, include: { card: true, category: true, responsiblePerson: true }, orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }], take: 12 }),
    db.transaction.findMany({ where: { householdId, competenceDate: { gte: month, lt: forecastEnd }, type: "EXPENSE", status: { notIn: ["CANCELED", "REFUNDED"] } }, select: { amount: true, competenceDate: true } }),
    db.split.findMany({ where: { transaction: { householdId }, status: { not: "PAID" } }, include: { person: true } }),
  ]);
  return <Dashboard userName={user.name} accounts={accounts.map(a => ({ ...a, openingBalance: Number(a.openingBalance) }))} cards={cards.map(c => ({ ...c, creditLimit: Number(c.creditLimit) }))} categories={categories} transactions={monthTransactions.map(t => ({ ...t, amount: Number(t.amount), totalAmount: t.totalAmount ? Number(t.totalAmount) : null, card: t.card ? { name: t.card.name, color: t.card.color } : null, category: t.category?.name ?? "Sem categoria", responsiblePerson: t.responsiblePerson?.name ?? null, dueDate: t.dueDate?.toISOString() ?? null, competenceDate: t.competenceDate.toISOString() }))} forecast={futureTransactions.map(t => ({ amount: Number(t.amount), competenceDate: t.competenceDate.toISOString() }))} receivables={openSplits.map(s => ({ person: s.person.name, amount: Number(s.amount) - Number(s.paidAmount) }))} />;
}
