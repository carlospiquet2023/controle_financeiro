export function normalizeMatchText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenSimilarity(left: string, right: string) {
  const a = new Set(normalizeMatchText(left).split(" ").filter((item) => item.length > 1));
  const b = new Set(normalizeMatchText(right).split(" ").filter((item) => item.length > 1));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / new Set([...a, ...b]).size;
}

export function transactionMatchScore(external: { amount: number; date: Date; description: string }, internal: { amount: number; date: Date; description: string }) {
  const amountDifference = Math.abs(Math.abs(external.amount) - Math.abs(internal.amount));
  const amountScore = amountDifference <= 0.01 ? 1 : amountDifference <= 1 ? 0.7 : 0;
  const days = Math.abs(external.date.getTime() - internal.date.getTime()) / 86_400_000;
  const dateScore = days <= 0.5 ? 1 : days <= 1.5 ? 0.85 : days <= 3.5 ? 0.55 : 0;
  const textScore = tokenSimilarity(external.description, internal.description);
  const confidence = Math.round((amountScore * 0.55 + dateScore * 0.25 + textScore * 0.2) * 10_000) / 10_000;
  return { confidence, reasons: { amountDifference: Math.round(amountDifference * 100) / 100, dayDifference: Math.round(days * 10) / 10, textSimilarity: Math.round(textScore * 1000) / 1000 } };
}
