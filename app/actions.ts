"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clearSession, createSession, requireMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { installmentSchedule } from "@/lib/finance";

const credentials = z.object({ name: z.string().trim().min(2).max(80).optional(), email: z.string().trim().email(), password: z.string().min(10).max(128) });
type AuthState = { error?: string };
type TransactionState = { error?: string; success?: boolean };

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
