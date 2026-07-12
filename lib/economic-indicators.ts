import { db } from "@/lib/db";

const SOURCE = "Banco Central do Brasil — SGS";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const ECONOMIC_SERIES = [
  { code: "432", name: "Meta Selic", unit: "% ao ano" },
  { code: "433", name: "IPCA mensal", unit: "% ao mês" },
  { code: "25435", name: "Crédito para pessoas físicas — média total", unit: "% ao mês" },
  { code: "25464", name: "Crédito pessoal não consignado", unit: "% ao mês" },
  { code: "25477", name: "Cartão de crédito rotativo", unit: "% ao mês" },
  { code: "25478", name: "Cartão de crédito parcelado", unit: "% ao mês" },
  { code: "25463", name: "Cheque especial", unit: "% ao mês" },
] as const;

function parseBcbDate(value: string) {
  const [day, month, year] = value.split("/").map(Number);
  if (!day || !month || !year) throw new Error("Data inválida do SGS.");
  return new Date(Date.UTC(year, month - 1, day));
}

async function fetchSeries(definition: typeof ECONOMIC_SERIES[number]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${definition.code}/dados/ultimos/1?formato=json`, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`SGS ${definition.code} indisponível.`);
    const rows = await response.json() as { data?: string; valor?: string }[];
    const latest = rows[0];
    const value = Number(String(latest?.valor || "").replace(",", "."));
    if (!latest?.data || !Number.isFinite(value)) throw new Error(`SGS ${definition.code} retornou dados inválidos.`);
    const date = parseBcbDate(latest.data);
    return db.economicIndicator.upsert({
      where: { code_date: { code: definition.code, date } },
      create: { code: definition.code, name: definition.name, unit: definition.unit, date, value, source: SOURCE },
      update: { name: definition.name, unit: definition.unit, value, source: SOURCE, fetchedAt: new Date() },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function getEconomicIndicators() {
  const existing = await Promise.all(ECONOMIC_SERIES.map((item) => db.economicIndicator.findFirst({ where: { code: item.code }, orderBy: [{ date: "desc" }, { fetchedAt: "desc" }] })));
  const refreshed = await Promise.all(ECONOMIC_SERIES.map(async (definition, index) => {
    const cached = existing[index];
    if (cached && Date.now() - cached.fetchedAt.getTime() < MAX_AGE_MS) return cached;
    try { return await fetchSeries(definition); } catch { return cached; }
  }));
  return refreshed.filter((item): item is NonNullable<typeof item> => Boolean(item)).map((item) => ({ code: item.code, name: item.name, unit: item.unit, date: item.date.toISOString().slice(0, 10), value: Number(item.value), source: item.source, fetchedAt: item.fetchedAt.toISOString() }));
}
