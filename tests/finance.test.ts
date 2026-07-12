import assert from "node:assert/strict";
import test from "node:test";
import { installmentSchedule, parseBrazilianMoney, parseInstallment } from "../lib/finance";
import { parseMoney } from "../lib/workbook";
import { calculateHealth } from "../lib/advisor";

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
