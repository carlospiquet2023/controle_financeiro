import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import { parseInstallment, parseBrazilianMoney } from "../lib/finance";

const prisma = new PrismaClient();
const path = process.argv[2];
const email = process.env.IMPORT_OWNER_EMAIL;
if (!path || !email) throw new Error("Uso: IMPORT_OWNER_EMAIL=seu@email npm run import:workbook -- caminho/planilha.xlsx");

const cardsByColor: Record<string, { name: string; color: string; lastFour?: string }> = {
  FFFFFF00: { name: "Casa Bahia", color: "#EAB308", lastFour: "4037" }, FFFF0000: { name: "Cartão Dom", color: "#E5484D" },
  FF92D050: { name: "Caixa 6553", color: "#65A30D", lastFour: "6553" }, FF00FFFF: { name: "Caixa 4013", color: "#06B6D4", lastFour: "4013" },
  FF00B0F0: { name: "Pernambucanas", color: "#0284C7" }, FF7030A0: { name: "Di Santini", color: "#7030A0" }, FF66FF: { name: "Ponto Mix", color: "#D946EF" },
};
const recurring = /fixo/i;
function rgb(cell: XLSX.CellObject | undefined) { return (cell?.s as { fill?: { fgColor?: { rgb?: string } } } | undefined)?.fill?.fgColor?.rgb?.toUpperCase(); }
function categoryFor(description: string) { const value = description.toLowerCase(); if (/99|corrida|pix/.test(value)) return "Transporte"; if (/comida|queijo|milho|japonesa/.test(value)) return "Alimentação"; if (/telefone|internet|anuidade/.test(value)) return "Assinaturas"; return "Outros"; }

async function main() {
  const user = await prisma.user.findUnique({ where: { email }, include: { memberships: true } });
  if (!user?.memberships[0]) throw new Error("Não encontrei um grupo financeiro para IMPORT_OWNER_EMAIL.");
  const householdId = user.memberships[0].householdId;
  const workbook = XLSX.readFile(path, { cellStyles: true, cellDates: true }); const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const cardCache = new Map<string, string>(); const categoryCache = new Map<string, string>();
  async function cardId(meta: { name: string; color: string; lastFour?: string }) { if (!cardCache.has(meta.name)) { const card = await prisma.card.upsert({ where: { id: `legacy-${meta.name}` }, create: { id: `legacy-${meta.name}`, householdId, ...meta }, update: { color: meta.color } }); cardCache.set(meta.name, card.id); } return cardCache.get(meta.name)!; }
  async function categoryId(name: string) { if (!categoryCache.has(name)) { const item = await prisma.category.upsert({ where: { householdId_name: { householdId, name } }, create: { householdId, name }, update: {} }); categoryCache.set(name, item.id); } return categoryCache.get(name)!; }
  const rows = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(sheet, { header: 1, defval: undefined }); let imported = 0;
  for (let index = 3; index < rows.length; index++) {
    const row = rows[index]; const description = String(row[0] ?? "").trim(); const value = parseBrazilianMoney(row[1]);
    if (!description || value === null || value <= 0) continue;
    const sheetRow = index + 1; const styleColor = rgb(sheet[`B${sheetRow}`]); const meta = styleColor ? cardsByColor[styleColor] : undefined;
    const installment = parseInstallment(row[2]); const isRecurring = recurring.test(String(row[2] ?? "")); const count = isRecurring ? 1 : installment.total;
    const current = isRecurring ? 1 : installment.current; const firstDate = new Date(2026, 6, 1);
    const card = meta ? await cardId(meta) : null; const category = await categoryId(categoryFor(description));
    for (let n = current; n <= count; n++) {
      const competenceDate = new Date(firstDate.getFullYear(), firstDate.getMonth() + (n - current), 1);
      const externalRef = `legacy-jul-2026-${sheetRow}-${n}`;
      await prisma.transaction.upsert({ where: { id: externalRef }, create: { id: externalRef, externalRef, householdId, cardId: card, categoryId: category, type: "EXPENSE", status: n === current ? "PENDING" : "PLANNED", description: count > 1 ? `${description} · ${n}/${count}` : description, amount: value, totalAmount: value * count, competenceDate, installmentNumber: n, installmentCount: count, recurring: isRecurring, notes: String(row[4] ?? "").trim() || null }, update: {} });
      imported++;
    }
  }
  console.log(`Importação concluída: ${imported} lançamentos criados. Revise os registros sem cor e complemente vencimentos/pessoas.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
