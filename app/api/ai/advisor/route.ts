import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { calculateHealth, createEconomicAdvice, groundedAdviceCopy, type AdvisorSnapshot } from "@/lib/advisor";
import { releaseDailyAnalysis, reserveDailyAnalysis } from "@/lib/ai-quota";
import { requireMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { addUtcMonths, monthStartUtc } from "@/lib/format";
import { getEconomicIndicators } from "@/lib/economic-indicators";

const requestSchema = z.object({ message: z.string().trim().min(1).max(1200), month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/) });

export async function POST(request: Request) {
  let reservation: Awaited<ReturnType<typeof reserveDailyAnalysis>> | null = null;
  let reservedUserId: string | null = null;
  try {
    const { user, membership } = await requireMembership();
    const input = requestSchema.parse(await request.json());
    reservation = await reserveDailyAnalysis(user.id);
    reservedUserId = user.id;
    if (!reservation.allowed) return NextResponse.json({ error: "Você já usou as 5 análises de hoje. O limite será renovado amanhã.", usage: reservation }, { status: 429 });

    const month = monthStartUtc(input.month);
    const nextMonth = addUtcMonths(month, 1);
    const forecastEnd = addUtcMonths(month, 12);
    const [current, future, splits, economicContext] = await Promise.all([
      db.transaction.findMany({ where: { householdId: membership.householdId, competenceDate: { gte: month, lt: nextMonth }, status: { notIn: ["CANCELED", "REFUNDED"] } }, include: { category: true, card: true } }),
      db.transaction.findMany({ where: { householdId: membership.householdId, competenceDate: { gte: month, lt: forecastEnd }, type: "EXPENSE", status: { notIn: ["CANCELED", "REFUNDED"] } }, select: { amount: true, competenceDate: true } }),
      db.split.findMany({ where: { transaction: { householdId: membership.householdId, status: { notIn: ["CANCELED", "REFUNDED"] } }, status: { not: "PAID" } }, select: { amount: true, paidAmount: true } }),
      getEconomicIndicators().catch(() => []),
    ]);
    const expenses = current.filter((item) => item.type === "EXPENSE");
    const income = current.filter((item) => item.type === "INCOME").reduce((sum, item) => sum + Number(item.amount), 0);
    const expenseTotal = expenses.reduce((sum, item) => sum + Number(item.amount), 0);
    const group = <T extends string>(items: { key: T; amount: number }[]) => [...items.reduce((map, item) => map.set(item.key, (map.get(item.key) || 0) + item.amount), new Map<T, number>())].map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 })).sort((a, b) => b.amount - a.amount);
    const health = calculateHealth(income, expenseTotal);
    const snapshot: AdvisorSnapshot = {
      month: input.month,
      currentMonthIncome: income,
      currentMonthExpenses: expenseTotal,
      currentMonthExpenseCount: expenses.length,
      currentMonthPaidExpenses: expenses.filter((item) => item.status === "PAID").reduce((sum, item) => sum + Number(item.amount), 0),
      currentMonthPendingExpenses: expenses.filter((item) => item.status !== "PAID").reduce((sum, item) => sum + Number(item.amount), 0),
      currentMonthUnassignedExpenses: expenses.filter((item) => !item.cardId).reduce((sum, item) => sum + Number(item.amount), 0),
      currentMonthRecurringExpenses: expenses.filter((item) => item.recurring).reduce((sum, item) => sum + Number(item.amount), 0),
      categoryTotals: group(expenses.map((item) => ({ key: item.category?.name || "Sem categoria", amount: Number(item.amount) }))).slice(0, 8),
      cardTotals: group(expenses.map((item) => ({ key: item.card?.name || "Não identificado", amount: Number(item.amount) }))).slice(0, 12),
      futureExpenseCommitments: Array.from({ length: 12 }, (_, index) => { const date = addUtcMonths(month, index); return { month: date.toISOString().slice(0, 7), amount: future.filter((item) => item.competenceDate.getUTCFullYear() === date.getUTCFullYear() && item.competenceDate.getUTCMonth() === date.getUTCMonth()).reduce((sum, item) => sum + Number(item.amount), 0) }; }),
      futureExpenseCommitmentCount: future.filter((item) => item.competenceDate >= nextMonth).length,
      openFamilyReimbursements: splits.reduce((sum, item) => sum + Number(item.amount) - Number(item.paidAmount), 0),
      ...health,
      economicContext,
    };
    const generated = await createEconomicAdvice(input.message, snapshot);
    const grounded = groundedAdviceCopy(snapshot);
    const advice = { ...generated, ...grounded, riskLevel: snapshot.health };
    const adviceId = randomUUID();
    await db.auditLog.create({ data: { householdId: membership.householdId, actorId: user.id, entity: "EconomicAdvice", entityId: adviceId, action: "AI_ADVICE", after: { month: input.month, riskLevel: advice.riskLevel, commitmentRate: snapshot.commitmentRate, model: process.env.GROQ_MODEL || "openai/gpt-oss-120b", methodology: "finora-v1" } } });
    return NextResponse.json({ adviceId, advice, snapshot: { health: snapshot.health, commitmentRate: snapshot.commitmentRate, income: snapshot.currentMonthIncome, expenses: snapshot.currentMonthExpenses }, usage: { used: reservation.used, remaining: reservation.remaining, limit: reservation.limit } });
  } catch (error) {
    if (reservation?.allowed && reservedUserId) await releaseDailyAnalysis(reservedUserId, reservation.usageDate).catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível gerar a análise." }, { status: 400 });
  }
}
