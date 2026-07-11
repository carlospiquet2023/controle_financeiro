"use server";

import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clearSession, createSession, requireMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { installmentSchedule } from "@/lib/finance";

const credentials = z.object({ name: z.string().trim().min(2).max(80).optional(), email: z.string().trim().email(), password: z.string().min(10).max(128) });
type AuthState = { error?: string };
type TransactionState = { error?: string; success?: boolean };
type ImportState = { error?: string; imported?: number; skipped?: number; batchId?: string };
export type ActionState = { error?: string; success?: boolean };

export async function authenticate(_: AuthState, formData: FormData): Promise<AuthState> {
  const result = credentials.safeParse(Object.fromEntries(formData));
  if (!result.success) return { error: "Use um e-mail válido e uma senha com no mínimo 10 caracteres." };
  const { email, password, name } = result.data;
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    const valid = await bcrypt.compare(password, existing.passwordHash);
    if (!valid) return { error: "E-mail ou senha incorretos." };
    await createSession(existing.id);
    redirect("/");
  }
  if (!name) return { error: "Esta conta ainda não existe. Informe seu nome para criá-la." };
  const user = await db.user.create({ data: { name, email, passwordHash: await bcrypt.hash(password, 12), memberships: { create: { role: "OWNER", household: { create: { name: `Família de ${name}` } } } } } });
  await createSession(user.id);
  redirect("/");
}

export async function logout() { await clearSession(); redirect("/entrar"); }

const transactionSchema = z.object({
  description: z.string().trim().min(2).max(120), amount: z.coerce.number().positive(), type: z.enum(["EXPENSE", "INCOME"]),
  competenceDate: z.string().date(), dueDate: z.string().date().optional().or(z.literal("")), cardId: z.string().optional().or(z.literal("")), accountId: z.string().optional().or(z.literal("")),
  categoryId: z.string().optional().or(z.literal("")), splitPersonId: z.string().optional().or(z.literal("")), splitAmount: z.coerce.number().nonnegative().default(0), installmentCount: z.coerce.number().int().min(1).max(360).default(1), notes: z.string().max(1000).optional(),
}).superRefine((data, context) => { if (data.splitAmount > data.amount) context.addIssue({ code: "custom", path: ["splitAmount"], message: "O valor a devolver não pode superar a compra." }); if (data.splitAmount > 0 && !data.splitPersonId) context.addIssue({ code: "custom", path: ["splitPersonId"], message: "Selecione quem precisa devolver." }); });

export async function createTransaction(_: TransactionState, formData: FormData): Promise<TransactionState> {
  const parsed = transactionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Confira descrição, valor e data do lançamento." };
  const { user, membership } = await requireMembership();
  if (membership.role === "VIEWER" || membership.role === "GUEST") return { error: "Seu perfil não tem permissão para criar lançamentos." };
  const data = parsed.data;
  const firstDate = new Date(`${data.competenceDate}T12:00:00`);
  const schedule = installmentSchedule(data.amount, data.installmentCount, firstDate);
  const splitSchedule = data.splitAmount > 0 ? installmentSchedule(data.splitAmount, data.installmentCount, firstDate) : [];
  const created = await db.$transaction(async (tx) => {
    const rows = await Promise.all(schedule.map((item) => tx.transaction.create({ data: {
      householdId: membership.householdId, description: data.installmentCount > 1 ? `${data.description} · ${item.installmentNumber}/${data.installmentCount}` : data.description,
      type: data.type, status: "PENDING", amount: item.amount, totalAmount: data.amount, competenceDate: item.competenceDate,
      dueDate: data.dueDate ? new Date(`${data.dueDate}T12:00:00`) : null, cardId: data.cardId || null, accountId: data.accountId || null,
      categoryId: data.categoryId || null, responsiblePersonId: data.splitPersonId || null, installmentNumber: item.installmentNumber, installmentCount: data.installmentCount, notes: data.notes || null,
    } })));
    if (data.splitPersonId && splitSchedule.length) await Promise.all(rows.map((row, index) => tx.split.create({ data: { transactionId: row.id, personId: data.splitPersonId!, amount: splitSchedule[index].amount, dueDate: data.dueDate ? new Date(`${data.dueDate}T12:00:00`) : null } })));
    await tx.auditLog.create({ data: { householdId: membership.householdId, actorId: user.id, entity: "Transaction", entityId: rows[0].id, action: "CREATE", after: { createdInstallments: rows.length, amount: data.amount } } });
    return rows[0];
  });
  revalidatePath("/");
  return { success: Boolean(created) };
}

