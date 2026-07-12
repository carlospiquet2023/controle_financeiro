import assert from "node:assert/strict";
import test from "node:test";
import { installmentSchedule, parseBrazilianMoney, parseInstallment } from "../lib/finance";
import { parseMoney } from "../lib/workbook";
import { calculateHealth, groundedAdviceCopy, type AdvisorSnapshot } from "../lib/advisor";
import { DAILY_AI_ANALYSIS_LIMIT, saoPauloUsageDate } from "../lib/ai-quota";
import { addUtcMonths, monthStartUtc } from "../lib/format";

test("parcelamento preserva o total exato em centavos", () => {
  const schedule = installmentSchedule(100, 3, new Date(2026, 6, 1));
  assert.deepEqual(schedule.map((item) => item.amount), [33.34, 33.33, 33.33]);
  assert.equal(Math.round(schedule.reduce((sum, item) => sum + item.amount, 0) * 100), 10000);
  assert.deepEqual(schedule.map((item) => item.competenceDate.getMonth()), [6, 7, 8]);
});

test("valores brasileiros são interpretados sem perder centavos", () => {
  assert.equal(parseBrazilianMoney("R$ 1.372,18"), 1372.18);
  assert.equal(parseMoney("161,94"), 161.94);
  assert.equal(parseMoney(104.21), 104.21);
});

test("parcelas aceitam os formatos usados na planilha", () => {
  assert.deepEqual(parseInstallment("6 de 10"), { current: 6, total: 10 });
  assert.deepEqual(parseInstallment("1/3"), { current: 1, total: 3 });
  assert.deepEqual(parseInstallment("FIXO"), { current: 1, total: 1 });
});

test("semáforo só classifica quando existe renda registrada", () => {
  assert.deepEqual(calculateHealth(0, 1372.18), { health: "INCOMPLETE", commitmentRate: null });
  assert.deepEqual(calculateHealth(5000, 3500), { health: "GREEN", commitmentRate: 70 });
  assert.deepEqual(calculateHealth(5000, 4300), { health: "ORANGE", commitmentRate: 86 });
  assert.deepEqual(calculateHealth(5000, 5200), { health: "RED", commitmentRate: 104 });
});

test("conselho nunca apresenta compromissos futuros como recebimentos", () => {
  const snapshot: AdvisorSnapshot = {
    month: "2026-07",
    currentMonthIncome: 0,
    currentMonthExpenses: 1372.18,
    currentMonthExpenseCount: 18,
    currentMonthPaidExpenses: 0,
    currentMonthPendingExpenses: 1372.18,
    currentMonthUnassignedExpenses: 0,
    currentMonthRecurringExpenses: 10,
    categoryTotals: [],
    cardTotals: [],
    futureExpenseCommitments: [{ month: "2026-07", amount: 1372.18 }, { month: "2026-08", amount: 800.87 }],
    futureExpenseCommitmentCount: 6,
    openFamilyReimbursements: 0,
    health: "INCOMPLETE",
    commitmentRate: null,
  };
  const advice = groundedAdviceCopy(snapshot);
  assert.match(advice.summary, /despesas já comprometidas, não recebimentos/);
  assert.match(advice.summary, /Não há valores a receber/);
  assert.equal(advice.insights.find((item) => item.amount === 800.87)?.title, "Despesas futuras já comprometidas");
});

test("limite diário usa a data de São Paulo", () => {
  assert.equal(DAILY_AI_ANALYSIS_LIMIT, 5);
  assert.equal(saoPauloUsageDate(new Date("2026-07-12T02:30:00.000Z")).toISOString(), "2026-07-11T00:00:00.000Z");
});

test("mês financeiro inclui lançamentos do primeiro dia à meia-noite", () => {
  const july = monthStartUtc("2026-07");
  assert.equal(july.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(addUtcMonths(july, 1).toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(new Date("2026-07-01T00:00:00.000Z") >= july, true);
});
