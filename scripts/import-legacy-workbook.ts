import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { PrismaClient } from "@prisma/client";
import { parseWorkbook } from "../lib/workbook";
import { uploadObject } from "../lib/r2";

const workbookPath = process.argv.find((argument) => /\.(xlsx|xls|csv)$/i.test(argument));
const replaceLegacy = process.argv.includes("--replace-legacy");
if (!workbookPath) throw new Error("Uso: npm run import:workbook -- caminho/planilha.xlsx [--replace-legacy]");

const databaseUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_PUBLIC_URL ou DATABASE_URL precisa estar configurada.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

async function main(path: string) {
  let owners = await prisma.user.findMany({ where: process.env.IMPORT_OWNER_EMAIL ? { email: process.env.IMPORT_OWNER_EMAIL } : { memberships: { some: { role: "OWNER" } } }, include: { memberships: { where: { role: "OWNER" } } } });
  if (!process.env.IMPORT_OWNER_EMAIL && owners.length > 1) {
    const candidates = [];
    for (const owner of owners) {
      for (const membership of owner.memberships) {
        const legacyRows = await prisma.transaction.count({ where: { householdId: membership.householdId, importBatchId: null, externalRef: { startsWith: "import-" } } });
        if (legacyRows > 0) candidates.push({ ...owner, memberships: [membership] });
      }
    }
    owners = candidates;
  }
  if (owners.length !== 1 || !owners[0].memberships[0]) throw new Error("Defina IMPORT_OWNER_EMAIL quando houver zero ou mais de um proprietário.");
  const user = owners[0];
  const householdId = user.memberships[0].householdId;
  const file = readFileSync(path);
  const sourceHash = createHash("sha256").update(file).digest("hex");
  const parsed = parseWorkbook(file, "2026-07-01", basename(path));
  if (!parsed.reconciled) throw new Error("Importação bloqueada: os totais por cartão não fecham.");
  const existing = await prisma.importBatch.findFirst({ where: { householdId, sourceHash, status: "IMPORTED" } });
  if (existing && !replaceLegacy) throw new Error("Esta planilha já possui um lote ativo.");

  let sourceKey: string | null = existing?.sourceKey || null;
  if (!sourceKey && process.env.R2_ACCOUNT_ID && process.env.R2_BUCKET) {
    sourceKey = `households/${householdId}/imports/2026-07-01/${randomUUID()}.${basename(path).split(".").pop() || "xlsx"}`;
    await uploadObject(sourceKey, file, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { sha256: sourceHash, originalname: encodeURIComponent(basename(path)) });
  }

  const result = await prisma.$transaction(async (tx) => {
    let removedTransactions = 0;
    let removedCards = 0;
    if (replaceLegacy) {
      const activeBatches = await tx.importBatch.findMany({ where: { householdId, status: "IMPORTED" }, select: { id: true } });
      for (const batch of activeBatches) {
        const removed = await tx.transaction.deleteMany({ where: { importBatchId: batch.id } });
        removedTransactions += removed.count;
        await tx.importBatch.update({ where: { id: batch.id }, data: { status: "ROLLED_BACK", rolledBackAt: new Date() } });
      }
      const legacy = await tx.transaction.deleteMany({ where: { householdId, importBatchId: null, externalRef: { startsWith: "import-" } } });
      removedTransactions += legacy.count;
      const numericCards = await tx.card.findMany({ where: { householdId }, include: { _count: { select: { transactions: true } } } });
      const removable = numericCards.filter((card) => /^\d+(?:\.\d+)?$/.test(card.name.trim()) && card._count.transactions === 0).map((card) => card.id);
      if (removable.length) removedCards = (await tx.card.deleteMany({ where: { id: { in: removable } } })).count;
    }

    const batch = await tx.importBatch.create({ data: { householdId, actorId: user.id, fileName: basename(path), sourceKey, sourceHash, competenceDate: new Date("2026-07-01T12:00:00"), rowCount: parsed.rows.length, importedCount: 0, currentMonthTotal: parsed.calculatedTotal, reconciliation: { groups: parsed.groups, expectedTotal: parsed.expectedTotal, calculatedTotal: parsed.calculatedTotal } } });
    const categoryCache = new Map<string, string>();
    const cardCache = new Map<string, string>();
    async function categoryId(name: string) {
      if (!categoryCache.has(name)) { const item = await tx.category.upsert({ where: { householdId_name: { householdId, name } }, create: { householdId, name }, update: {} }); categoryCache.set(name, item.id); }
      return categoryCache.get(name)!;
    }
    async function cardId(name?: string, color?: string) {
      if (!name) return null;
      if (!cardCache.has(name)) { const id = `import-card-${createHash("sha1").update(`${householdId}-${name}`).digest("hex").slice(0, 20)}`; const item = await tx.card.upsert({ where: { id }, create: { id, householdId, name, color: color || "#5269E8" }, update: { name, color: color || "#5269E8", active: true } }); cardCache.set(name, item.id); }
      return cardCache.get(name)!;
    }
    for (const group of parsed.groups) if (group.cardName) await cardId(group.cardName, group.color);
    let imported = 0;
    for (const row of parsed.rows) {
      const category = await categoryId(row.categoryName || "Outros");
      const card = await cardId(row.cardName, row.cardColor);
      const current = Math.min(row.installmentCurrent, row.installmentCount);
      const occurrences = row.recurring ? 12 : row.installmentCount - current + 1;
      const baseDate = new Date(`${row.competenceDate}T12:00:00`);
      for (let offset = 0; offset < occurrences; offset++) {
        const installment = row.recurring ? 1 : current + offset;
        const id = `workbook-${createHash("sha1").update(`${householdId}|${sourceHash}|${row.sourceRow}|${offset}`).digest("hex").slice(0, 24)}`;
        await tx.transaction.create({ data: { id, externalRef: id, importBatchId: batch.id, householdId, cardId: card, categoryId: category, type: row.type, status: offset === 0 ? "PENDING" : "PLANNED", description: row.recurring ? row.description : row.installmentCount > 1 ? `${row.description} · ${installment}/${row.installmentCount}` : row.description, amount: row.amount, totalAmount: row.recurring ? null : row.amount * row.installmentCount, competenceDate: new Date(baseDate.getFullYear(), baseDate.getMonth() + offset, 1), dueDate: row.dueDate ? new Date(`${row.dueDate}T12:00:00`) : null, installmentNumber: installment, installmentCount: row.installmentCount, recurring: row.recurring, notes: row.notes || null } });
        imported++;
      }
    }
    await tx.importBatch.update({ where: { id: batch.id }, data: { importedCount: imported } });
    await tx.auditLog.create({ data: { householdId, actorId: user.id, entity: "Import", entityId: batch.id, action: replaceLegacy ? "REPLACE_LEGACY_IMPORT" : "IMPORT_TRANSACTIONS", after: { imported, removedTransactions, removedCards, currentMonthTotal: parsed.calculatedTotal, reconciled: true } } });
    return { imported, removedTransactions, removedCards, batchId: batch.id };
  }, { maxWait: 10_000, timeout: 60_000 });
  console.log(JSON.stringify({ ok: true, rows: parsed.rows.length, currentMonthTotal: parsed.calculatedTotal, groups: parsed.groups.length, ...result }));
}

main(workbookPath).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