export async function markPaid(transactionId: string) {
  const { user, membership } = await requireMembership();
  if (membership.role === "VIEWER" || membership.role === "GUEST") return;
  const transaction = await db.transaction.findFirst({ where: { id: transactionId, householdId: membership.householdId } });
  if (!transaction) return;
  await db.$transaction([
    db.transaction.update({ where: { id: transactionId }, data: { status: "PAID", paidAt: new Date() } }),
    db.auditLog.create({ data: { householdId: membership.householdId, actorId: user.id, entity: "Transaction", entityId: transactionId, action: "MARK_PAID" } }),
  ]);
  revalidatePath("/");
}

export async function cancelTransaction(transactionId: string) {
  const { user, membership } = await requireMembership();
  if (membership.role === "VIEWER" || membership.role === "GUEST") return;
  const transaction = await db.transaction.findFirst({ where: { id: transactionId, householdId: membership.householdId } });
  if (!transaction) return;
  await db.$transaction([
    db.transaction.update({ where: { id: transactionId }, data: { status: "CANCELED" } }),
    db.auditLog.create({ data: { householdId: membership.householdId, actorId: user.id, entity: "Transaction", entityId: transactionId, action: "CANCEL", before: { status: transaction.status }, after: { status: "CANCELED" } } }),
  ]);
  revalidatePath("/");
}

export async function assignTransactionCard(transactionId: string, cardId: string): Promise<ActionState> {
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role)) return { error: "Sem permissão para revisar lançamentos." };
  const [transaction, card] = await Promise.all([
    db.transaction.findFirst({ where: { id: transactionId, householdId: membership.householdId } }),
    db.card.findFirst({ where: { id: cardId, householdId: membership.householdId, active: true } }),
  ]);
  if (!transaction || !card) return { error: "Lançamento ou cartão não encontrado." };
  await db.$transaction([
    db.transaction.update({ where: { id: transaction.id }, data: { cardId: card.id } }),
    db.auditLog.create({ data: { householdId: membership.householdId, actorId: user.id, entity: "Transaction", entityId: transaction.id, action: "ASSIGN_CARD", before: { cardId: transaction.cardId }, after: { cardId: card.id } } }),
  ]);
  revalidatePath("/"); return { success: true };
}

const importRowSchema = z.object({
  description: z.string().trim().min(2).max(160),
  amount: z.coerce.number().positive(),
  type: z.enum(["EXPENSE", "INCOME"]).default("EXPENSE"),
  competenceDate: z.string().date(),
  dueDate: z.string().date().optional().or(z.literal("")),
  categoryName: z.string().trim().max(80).optional(),
  cardName: z.string().trim().max(80).optional(),
  accountName: z.string().trim().max(80).optional(),
  installmentCurrent: z.coerce.number().int().min(1).max(360).default(1),
  installmentCount: z.coerce.number().int().min(1).max(360).default(1),
  recurring: z.boolean().optional().default(false),
  cardColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  notes: z.string().trim().max(1000).optional(),
  source: z.string().trim().max(120).optional(),
  sourceRow: z.coerce.number().int().positive().optional(),
});

const importGroupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  cardName: z.string().trim().min(1).max(80).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  expectedTotal: z.coerce.number().nonnegative(),
  calculatedTotal: z.coerce.number().nonnegative(),
  rowCount: z.coerce.number().int().nonnegative(),
  matched: z.boolean(),
});

const importSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(1000),
  groups: z.array(importGroupSchema).min(1).max(100),
  fileName: z.string().trim().min(1).max(160),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceKey: z.string().trim().min(1).max(500),
  expectedTotal: z.coerce.number().positive(),
  calculatedTotal: z.coerce.number().positive(),
  reconciled: z.literal(true),
});

function importId(householdId: string, row: z.infer<typeof importRowSchema>, index: number, installment: number) {
  const key = [householdId, row.source || "manual", index, installment, row.description, row.amount, row.competenceDate].join("|");
  return `import-${createHash("sha1").update(key).digest("hex").slice(0, 24)}`;
}

function categoryFor(description: string) {
  const value = description.toLowerCase();
  if (/mercado|supermercado|comida|ifood|restaurante|lanche|padaria/.test(value)) return "Alimentação";
  if (/uber|99|corrida|combust|posto|onibus|ônibus|transporte/.test(value)) return "Transporte";
  if (/internet|telefone|netflix|spotify|assinatura|anuidade/.test(value)) return "Assinaturas";
  if (/farmacia|farmácia|medico|médico|exame|saude|saúde/.test(value)) return "Saúde";
  if (/escola|curso|faculdade|livro/.test(value)) return "Educação";
  return "Outros";
}

export async function importTransactions(payload: unknown): Promise<ImportState> {
  const parsed = importSchema.safeParse(payload);
  if (!parsed.success) return { error: "A planilha não passou pela validação de estrutura e conciliação." };
  const { user, membership } = await requireMembership();
  if (membership.role === "VIEWER" || membership.role === "GUEST") return { error: "Seu perfil não tem permissão para importar lançamentos." };

  const input = parsed.data;
  const cents = (value: number) => Math.round(value * 100);
  const rowsTotal = input.rows.reduce((sum, row) => sum + cents(row.amount), 0);
  if (rowsTotal !== cents(input.calculatedTotal) || cents(input.expectedTotal) !== cents(input.calculatedTotal) || input.groups.some((group) => !group.matched || cents(group.expectedTotal) !== cents(group.calculatedTotal))) {
    return { error: "Os totais por cartão não fecham. A importação foi bloqueada para proteger seus dados." };
  }
  const duplicate = await db.importBatch.findFirst({ where: { householdId: membership.householdId, sourceHash: input.sourceHash, status: "IMPORTED" } });
  if (duplicate) return { error: "Esta mesma planilha já foi importada. Desfaça o lote anterior antes de importar novamente." };

  let imported = 0;
  let skipped = 0;
  const categoryCache = new Map<string, string>();
  const cardCache = new Map<string, string>();
  const accountCache = new Map<string, string>();

  const batchId = await db.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({ data: {
      householdId: membership.householdId,
      actorId: user.id,
      fileName: input.fileName,
      sourceKey: input.sourceKey,
      sourceHash: input.sourceHash,
      competenceDate: new Date(`${input.rows[0].competenceDate}T12:00:00`),
      rowCount: input.rows.length,
      importedCount: 0,
      currentMonthTotal: input.calculatedTotal,
      reconciliation: { groups: input.groups, expectedTotal: input.expectedTotal, calculatedTotal: input.calculatedTotal },
    } });
    async function getCategoryId(name: string) {
      if (!categoryCache.has(name)) {
        const category = await tx.category.upsert({
          where: { householdId_name: { householdId: membership.householdId, name } },
          create: { householdId: membership.householdId, name },
          update: {},
        });
        categoryCache.set(name, category.id);
      }
      return categoryCache.get(name)!;
    }

    async function getCardId(name?: string, color?: string) {
      if (!name) return null;
      if (!cardCache.has(name)) {
        const id = `import-card-${createHash("sha1").update(`${membership.householdId}-${name}`).digest("hex").slice(0, 20)}`;
        const card = await tx.card.upsert({
          where: { id },
          create: { id, householdId: membership.householdId, name, color: color || "#5269E8" },
          update: { active: true, name, ...(color ? { color } : {}) },
        });
        cardCache.set(name, card.id);
      }
      return cardCache.get(name)!;
    }

    async function getAccountId(name?: string) {
      if (!name) return null;
      if (!accountCache.has(name)) {
        const account = await tx.account.upsert({
          where: { id: `import-account-${createHash("sha1").update(`${membership.householdId}-${name}`).digest("hex").slice(0, 20)}` },
          create: { id: `import-account-${createHash("sha1").update(`${membership.householdId}-${name}`).digest("hex").slice(0, 20)}`, householdId: membership.householdId, name, type: "OTHER" },
          update: { active: true },
        });
        accountCache.set(name, account.id);
      }
      return accountCache.get(name)!;
    }

    for (const group of input.groups) if (group.cardName) await getCardId(group.cardName, group.color);

    for (const [index, row] of input.rows.entries()) {
      const current = Math.min(row.installmentCurrent, row.installmentCount);
      const baseDate = new Date(`${row.competenceDate}T12:00:00`);
      const categoryId = await getCategoryId(row.categoryName || categoryFor(row.description));
      const cardId = await getCardId(row.cardName, row.cardColor);
      const accountId = await getAccountId(row.accountName);

      const occurrences = row.recurring ? 12 : row.installmentCount - current + 1;
      for (let offset = 0; offset < occurrences; offset++) {
        const installment = row.recurring ? 1 : current + offset;
        const id = importId(membership.householdId, row, index, row.recurring ? offset + 1 : installment);
        const exists = await tx.transaction.findUnique({ where: { id }, select: { id: true } });
        if (exists) {
          skipped++;
          continue;
        }
        await tx.transaction.create({
          data: {
            id,
            externalRef: id,
            householdId: membership.householdId,
            importBatchId: batch.id,
            cardId,
            accountId,
            categoryId,
            type: row.type,
            status: offset === 0 ? "PENDING" : "PLANNED",
            description: row.recurring ? row.description : row.installmentCount > 1 ? `${row.description} · ${installment}/${row.installmentCount}` : row.description,
            amount: row.amount,
            totalAmount: row.recurring ? null : row.amount * row.installmentCount,
            competenceDate: new Date(baseDate.getFullYear(), baseDate.getMonth() + offset, 1),
            dueDate: row.dueDate ? new Date(`${row.dueDate}T12:00:00`) : null,
            installmentNumber: installment,
            installmentCount: row.installmentCount,
            recurring: row.recurring,
            notes: row.notes || null,
          },
        });
        imported++;
      }
    }

    await tx.importBatch.update({ where: { id: batch.id }, data: { importedCount: imported } });
    await tx.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "Import",
        entityId: batch.id,
        action: "IMPORT_TRANSACTIONS",
        after: { imported, skipped, rows: input.rows.length, total: input.calculatedTotal, reconciled: true },
      },
    });
    return batch.id;
  });

  revalidatePath("/");
  return { imported, skipped, batchId };
}

