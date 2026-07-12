export const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
export const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
export const money = (value: number | string | { toString(): string }) => brl.format(Number(value));
export const monthStartUtc = (month: string) => new Date(`${month}-01T00:00:00.000Z`);
export const addUtcMonths = (date: Date, amount: number) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
export const saoPauloMonth = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(date);
export const isoDate = (date: Date) => date.toISOString().slice(0, 10);
