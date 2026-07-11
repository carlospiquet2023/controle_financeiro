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
type ImportState = { error?: string; imported?: number; skipped?: number };

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
  categoryId: z.string().optional().or(z.literal("")), installmentCount: z.coerce.number().int().min(1).max(360).default(1), notes: z.string().max(1000).optional(),
});

export async function createTransaction(_: TransactionState, formData: FormData): Promise<TransactionState> {
  const parsed = transactionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Confira descrição, valor e data do lançamento." };
  const { user, membership } = await requireMembership();
  if (membership.role === "VIEWER" || membership.role === "GUEST") return { error: "Seu perfil não tem permissão para criar lançamentos." };
  const data = parsed.data;
  const firstDate = new Date(`${data.competenceDate}T12:00:00`);
  const schedule = installmentSchedule(data.amount, data.installmentCount, firstDate);
  const created = await db.$transaction(async (tx) => {
    const rows = await Promise.all(schedule.map((item) => tx.transaction.create({ data: {
      householdId: membership.householdId, description: data.installmentCount > 1 ? `${data.description} · ${item.installmentNumber}/${data.installmentCount}` : data.description,
      type: data.type, status: "PENDING", amount: item.amount, totalAmount: data.amount, competenceDate: item.competenceDate,
      dueDate: data.dueDate ? new Date(`${data.dueDate}T12:00:00`) : null, cardId: data.cardId || null, accountId: data.accountId || null,
      categoryId: data.categoryId || null, installmentNumber: item.installmentNumber, installmentCount: data.installmentCount, notes: data.notes || null,
    } })));
    await tx.auditLog.create({ data: { householdId: membership.householdId, actorId: user.id, entity: "Transaction", entityId: rows[0].id, action: "CREATE", after: { createdInstallments: rows.length, amount: data.amount } } });
    return rows[0];
  });
  revalidatePath("/");
  return { success: Boolean(created) };
}

export async function markPaid(transactionId: string) {
  const { user, membership } = await requireMembership();
  const transaction = await db.transaction.findFirst({ where: { id: transactionId, householdId: membership.householdId } });
  if (!transaction) return;
  await db.$transaction([
    db.transaction.update({ where: { id: transactionId }, data: { status: "PAID", paidAt: new Date() } }),
    db.auditLog.create({ data: { householdId: membership.householdId, actorId: user.id, entity: "Transaction", entityId: transactionId, action: "MARK_PAID" } }),
  ]);
  revalidatePath("/");
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
  notes: z.string().trim().max(1000).optional(),
  source: z.string().trim().max(120).optional(),
});

const importSchema = z.array(importRowSchema).min(1).max(500);

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

export async function importTransactions(rows: unknown): Promise<ImportState> {
  const parsed = importSchema.safeParse(rows);
  if (!parsed.success) return { error: "A planilha precisa ter descrição, valor e mês de competência." };
  const { user, membership } = await requireMembership();
  if (membership.role === "VIEWER" || membership.role === "GUEST") return { error: "Seu perfil não tem permissão para importar lançamentos." };

  let imported = 0;
  let skipped = 0;
  const categoryCache = new Map<string, string>();
  const cardCache = new Map<string, string>();
  const accountCache = new Map<string, string>();

  await db.$transaction(async (tx) => {
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

    async function getCardId(name?: string) {
      if (!name) return null;
      if (!cardCache.has(name)) {
        const card = await tx.card.upsert({
          where: { id: `import-card-${createHash("sha1").update(`${membership.householdId}-${name}`).digest("hex").slice(0, 20)}` },
          create: { id: `import-card-${createHash("sha1").update(`${membership.householdId}-${name}`).digest("hex").slice(0, 20)}`, householdId: membership.householdId, name },
          update: { active: true },
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

    for (const [index, row] of parsed.data.entries()) {
      const current = Math.min(row.installmentCurrent, row.installmentCount);
      const baseDate = new Date(`${row.competenceDate}T12:00:00`);
      const categoryId = await getCategoryId(row.categoryName || categoryFor(row.description));
      const cardId = await getCardId(row.cardName);
      const accountId = await getAccountId(row.accountName);

      for (let installment = current; installment <= row.installmentCount; installment++) {
        const id = importId(membership.householdId, row, index, installment);
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
            cardId,
            accountId,
            categoryId,
            type: row.type,
            status: installment === current ? "PENDING" : "PLANNED",
            description: row.installmentCount > 1 ? `${row.description} · ${installment}/${row.installmentCount}` : row.description,
            amount: row.amount,
            totalAmount: row.amount * row.installmentCount,
            competenceDate: new Date(baseDate.getFullYear(), baseDate.getMonth() + (installment - current), 1),
            dueDate: row.dueDate ? new Date(`${row.dueDate}T12:00:00`) : null,
            installmentNumber: installment,
            installmentCount: row.installmentCount,
            notes: row.notes || null,
          },
        });
        imported++;
      }
    }

    await tx.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "Import",
        entityId: `import-${Date.now()}`,
        action: "IMPORT_TRANSACTIONS",
        after: { imported, skipped, rows: parsed.data.length },
      },
    });
  });

  revalidatePath("/");
  return { imported, skipped };
}