export async function rollbackImport(batchId: string): Promise<ActionState> {
  const { user, membership } = await requireMembership();
  if (membership.role === "VIEWER" || membership.role === "GUEST") return { error: "Seu perfil não tem permissão para desfazer importações." };
  const batch = await db.importBatch.findFirst({ where: { id: batchId, householdId: membership.householdId, status: "IMPORTED" } });
  if (!batch) return { error: "Lote não encontrado ou já desfeito." };
  await db.$transaction(async (tx) => {
    const removed = await tx.transaction.deleteMany({ where: { importBatchId: batch.id } });
    await tx.importBatch.update({ where: { id: batch.id }, data: { status: "ROLLED_BACK", rolledBackAt: new Date() } });
    await tx.auditLog.create({ data: { householdId: membership.householdId, actorId: user.id, entity: "Import", entityId: batch.id, action: "ROLLBACK_IMPORT", before: { importedCount: batch.importedCount }, after: { removed: removed.count } } });
  });
  revalidatePath("/");
  return { success: true };
}

const optionalDay = z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().int().min(1).max(31).optional());
const cardSchema = z.object({ name: z.string().trim().min(2).max(80), institution: z.string().trim().max(80).optional(), holder: z.string().trim().max(80).optional(), lastFour: z.string().trim().regex(/^\d{4}$/).optional().or(z.literal("")), creditLimit: z.coerce.number().nonnegative().default(0), closingDay: optionalDay, dueDay: optionalDay, color: z.string().regex(/^#[0-9A-Fa-f]{6}$/) });
export async function createCard(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = cardSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Confira nome, final, limite e datas do cartão." };
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role)) return { error: "Sem permissão para cadastrar cartões." };
  const data = parsed.data;
  const card = await db.card.create({ data: { householdId: membership.householdId, name: data.name, institution: data.institution || null, holder: data.holder || null, lastFour: data.lastFour || null, creditLimit: data.creditLimit, closingDay: data.closingDay || null, dueDay: data.dueDay || null, color: data.color } });
  await db.auditLog.create({ data: { householdId: membership.householdId, actorId: user.id, entity: "Card", entityId: card.id, action: "CREATE", after: { name: card.name } } });
  revalidatePath("/"); return { success: true };
}

const accountSchema = z.object({ name: z.string().trim().min(2).max(80), institution: z.string().trim().max(80).optional(), type: z.enum(["CASH","CHECKING","SAVINGS","DIGITAL_WALLET","PIX","FOOD_CARD","BUSINESS","OTHER"]), openingBalance: z.coerce.number().default(0), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/) });
export async function createAccount(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = accountSchema.safeParse(Object.fromEntries(formData)); if (!parsed.success) return { error: "Confira os dados da conta." };
  const { user, membership } = await requireMembership(); if (["VIEWER","GUEST"].includes(membership.role)) return { error: "Sem permissão para cadastrar contas." };
  const account = await db.account.create({ data: { householdId: membership.householdId, ...parsed.data, institution: parsed.data.institution || null } });
  await db.auditLog.create({ data: { householdId: membership.householdId, actorId: user.id, entity: "Account", entityId: account.id, action: "CREATE", after: { name: account.name } } }); revalidatePath("/"); return { success: true };
}

