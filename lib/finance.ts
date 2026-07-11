export function installmentSchedule(total: number, count: number, firstDate: Date) {
  const centavos = Math.round(total * 100);
  const base = Math.floor(centavos / count);
  const remainder = centavos % count;
  return Array.from({ length: count }, (_, index) => ({
    installmentNumber: index + 1,
    amount: (base + (index < remainder ? 1 : 0)) / 100,
    competenceDate: new Date(firstDate.getFullYear(), firstDate.getMonth() + index, 1),
  }));
}

export function parseBrazilianMoney(value: unknown) {
  if (typeof value === "number") return value;
  const cleaned = String(value ?? "").replace(/R\$\s?/gi, "").replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseInstallment(value: unknown) {
  const match = String(value ?? "").match(/(\d+)\s*(?:de|\/)\s*(\d+)/i);
  return match ? { current: Number(match[1]), total: Number(match[2]) } : { current: 1, total: 1 };
}
