export const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
export const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
export const money = (value: number | string | { toString(): string }) => brl.format(Number(value));
export const asMonthStart = (date = new Date()) => new Date(date.getFullYear(), date.getMonth(), 1);
export const isoDate = (date: Date) => date.toISOString().slice(0, 10);