const personSchema = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email().optional().or(z.literal("")), phone: z.string().trim().max(30).optional() });
export async function createPerson(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = personSchema.safeParse(Object.fromEntries(formData)); if (!parsed.success) return { error: "Confira nome e contato." };
  const { user, membership } = await requireMembership(); if (["VIEWER","GUEST"].includes(membership.role)) return { error: "Sem permissão para cadastrar pessoas." };
  const person = await db.person.create({ data: { householdId: membership.householdId, name: parsed.data.name, email: parsed.data.email || null, phone: parsed.data.phone || null } });
  await db.auditLog.create({ data: { householdId: membership.householdId, actorId: user.id, entity: "Person", entityId: person.id, action: "CREATE", after: { name: person.name } } }); revalidatePath("/"); return { success: true };
}

const categorySchema = z.object({ name: z.string().trim().min(2).max(80), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/) });
export async function createCategory(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = categorySchema.safeParse(Object.fromEntries(formData)); if (!parsed.success) return { error: "Confira o nome da categoria." };
  const { user, membership } = await requireMembership(); if (["VIEWER","GUEST"].includes(membership.role)) return { error: "Sem permissão para cadastrar categorias." };
  const category = await db.category.upsert({ where: { householdId_name: { householdId: membership.householdId, name: parsed.data.name } }, create: { householdId: membership.householdId, ...parsed.data }, update: { color: parsed.data.color } });
  await db.auditLog.create({ data: { householdId: membership.householdId, actorId: user.id, entity: "Category", entityId: category.id, action: "UPSERT", after: { name: category.name } } }); revalidatePath("/"); return { success: true };
}
