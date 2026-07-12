import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { calculateHealth, createEconomicAdvice, type AdvisorSnapshot } from "@/lib/advisor";
import { requireMembership } from "@/lib/auth";
import { db } from "@/lib/db";

const requestSchema = z.object({ message: z.string().trim().min(4).max(1200), month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/) });

export async function POST(request: Request) {
  try {
    const { user, membership } = await requireMembership();
    const input = requestSchema.parse(await request.json());
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const used = await db.auditLog.count({ where: { householdId: membership.householdId, actorId: user.id, action: "AI_ADVICE", createdAt: { gte: hourAgo } } });
    if (used >= 20) return NextResponse.json({ error: "Limite de 20 análises por hora atingido. Tente novamente em breve." }, { status: 429 });

    const month = new Date(`${input.month}-01T12:00:00`);
    const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const forecastEnd = new Date(month.getFullYear(), month.getMonth() + 12, 1);
    const [current, future, splits] = await Promise.all([
      db.transaction.findMany({ where: { householdId: membership.householdId, competenceDate: { gte: month, lt: nextMonth }, status: { notIn: ["CANCELED", "REFUNDED"] } }, include: { category: true, card: true } }),
      db.transaction.findMany({ where: { householdId: membership.householdId, competenceDate: { gte: month, lt: forecastEnd }, type: "EXPENSE", status: { notIn: ["CANCELED", "REFUNDED"] } }, select: { amount: true, competenceDate: true } }),
      db.split.findMany({ where: { transaction: { householdId: membership.householdId }, status: { not: "PAID" } }, select: { amount: true, paidAmount: true } }),
    ]);
    const expenses = current.filter((item) => item.type === "EXPENSE");
    const income = current.filter((item) => item.type === "INCOME").reduce((sum, item) => sum + Number(item.amount), 0);
    const expenseTotal = expenses.reduce((sum, item) => sum + Number(item.amount), 0);
    const group = <T extends string>(items: { key: T; amount: number }[]) => [...items.reduce((map, item) => map.set(item.key, (map.get(item.key) || 0) + item.amount), new Map<T, number>())].map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 })).sort((a, b) => b.amount - a.amount);
    const health = calculateHealth(income, expenseTotal);
    const snapshot: AdvisorSnapshot = {
      month: input.month, income, expenses: expenseTotal,
      paid: expenses.filter((item) => item.status === "PAID").reduce((sum, item) => sum + Number(item.amount), 0),
      pending: expenses.filter((item) => item.status !== "PAID").reduce((sum, item) => sum + Number(item.amount), 0),
      unassigned: expenses.filter((item) => !item.cardId).reduce((sum, item) => sum + Number(item.amount), 0),
      recurring: expenses.filter((item) => item.recurring).reduce((sum, item) => sum + Number(item.amount), 0),
      categoryTotals: group(expenses.map((item) => ({ key: item.category?.name || "Sem categoria", amount: Number(item.amount) }))).slice(0, 8),
      cardTotals: group(expenses.map((item) => ({ key: item.card?.name || "Não identificado", amount: Number(item.amount) }))).slice(0, 12),
      forecast: Array.from({ length: 12 }, (_, index) => { const date = new Date(month.getFullYear(), month.getMonth() + index, 1); return { month: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`, amount: future.filter((item) => item.competenceDate.getFullYear() === date.getFullYear() && item.competenceDate.getMonth() === date.getMonth()).reduce((sum, item) => sum + Number(item.amount), 0) }; }),
      receivable: splits.reduce((sum, item) => sum + Number(item.amount) - Number(item.paidAmount), 0), ...health,
    };
    const generated = await createEconomicAdvice(input.message, snapshot);
    const allowedAmounts = new Set([snapshot.income, snapshot.expenses, snapshot.paid, snapshot.pending, snapshot.unassigned, snapshot.recurring, snapshot.receivable, ...snapshot.categoryTotals.map((item) => item.amount), ...snapshot.cardTotals.map((item) => item.amount), ...snapshot.forecast.map((item) => item.amount)].map((value) => Math.round(value * 100)));
    const advice = { ...generated, riskLevel: snapshot.health, insights: generated.insights.map((item) => ({ ...item, amount: item.amount !== null && allowedAmounts.has(Math.round(item.amount * 100)) ? item.amount : null })) };
    const adviceId = randomUUID();
    await db.auditLog.create({ data: { householdId: membership.householdId, actorId: user.id, entity: "EconomicAdvice", entityId: adviceId, action: "AI_ADVICE", after: { month: input.month, riskLevel: advice.riskLevel, commitmentRate: snapshot.commitmentRate, model: process.env.GROQ_MODEL || "openai/gpt-oss-120b", methodology: "finora-v1" } } });
    return NextResponse.json({ adviceId, advice, snapshot: { health: snapshot.health, commitmentRate: snapshot.commitmentRate, income: snapshot.income, expenses: snapshot.expenses } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível gerar a análise." }, { status: 400 }); }
}
