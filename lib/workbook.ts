import * as XLSX from "xlsx";

export type ImportRow = {
  description: string;
  amount: number;
  type: "EXPENSE" | "INCOME";
  competenceDate: string;
  dueDate?: string;
  categoryName?: string;
  cardName?: string;
  cardColor?: string;
  accountName?: string;
  installmentCurrent: number;
  installmentCount: number;
  recurring?: boolean;
  notes?: string;
  source?: string;
  sourceRow?: number;
};

export type ImportGroup = {
  name: string;
  cardName?: string;
  color: string;
  expectedTotal: number;
  calculatedTotal: number;
  rowCount: number;
  matched: boolean;
};

export type ParsedWorkbook = {
  format: "FINORA_LEGACY" | "TABULAR";
  rows: ImportRow[];
  groups: ImportGroup[];
  expectedTotal: number;
  calculatedTotal: number;
  reconciled: boolean;
};

type CellStyle = { fill?: { fgColor?: { rgb?: string; theme?: number; tint?: number } } };

export function parseWorkbook(data: ArrayBuffer | Uint8Array, competenceDate: string, source: string): ParsedWorkbook {
  const workbook = XLSX.read(data, { type: "array", cellDates: true, cellStyles: true, cellFormula: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("A planilha não possui uma aba legível.");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
  if (isFinoraLegacy(matrix, sheet)) return parseFinoraLegacy(matrix, sheet, competenceDate, source);
  return parseTabular(matrix, competenceDate, source);
}

function isFinoraLegacy(rows: unknown[][], sheet: XLSX.WorkSheet) {
  const second = rows[1]?.map((cell) => normalize(String(cell))) ?? [];
  return second[0]?.startsWith("nome") && second[1]?.includes("valor a pagar") && second.some((value) => value.includes("total a paga")) && Object.keys(sheet).some((key) => /^H\d+$/.test(key) && normalize(String(sheet[key]?.v ?? "")).includes("cartao"));
}

function parseFinoraLegacy(rows: unknown[][], sheet: XLSX.WorkSheet, competenceDate: string, source: string): ParsedWorkbook {
  const summary = extractLegacySummary(sheet);
  const parsedRows: ImportRow[] = [];
  for (let index = 3; index < rows.length; index++) {
    const row = rows[index];
    const description = String(row?.[0] ?? "").trim();
    const amount = parseMoney(row?.[1]);
    if (!description || amount === null || amount <= 0) continue;
    const sheetRow = index + 1;
    const group = summary.find((item) => item.startRow !== undefined && sheetRow >= item.startRow && sheetRow <= item.endRow!);
    const installmentText = String(row?.[2] ?? "");
    const installment = parseInstallment(installmentText);
    parsedRows.push({
      description,
      amount: cents(amount),
      type: "EXPENSE",
      competenceDate,
      categoryName: categoryFor(description),
      cardName: group?.cardName,
      cardColor: group?.color,
      installmentCurrent: installment.current,
      installmentCount: installment.total,
      recurring: /fixo/i.test(installmentText),
      notes: String(row?.[4] ?? "").trim() || undefined,
      source,
      sourceRow: sheetRow,
    });
  }

  const groups = summary.map((item) => {
    const groupRows = parsedRows.filter((row) => row.sourceRow && item.startRow !== undefined && row.sourceRow >= item.startRow && row.sourceRow <= item.endRow!);
    const calculatedTotal = cents(groupRows.reduce((sum, row) => sum + row.amount, 0));
    return { name: item.name, cardName: item.cardName, color: item.color, expectedTotal: item.expectedTotal, calculatedTotal, rowCount: groupRows.length, matched: toCents(item.expectedTotal) === toCents(calculatedTotal) };
  });
  const calculatedTotal = cents(parsedRows.reduce((sum, row) => sum + row.amount, 0));
  const expectedTotal = cents(groups.reduce((sum, group) => sum + group.expectedTotal, 0));
  return { format: "FINORA_LEGACY", rows: parsedRows, groups, expectedTotal, calculatedTotal, reconciled: groups.every((group) => group.matched) && toCents(expectedTotal) === toCents(calculatedTotal) };
}

function extractLegacySummary(sheet: XLSX.WorkSheet) {
  const result: { name: string; cardName?: string; color: string; expectedTotal: number; startRow?: number; endRow?: number }[] = [];
  for (let row = 3; row <= 40; row++) {
    const rawName = String(sheet[`H${row}`]?.v ?? "").trim();
    if (!rawName) continue;
    const expectedTotal = cents(parseMoney(sheet[`F${row}`]?.v) ?? 0);
    const formula = String(sheet[`F${row}`]?.f ?? "");
    const range = formula.match(/B(\d+)(?::B(\d+))?/i);
    const unknown = /nao sei|não sei|internet e outros/i.test(rawName);
    const cleanName = unknown ? "Não identificado" : titleCase(rawName.replace(/^cart[aã]o\s+/i, "").trim());
    result.push({
      name: cleanName,
      cardName: unknown ? undefined : cleanName,
      color: colorFromCell(sheet[`G${row}`], unknown ? "#64748B" : "#5269E8"),
      expectedTotal,
      startRow: range ? Number(range[1]) : undefined,
      endRow: range ? Number(range[2] || range[1]) : undefined,
    });
  }
  if (!result.length) throw new Error("Não encontrei o resumo por cartão da planilha.");
  return result;
}

function parseTabular(rows: unknown[][], competenceDate: string, source: string): ParsedWorkbook {
  const headerIndex = rows.findIndex((row) => row.some((cell) => /descri[cç][aã]o|lan[cç]amento|hist[oó]rico/i.test(String(cell))) && row.some((cell) => /^\s*(valor|pre[cç]o|total)\s*$/i.test(String(cell))));
  if (headerIndex < 0) throw new Error("Não encontrei cabeçalhos de descrição e valor. Use o modelo original ou um CSV com cabeçalhos.");
  const headers = rows[headerIndex].map((cell) => normalize(String(cell)));
  const parsedRows = rows.slice(headerIndex + 1).map((row, offset) => rowFromColumns(row, headers, competenceDate, source, headerIndex + offset + 2)).filter(Boolean) as ImportRow[];
  const calculatedTotal = cents(parsedRows.reduce((sum, row) => sum + row.amount, 0));
  const byGroup = new Map<string, ImportGroup>();
  for (const row of parsedRows) {
    const name = row.cardName || "Não identificado";
    const existing = byGroup.get(name) || { name, cardName: row.cardName, color: row.cardColor || "#64748B", expectedTotal: 0, calculatedTotal: 0, rowCount: 0, matched: true };
    existing.calculatedTotal = cents(existing.calculatedTotal + row.amount);
    existing.expectedTotal = existing.calculatedTotal;
    existing.rowCount++;
    byGroup.set(name, existing);
  }
  return { format: "TABULAR", rows: parsedRows, groups: [...byGroup.values()], expectedTotal: calculatedTotal, calculatedTotal, reconciled: parsedRows.length > 0 };
}

function rowFromColumns(row: unknown[], headers: string[], competenceDate: string, source: string, sourceRow: number): ImportRow | null {
  const get = (...names: string[]) => {
    const index = headers.findIndex((header) => !header.includes("total a pagar") && names.some((name) => header === name || header.startsWith(`${name} `)));
    return index >= 0 ? row[index] : "";
  };
  const description = String(get("descricao", "lancamento", "historico", "nome")).trim();
  const amount = parseMoney(get("valor", "preco", "total"));
  if (!description || amount === null || amount <= 0) return null;
  const installmentText = get("parcela", "parcelamento");
  const installment = parseInstallment(installmentText);
  return {
    description,
    amount: cents(amount),
    type: normalize(String(get("tipo"))).includes("receita") ? "INCOME" : "EXPENSE",
    competenceDate,
    dueDate: parseDate(get("vencimento", "data")),
    categoryName: String(get("categoria")).trim() || undefined,
    cardName: String(get("cartao")).trim() || undefined,
    accountName: String(get("conta")).trim() || undefined,
    installmentCurrent: installment.current,
    installmentCount: installment.total,
    recurring: /fixo|recorrente/i.test(String(installmentText)),
    notes: String(get("observacao", "obs", "nota")).trim() || undefined,
    source,
    sourceRow,
  };
}

function colorFromCell(cell: XLSX.CellObject | undefined, fallback: string) {
  const fill = (cell?.s as CellStyle | undefined)?.fill?.fgColor;
  if (fill?.rgb) return `#${fill.rgb.slice(-6).toUpperCase()}`;
  if (fill?.theme === 0) return fill.tint && fill.tint < 0 ? "#64748B" : "#111827";
  if (fill?.theme === 2) return "#A8A29E";
  return fallback;
}

export function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function parseMoney(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const clean = String(value ?? "").replace(/R\$\s?/gi, "").replace(/\s/g, "");
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseInstallment(value: unknown) {
  const match = String(value ?? "").match(/(\d+)\s*(?:de|\/)\s*(\d+)/i);
  if (!match) return { current: 1, total: 1 };
  const current = Math.max(Number(match[1]), 1);
  const total = Math.max(Number(match[2]), current);
  return { current, total };
}

function parseDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return localIsoDate(value);
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return localIsoDate(new Date(parsed.y, parsed.m - 1, parsed.d));
  }
  const match = String(value ?? "").match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!match) return undefined;
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  return localIsoDate(new Date(year, Number(match[2]) - 1, Number(match[1])));
}

function categoryFor(description: string) {
  const value = normalize(description);
  if (/mercado|comida|queijo|milho|restaurante|lanche|padaria/.test(value)) return "Alimentação";
  if (/99|corrida|uber|combust|transporte/.test(value)) return "Transporte";
  if (/internet|telefone|anuidade|assinatura/.test(value)) return "Contas fixas";
  if (/hotel|praia|viagem/.test(value)) return "Viagens";
  if (/roupa|casaco|tenis|perfume|renner|pernambucanas/.test(value)) return "Compras";
  return "Outros";
}

function titleCase(value: string) {
  const small = new Set(["da", "de", "do", "das", "dos", "e"]);
  return value.toLocaleLowerCase("pt-BR").split(/\s+/).map((word, index) => index > 0 && small.has(word) ? word : `${word.charAt(0).toLocaleUpperCase("pt-BR")}${word.slice(1)}`).join(" ");
}

const cents = (value: number) => Math.round(value * 100) / 100;
const toCents = (value: number) => Math.round(value * 100);
const localIsoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
