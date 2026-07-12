"use server";

import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clearSession, createSession, requireMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { addMonthsClamped, installmentSchedule } from "@/lib/finance";
import { addUtcMonths, monthStartUtc } from "@/lib/format";
import {
  clearLoginFailures,
  loginAllowed,
  normalizeEmail,
  pwnedPasswordCount,
  recordLoginFailure,
} from "@/lib/security";
import { deleteObject } from "@/lib/r2";

const credentials = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email(),
  password: z.string().min(10).max(128),
});
type AuthState = { error?: string };
type TransactionState = { error?: string; success?: boolean };
type ImportState = {
  error?: string;
  imported?: number;
  skipped?: number;
  batchId?: string;
};
export type ActionState = {
  error?: string;
  success?: boolean;
  removed?: number;
};

export async function authenticate(
  _: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const result = credentials.safeParse(Object.fromEntries(formData));
  if (!result.success)
    return {
      error: "Use um e-mail válido e uma senha com no mínimo 10 caracteres.",
    };
  const { password, name } = result.data;
  const email = normalizeEmail(result.data.email);
  if (!(await loginAllowed(email)))
    return {
      error:
        "Muitas tentativas de acesso. Aguarde 15 minutos e tente novamente.",
    };
  const existing = await db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  if (existing) {
    const valid = await bcrypt.compare(password, existing.passwordHash);
    if (!valid) {
      const failure = await recordLoginFailure(email);
      return {
        error: failure.locked
          ? "Muitas tentativas de acesso. Aguarde 15 minutos e tente novamente."
          : "E-mail ou senha incorretos.",
      };
    }
    await clearLoginFailures(email);
    await createSession(existing.id);
    redirect("/");
  }
  if (!name)
    return {
      error: "Esta conta ainda não existe. Informe seu nome para criá-la.",
    };
  const leaked = await pwnedPasswordCount(password);
  if (leaked && leaked > 0)
    return {
      error:
        "Essa senha apareceu em vazamentos conhecidos. Escolha uma senha diferente e exclusiva.",
    };
  const user = await db.user.create({
    data: {
      name,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      memberships: {
        create: {
          role: "OWNER",
          household: { create: { name: `Família de ${name}` } },
        },
      },
    },
  });
  await createSession(user.id);
  redirect("/");
}

export async function logout() {
  await clearSession();
  redirect("/entrar");
}

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(10).max(128),
    newPassword: z.string().min(12).max(128),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ["newPassword"],
    message: "A nova senha deve ser diferente.",
  });
export async function changePassword(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = passwordChangeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return {
      error: "Use uma nova senha diferente, com pelo menos 12 caracteres.",
    };
  const { user, membership } = await requireMembership();
  if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash)))
    return { error: "A senha atual está incorreta." };
  const leaked = await pwnedPasswordCount(parsed.data.newPassword);
  if (leaked && leaked > 0)
    return {
      error: "A nova senha apareceu em vazamentos conhecidos. Escolha outra.",
    };
  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 12) },
    }),
    db.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "User",
        entityId: user.id,
        action: "CHANGE_PASSWORD",
      },
    }),
  ]);
  await db.session.deleteMany({ where: { userId: user.id } });
  await clearSession();
  redirect("/entrar");
}

const transactionSchema = z
  .object({
    description: z.string().trim().min(2).max(120),
    amount: z.coerce.number().positive(),
    type: z.enum(["EXPENSE", "INCOME"]),
    competenceDate: z.string().date(),
    dueDate: z.string().date().optional().or(z.literal("")),
    cardId: z.string().optional().or(z.literal("")),
    accountId: z.string().optional().or(z.literal("")),
    categoryId: z.string().optional().or(z.literal("")),
    splitPersonId: z.string().optional().or(z.literal("")),
    splitAmount: z.coerce.number().nonnegative().default(0),
    installmentCount: z.coerce.number().int().min(1).max(360).default(1),
    notes: z.string().max(1000).optional(),
  })
  .superRefine((data, context) => {
    if (data.splitAmount > data.amount)
      context.addIssue({
        code: "custom",
        path: ["splitAmount"],
        message: "O valor a devolver não pode superar a compra.",
      });
    if (data.splitAmount > 0 && !data.splitPersonId)
      context.addIssue({
        code: "custom",
        path: ["splitPersonId"],
        message: "Selecione quem precisa devolver.",
      });
  });

export async function createTransaction(
  _: TransactionState,
  formData: FormData,
): Promise<TransactionState> {
  const parsed = transactionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return {
      error: "Confira descrição, parcelas, data e valor do lançamento.",
    };
  const { user, membership } = await requireMembership();
  if (membership.role === "VIEWER" || membership.role === "GUEST")
    return { error: "Seu perfil não tem permissão para criar lançamentos." };
  const data = parsed.data;
  const [card, account, category, person] = await Promise.all([
    data.cardId
      ? db.card.findFirst({
          where: {
            id: data.cardId,
            householdId: membership.householdId,
            active: true,
          },
          select: { id: true },
        })
      : null,
    data.accountId
      ? db.account.findFirst({
          where: {
            id: data.accountId,
            householdId: membership.householdId,
            active: true,
          },
          select: { id: true },
        })
      : null,
    data.categoryId
      ? db.category.findFirst({
          where: { id: data.categoryId, householdId: membership.householdId },
          select: { id: true },
        })
      : null,
    data.splitPersonId
      ? db.person.findFirst({
          where: {
            id: data.splitPersonId,
            householdId: membership.householdId,
            active: true,
          },
          select: { id: true },
        })
      : null,
  ]);
  if (
    (data.cardId && !card) ||
    (data.accountId && !account) ||
    (data.categoryId && !category) ||
    (data.splitPersonId && !person)
  )
    return {
      error:
        "Um dos cadastros selecionados não pertence à sua família ou está inativo.",
    };
  const firstDate = new Date(`${data.competenceDate}T12:00:00`);
  const schedule = installmentSchedule(
    data.amount,
    data.installmentCount,
    firstDate,
  );
  const splitSchedule =
    data.splitAmount > 0
      ? installmentSchedule(data.splitAmount, data.installmentCount, firstDate)
      : [];
  const firstDueDate = data.dueDate
    ? new Date(`${data.dueDate}T12:00:00`)
    : null;
  const created = await db.$transaction(async (tx) => {
    const rows = await Promise.all(
      schedule.map((item) =>
        tx.transaction.create({
          data: {
            householdId: membership.householdId,
            description:
              data.installmentCount > 1
                ? `${data.description} · ${item.installmentNumber}/${data.installmentCount}`
                : data.description,
            type: data.type,
            status: item.installmentNumber === 1 ? "PENDING" : "PLANNED",
            amount: item.amount,
            totalAmount: data.amount,
            competenceDate: item.competenceDate,
            dueDate: firstDueDate
              ? addMonthsClamped(firstDueDate, item.installmentNumber - 1)
              : null,
            cardId: data.cardId || null,
            accountId: data.accountId || null,
            categoryId: data.categoryId || null,
            responsiblePersonId: data.splitPersonId || null,
            installmentNumber: item.installmentNumber,
            installmentCount: data.installmentCount,
            notes: data.notes || null,
          },
        }),
      ),
    );
    if (data.splitPersonId && splitSchedule.length)
      await Promise.all(
        rows.map((row, index) =>
          tx.split.create({
            data: {
              transactionId: row.id,
              personId: data.splitPersonId!,
              amount: splitSchedule[index].amount,
              dueDate: firstDueDate
                ? addMonthsClamped(firstDueDate, index)
                : null,
            },
          }),
        ),
      );
    await tx.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "Transaction",
        entityId: rows[0].id,
        action: "CREATE",
        after: { createdInstallments: rows.length, amount: data.amount },
      },
    });
    return rows[0];
  });
  revalidatePath("/");
  return { success: Boolean(created) };
}

export async function markPaid(transactionId: string) {
  const { user, membership } = await requireMembership();
  if (membership.role === "VIEWER" || membership.role === "GUEST") return;
  const transaction = await db.transaction.findFirst({
    where: { id: transactionId, householdId: membership.householdId },
  });
  if (!transaction) return;
  await db.$transaction([
    db.transaction.update({
      where: { id: transactionId },
      data: { status: "PAID", paidAt: new Date() },
    }),
    db.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "Transaction",
        entityId: transactionId,
        action: "MARK_PAID",
      },
    }),
  ]);
  revalidatePath("/");
}

export async function cancelTransaction(transactionId: string) {
  const { user, membership } = await requireMembership();
  if (membership.role === "VIEWER" || membership.role === "GUEST") return;
  const transaction = await db.transaction.findFirst({
    where: { id: transactionId, householdId: membership.householdId },
  });
  if (!transaction) return;
  await db.$transaction([
    db.transaction.update({
      where: { id: transactionId },
      data: { status: "CANCELED" },
    }),
    db.split.updateMany({
      where: { transactionId, status: { in: ["OPEN", "PARTIALLY_PAID"] } },
      data: { status: "WAIVED" },
    }),
    db.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "Transaction",
        entityId: transactionId,
        action: "CANCEL",
        before: { status: transaction.status },
        after: { status: "CANCELED" },
      },
    }),
  ]);
  revalidatePath("/");
}

const transactionEditSchema = z
  .object({
    description: z.string().trim().min(2).max(120),
    amount: z.coerce.number().positive().max(999999999999.99),
    date: z.string().date(),
    editsDueDate: z.boolean(),
    installmentNumber: z.coerce.number().int().min(1).max(360),
    installmentCount: z.coerce.number().int().min(1).max(360),
  })
  .superRefine((data, context) => {
    if (data.installmentNumber > data.installmentCount)
      context.addIssue({
        code: "custom",
        path: ["installmentNumber"],
        message: "A parcela atual não pode superar o total.",
      });
  });

export async function updateTransaction(
  transactionId: string,
  input: unknown,
): Promise<ActionState> {
  const parsed = transactionEditSchema.safeParse(input);
  if (!parsed.success)
    return {
      error: "Confira descrição, parcelas, data e valor do lançamento.",
    };
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Seu perfil não tem permissão para editar lançamentos." };
  const transaction = await db.transaction.findFirst({
    where: { id: transactionId, householdId: membership.householdId },
  });
  if (!transaction) return { error: "Lançamento não encontrado." };
  const date = new Date(`${parsed.data.date}T12:00:00`);
  const dateChange = parsed.data.editsDueDate
    ? { dueDate: date }
    : { competenceDate: date };
  const baseDescription = parsed.data.description
    .replace(/\s*·\s*\d+\s*\/\s*\d+\s*$/, "")
    .trim();
  const description =
    parsed.data.installmentCount > 1
      ? `${baseDescription} · ${parsed.data.installmentNumber}/${parsed.data.installmentCount}`
      : baseDescription;
  await db.$transaction([
    db.transaction.update({
      where: { id: transaction.id },
      data: {
        description,
        amount: parsed.data.amount,
        installmentNumber: parsed.data.installmentNumber,
        installmentCount: parsed.data.installmentCount,
        ...dateChange,
      },
    }),
    db.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "Transaction",
        entityId: transaction.id,
        action: "UPDATE",
        before: {
          description: transaction.description,
          amount: Number(transaction.amount),
          installmentNumber: transaction.installmentNumber,
          installmentCount: transaction.installmentCount,
          competenceDate: transaction.competenceDate.toISOString(),
          dueDate: transaction.dueDate?.toISOString() ?? null,
        },
        after: {
          description,
          amount: parsed.data.amount,
          installmentNumber: parsed.data.installmentNumber,
          installmentCount: parsed.data.installmentCount,
          [parsed.data.editsDueDate ? "dueDate" : "competenceDate"]:
            date.toISOString(),
        },
      },
    }),
  ]);
  revalidatePath("/");
  return { success: true };
}

const monthResetSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);

export async function resetFinancialMonth(
  monthKey: string,
): Promise<ActionState> {
  const parsed = monthResetSchema.safeParse(monthKey);
  if (!parsed.success) return { error: "Mês inválido para redefinição." };
  const { user, membership } = await requireMembership();
  if (!["OWNER", "ADMIN"].includes(membership.role))
    return {
      error: "Somente proprietários e administradores podem resetar um mês.",
    };
  const month = monthStartUtc(parsed.data);
  const nextMonth = addUtcMonths(month, 1);
  const attachments = await db.attachment.findMany({
    where: {
      transaction: {
        householdId: membership.householdId,
        competenceDate: { gte: month, lt: nextMonth },
      },
    },
    select: { key: true },
  });
  const removed = await db.$transaction(async (tx) => {
    await tx.financialMonthClose.deleteMany({
      where: { householdId: membership.householdId, month },
    });
    const result = await tx.transaction.deleteMany({
      where: {
        householdId: membership.householdId,
        competenceDate: { gte: month, lt: nextMonth },
      },
    });
    await tx.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "Household",
        entityId: membership.householdId,
        action: "RESET_MONTH",
        before: { month: parsed.data, transactionCount: result.count },
        after: { transactionCount: 0 },
      },
    });
    return result.count;
  });
  await Promise.allSettled(
    attachments.map((attachment) => deleteObject(attachment.key)),
  );
  revalidatePath("/");
  return { success: true, removed };
}

export async function resetAllFinancialData(
  confirmation: string,
): Promise<ActionState> {
  if (confirmation !== "RESETAR TUDO")
    return { error: "Digite RESETAR TUDO para confirmar." };
  const { user, membership } = await requireMembership();
  if (membership.role !== "OWNER")
    return {
      error: "Somente o proprietário pode resetar todos os dados financeiros.",
    };
  const [attachments, taxDocuments] = await Promise.all([
    db.attachment.findMany({
      where: { transaction: { householdId: membership.householdId } },
      select: { key: true },
    }),
    db.taxDocument.findMany({
      where: { householdId: membership.householdId },
      select: { sourceKey: true },
    }),
  ]);
  const removed = await db.$transaction(async (tx) => {
    const transactionCount = await tx.transaction.count({
      where: { householdId: membership.householdId },
    });
    await tx.sharedLedgerLink.deleteMany({
      where: { householdId: membership.householdId },
    });
    await tx.webhookEvent.deleteMany({
      where: { householdId: membership.householdId },
    });
    await tx.financialConnection.deleteMany({
      where: { householdId: membership.householdId },
    });
    await tx.taxDocument.deleteMany({
      where: { householdId: membership.householdId },
    });
    await tx.taxProfile.deleteMany({
      where: { householdId: membership.householdId },
    });
    await tx.taxSimulation.deleteMany({
      where: { householdId: membership.householdId },
    });
    await tx.taxLedgerEntry.deleteMany({
      where: { householdId: membership.householdId },
    });
    await tx.taxCashback.deleteMany({
      where: { householdId: membership.householdId },
    });
    await tx.debt.deleteMany({
      where: { householdId: membership.householdId },
    });
    await tx.financialMonthClose.deleteMany({
      where: { householdId: membership.householdId },
    });
    await tx.monthlyBudget.deleteMany({
      where: { householdId: membership.householdId },
    });
    await tx.transaction.deleteMany({
      where: { householdId: membership.householdId },
    });
    await tx.importBatch.deleteMany({
      where: { householdId: membership.householdId },
    });
    await tx.card.deleteMany({
      where: { householdId: membership.householdId },
    });
    await tx.account.deleteMany({
      where: { householdId: membership.householdId },
    });
    await tx.category.deleteMany({
      where: { householdId: membership.householdId },
    });
    await tx.person.deleteMany({
      where: { householdId: membership.householdId },
    });
    await tx.auditLog.deleteMany({
      where: { householdId: membership.householdId },
    });
    await tx.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "Household",
        entityId: membership.householdId,
        action: "RESET_ALL_FINANCIAL_DATA",
        before: { transactionCount },
        after: { transactionCount: 0 },
      },
    });
    return transactionCount;
  });
  await Promise.allSettled(
    [
      ...attachments.map((attachment) => attachment.key),
      ...taxDocuments.map((document) => document.sourceKey),
    ].map((key) => deleteObject(key)),
  );
  revalidatePath("/");
  return { success: true, removed };
}

export async function assignTransactionCard(
  transactionId: string,
  cardId: string,
): Promise<ActionState> {
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para revisar lançamentos." };
  const [transaction, card] = await Promise.all([
    db.transaction.findFirst({
      where: { id: transactionId, householdId: membership.householdId },
    }),
    db.card.findFirst({
      where: { id: cardId, householdId: membership.householdId, active: true },
    }),
  ]);
  if (!transaction || !card)
    return { error: "Lançamento ou cartão não encontrado." };
  await db.$transaction([
    db.transaction.update({
      where: { id: transaction.id },
      data: { cardId: card.id },
    }),
    db.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "Transaction",
        entityId: transaction.id,
        action: "ASSIGN_CARD",
        before: { cardId: transaction.cardId },
        after: { cardId: card.id },
      },
    }),
  ]);
  revalidatePath("/");
  return { success: true };
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
  cardColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
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

function importId(
  householdId: string,
  row: z.infer<typeof importRowSchema>,
  index: number,
  installment: number,
) {
  const key = [
    householdId,
    row.source || "manual",
    index,
    installment,
    row.description,
    row.amount,
    row.competenceDate,
  ].join("|");
  return `import-${createHash("sha1").update(key).digest("hex").slice(0, 24)}`;
}

function categoryFor(description: string) {
  const value = description.toLowerCase();
  if (
    /mercado|supermercado|comida|ifood|restaurante|lanche|padaria/.test(value)
  )
    return "Alimentação";
  if (/uber|99|corrida|combust|posto|onibus|ônibus|transporte/.test(value))
    return "Transporte";
  if (/internet|telefone|netflix|spotify|assinatura|anuidade/.test(value))
    return "Assinaturas";
  if (/farmacia|farmácia|medico|médico|exame|saude|saúde/.test(value))
    return "Saúde";
  if (/escola|curso|faculdade|livro/.test(value)) return "Educação";
  return "Outros";
}

export async function importTransactions(
  payload: unknown,
): Promise<ImportState> {
  const parsed = importSchema.safeParse(payload);
  if (!parsed.success)
    return {
      error: "A planilha não passou pela validação de estrutura e conciliação.",
    };
  const { user, membership } = await requireMembership();
  if (membership.role === "VIEWER" || membership.role === "GUEST")
    return { error: "Seu perfil não tem permissão para importar lançamentos." };

  const input = parsed.data;
  const cents = (value: number) => Math.round(value * 100);
  const rowsTotal = input.rows.reduce((sum, row) => sum + cents(row.amount), 0);
  if (
    rowsTotal !== cents(input.calculatedTotal) ||
    cents(input.expectedTotal) !== cents(input.calculatedTotal) ||
    input.groups.some(
      (group) =>
        !group.matched ||
        cents(group.expectedTotal) !== cents(group.calculatedTotal),
    )
  ) {
    return {
      error:
        "Os totais por cartão não fecham. A importação foi bloqueada para proteger seus dados.",
    };
  }
  const duplicate = await db.importBatch.findFirst({
    where: {
      householdId: membership.householdId,
      sourceHash: input.sourceHash,
      status: "IMPORTED",
    },
  });
  if (duplicate)
    return {
      error:
        "Esta mesma planilha já foi importada. Desfaça o lote anterior antes de importar novamente.",
    };

  let imported = 0;
  let skipped = 0;
  const categoryCache = new Map<string, string>();
  const cardCache = new Map<string, string>();
  const accountCache = new Map<string, string>();

  const batchId = await db.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        fileName: input.fileName,
        sourceKey: input.sourceKey,
        sourceHash: input.sourceHash,
        competenceDate: new Date(`${input.rows[0].competenceDate}T12:00:00`),
        rowCount: input.rows.length,
        importedCount: 0,
        currentMonthTotal: input.calculatedTotal,
        reconciliation: {
          groups: input.groups,
          expectedTotal: input.expectedTotal,
          calculatedTotal: input.calculatedTotal,
        },
      },
    });
    async function getCategoryId(name: string) {
      if (!categoryCache.has(name)) {
        const category = await tx.category.upsert({
          where: {
            householdId_name: { householdId: membership.householdId, name },
          },
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
          create: {
            id,
            householdId: membership.householdId,
            name,
            color: color || "#5269E8",
          },
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
          where: {
            id: `import-account-${createHash("sha1").update(`${membership.householdId}-${name}`).digest("hex").slice(0, 20)}`,
          },
          create: {
            id: `import-account-${createHash("sha1").update(`${membership.householdId}-${name}`).digest("hex").slice(0, 20)}`,
            householdId: membership.householdId,
            name,
            type: "OTHER",
          },
          update: { active: true },
        });
        accountCache.set(name, account.id);
      }
      return accountCache.get(name)!;
    }

    for (const group of input.groups)
      if (group.cardName) await getCardId(group.cardName, group.color);

    for (const [index, row] of input.rows.entries()) {
      const current = Math.min(row.installmentCurrent, row.installmentCount);
      const baseDate = new Date(`${row.competenceDate}T12:00:00`);
      const categoryId = await getCategoryId(
        row.categoryName || categoryFor(row.description),
      );
      const cardId = await getCardId(row.cardName, row.cardColor);
      const accountId = await getAccountId(row.accountName);

      const occurrences = row.recurring
        ? 12
        : row.installmentCount - current + 1;
      for (let offset = 0; offset < occurrences; offset++) {
        const installment = row.recurring ? 1 : current + offset;
        const id = importId(
          membership.householdId,
          row,
          index,
          row.recurring ? offset + 1 : installment,
        );
        const exists = await tx.transaction.findUnique({
          where: { id },
          select: { id: true },
        });
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
            description: row.recurring
              ? row.description
              : row.installmentCount > 1
                ? `${row.description} · ${installment}/${row.installmentCount}`
                : row.description,
            amount: row.amount,
            totalAmount: row.recurring
              ? null
              : row.amount * row.installmentCount,
            competenceDate: new Date(
              baseDate.getFullYear(),
              baseDate.getMonth() + offset,
              1,
            ),
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

    await tx.importBatch.update({
      where: { id: batch.id },
      data: { importedCount: imported },
    });
    await tx.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "Import",
        entityId: batch.id,
        action: "IMPORT_TRANSACTIONS",
        after: {
          imported,
          skipped,
          rows: input.rows.length,
          total: input.calculatedTotal,
          reconciled: true,
        },
      },
    });
    return batch.id;
  });

  revalidatePath("/");
  return { imported, skipped, batchId };
}

export async function rollbackImport(batchId: string): Promise<ActionState> {
  const { user, membership } = await requireMembership();
  if (membership.role === "VIEWER" || membership.role === "GUEST")
    return { error: "Seu perfil não tem permissão para desfazer importações." };
  const batch = await db.importBatch.findFirst({
    where: {
      id: batchId,
      householdId: membership.householdId,
      status: "IMPORTED",
    },
  });
  if (!batch) return { error: "Lote não encontrado ou já desfeito." };
  await db.$transaction(async (tx) => {
    const removed = await tx.transaction.deleteMany({
      where: { importBatchId: batch.id },
    });
    await tx.importBatch.update({
      where: { id: batch.id },
      data: { status: "ROLLED_BACK", rolledBackAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "Import",
        entityId: batch.id,
        action: "ROLLBACK_IMPORT",
        before: { importedCount: batch.importedCount },
        after: { removed: removed.count },
      },
    });
  });
  revalidatePath("/");
  return { success: true };
}

const optionalDay = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce.number().int().min(1).max(31).optional(),
);
const cardSchema = z.object({
  name: z.string().trim().min(2).max(80),
  institution: z.string().trim().max(80).optional(),
  holder: z.string().trim().max(80).optional(),
  lastFour: z
    .string()
    .trim()
    .regex(/^\d{4}$/)
    .optional()
    .or(z.literal("")),
  creditLimit: z.coerce.number().nonnegative().default(0),
  closingDay: optionalDay,
  dueDay: optionalDay,
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});
export async function createCard(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = cardSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { error: "Confira nome, final, limite e datas do cartão." };
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para cadastrar cartões." };
  const data = parsed.data;
  const card = await db.card.create({
    data: {
      householdId: membership.householdId,
      name: data.name,
      institution: data.institution || null,
      holder: data.holder || null,
      lastFour: data.lastFour || null,
      creditLimit: data.creditLimit,
      closingDay: data.closingDay || null,
      dueDay: data.dueDay || null,
      color: data.color,
    },
  });
  await db.auditLog.create({
    data: {
      householdId: membership.householdId,
      actorId: user.id,
      entity: "Card",
      entityId: card.id,
      action: "CREATE",
      after: { name: card.name },
    },
  });
  revalidatePath("/");
  return { success: true };
}

const accountSchema = z.object({
  name: z.string().trim().min(2).max(80),
  institution: z.string().trim().max(80).optional(),
  type: z.enum([
    "CASH",
    "CHECKING",
    "SAVINGS",
    "DIGITAL_WALLET",
    "PIX",
    "FOOD_CARD",
    "BUSINESS",
    "OTHER",
  ]),
  openingBalance: z.coerce.number().default(0),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});
export async function createAccount(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = accountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Confira os dados da conta." };
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para cadastrar contas." };
  const account = await db.account.create({
    data: {
      householdId: membership.householdId,
      ...parsed.data,
      institution: parsed.data.institution || null,
    },
  });
  await db.auditLog.create({
    data: {
      householdId: membership.householdId,
      actorId: user.id,
      entity: "Account",
      entityId: account.id,
      action: "CREATE",
      after: { name: account.name },
    },
  });
  revalidatePath("/");
  return { success: true };
}

const personSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional(),
});
export async function createPerson(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = personSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Confira nome e contato." };
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para cadastrar pessoas." };
  const person = await db.person.create({
    data: {
      householdId: membership.householdId,
      name: parsed.data.name,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
    },
  });
  await db.auditLog.create({
    data: {
      householdId: membership.householdId,
      actorId: user.id,
      entity: "Person",
      entityId: person.id,
      action: "CREATE",
      after: { name: person.name },
    },
  });
  revalidatePath("/");
  return { success: true };
}

const categorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});
export async function createCategory(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = categorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Confira o nome da categoria." };
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para cadastrar categorias." };
  const category = await db.category.upsert({
    where: {
      householdId_name: {
        householdId: membership.householdId,
        name: parsed.data.name,
      },
    },
    create: { householdId: membership.householdId, ...parsed.data },
    update: { color: parsed.data.color },
  });
  await db.auditLog.create({
    data: {
      householdId: membership.householdId,
      actorId: user.id,
      entity: "Category",
      entityId: category.id,
      action: "UPSERT",
      after: { name: category.name },
    },
  });
  revalidatePath("/");
  return { success: true };
}

const splitPaymentSchema = z.object({
  amount: z.coerce.number().positive().max(999999999999.99),
  notes: z.string().trim().max(300).optional(),
});
export async function settleSplit(
  splitId: string,
  input: unknown,
): Promise<ActionState> {
  const parsed = splitPaymentSchema.safeParse(input);
  if (!parsed.success)
    return { error: "Informe um valor de devolução válido." };
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para registrar devoluções." };
  const split = await db.split.findFirst({
    where: {
      id: splitId,
      transaction: {
        householdId: membership.householdId,
        status: { notIn: ["CANCELED", "REFUNDED"] },
      },
      status: { in: ["OPEN", "PARTIALLY_PAID"] },
    },
  });
  if (!split) return { error: "Acerto não encontrado ou já encerrado." };
  const outstanding =
    Math.round((Number(split.amount) - Number(split.paidAmount)) * 100) / 100;
  if (parsed.data.amount > outstanding)
    return { error: "A devolução não pode superar o valor em aberto." };
  const paidAmount =
    Math.round((Number(split.paidAmount) + parsed.data.amount) * 100) / 100;
  const status =
    paidAmount >= Number(split.amount)
      ? ("PAID" as const)
      : ("PARTIALLY_PAID" as const);
  await db.$transaction([
    db.splitPayment.create({
      data: {
        splitId: split.id,
        amount: parsed.data.amount,
        notes: parsed.data.notes || null,
      },
    }),
    db.split.update({ where: { id: split.id }, data: { paidAmount, status } }),
    db.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "Split",
        entityId: split.id,
        action: "REGISTER_REIMBURSEMENT",
        before: { paidAmount: Number(split.paidAmount), status: split.status },
        after: { paidAmount, status, payment: parsed.data.amount },
      },
    }),
  ]);
  revalidatePath("/");
  return { success: true };
}

export async function waiveSplit(splitId: string): Promise<ActionState> {
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para encerrar acertos." };
  const split = await db.split.findFirst({
    where: {
      id: splitId,
      transaction: { householdId: membership.householdId },
      status: { in: ["OPEN", "PARTIALLY_PAID"] },
    },
  });
  if (!split) return { error: "Acerto não encontrado ou já encerrado." };
  await db.$transaction([
    db.split.update({ where: { id: split.id }, data: { status: "WAIVED" } }),
    db.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "Split",
        entityId: split.id,
        action: "WAIVE_REIMBURSEMENT",
        before: { status: split.status },
        after: { status: "WAIVED" },
      },
    }),
  ]);
  revalidatePath("/");
  return { success: true };
}

const budgetInputSchema = z
  .array(
    z.object({
      categoryId: z.string().min(1),
      amount: z.coerce.number().nonnegative().max(999999999999.99),
    }),
  )
  .max(200);
export async function saveMonthlyBudgets(
  monthKey: string,
  input: unknown,
): Promise<ActionState> {
  const monthParsed = monthResetSchema.safeParse(monthKey);
  const budgetsParsed = budgetInputSchema.safeParse(input);
  if (!monthParsed.success || !budgetsParsed.success)
    return { error: "Orçamento inválido." };
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para editar o orçamento." };
  const categoryIds = [
    ...new Set(budgetsParsed.data.map((item) => item.categoryId)),
  ];
  const categories = await db.category.count({
    where: { householdId: membership.householdId, id: { in: categoryIds } },
  });
  if (categories !== categoryIds.length)
    return { error: "Há categorias que não pertencem à sua família." };
  const month = monthStartUtc(monthParsed.data);
  await db.$transaction(async (tx) => {
    await tx.monthlyBudget.deleteMany({
      where: { householdId: membership.householdId, month },
    });
    const rows = budgetsParsed.data.filter((item) => item.amount > 0);
    if (rows.length)
      await tx.monthlyBudget.createMany({
        data: rows.map((item) => ({
          householdId: membership.householdId,
          month,
          categoryId: item.categoryId,
          amount: item.amount,
        })),
      });
    await tx.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "MonthlyBudget",
        entityId: monthParsed.data,
        action: "SAVE_BUDGET",
        after: {
          categories: rows.length,
          total: rows.reduce((sum, item) => sum + item.amount, 0),
        },
      },
    });
  });
  revalidatePath("/");
  return { success: true };
}

export async function closeFinancialMonth(
  monthKey: string,
): Promise<ActionState> {
  const parsed = monthResetSchema.safeParse(monthKey);
  if (!parsed.success) return { error: "Mês inválido." };
  const { user, membership } = await requireMembership();
  if (!["OWNER", "ADMIN"].includes(membership.role))
    return {
      error: "Somente proprietários e administradores podem fechar o mês.",
    };
  const month = monthStartUtc(parsed.data);
  const nextMonth = addUtcMonths(month, 1);
  const baseWhere = {
    householdId: membership.householdId,
    competenceDate: { gte: month, lt: nextMonth },
    status: { notIn: ["CANCELED", "REFUNDED"] as ("CANCELED" | "REFUNDED")[] },
  };
  const [transactions, budgets, splits] = await Promise.all([
    db.transaction.findMany({
      where: baseWhere,
      select: {
        type: true,
        status: true,
        amount: true,
        cardId: true,
        categoryId: true,
      },
    }),
    db.monthlyBudget.findMany({
      where: { householdId: membership.householdId, month },
      select: { amount: true },
    }),
    db.split.findMany({
      where: {
        transaction: { ...baseWhere, type: "EXPENSE" },
        status: { in: ["OPEN", "PARTIALLY_PAID"] },
      },
      select: { amount: true, paidAmount: true },
    }),
  ]);
  const expenses = transactions.filter((item) => item.type === "EXPENSE");
  const income = transactions
    .filter((item) => item.type === "INCOME")
    .reduce((sum, item) => sum + Number(item.amount), 0);
  const expense = expenses.reduce((sum, item) => sum + Number(item.amount), 0);
  const paid = expenses
    .filter((item) => item.status === "PAID")
    .reduce((sum, item) => sum + Number(item.amount), 0);
  const snapshot = {
    income,
    expense,
    paid,
    pending: expense - paid,
    receivables: splits.reduce(
      (sum, item) => sum + Number(item.amount) - Number(item.paidAmount),
      0,
    ),
    budget: budgets.reduce((sum, item) => sum + Number(item.amount), 0),
    unassignedCards: expenses.filter((item) => !item.cardId).length,
    uncategorized: expenses.filter((item) => !item.categoryId).length,
    transactionCount: transactions.length,
  };
  await db.$transaction([
    db.financialMonthClose.upsert({
      where: {
        householdId_month: { householdId: membership.householdId, month },
      },
      create: {
        householdId: membership.householdId,
        closedById: user.id,
        month,
        snapshot,
      },
      update: { closedById: user.id, snapshot, closedAt: new Date() },
    }),
    db.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "FinancialMonthClose",
        entityId: parsed.data,
        action: "CLOSE_MONTH",
        after: snapshot,
      },
    }),
  ]);
  revalidatePath("/");
  return { success: true };
}

export async function reopenFinancialMonth(
  monthKey: string,
): Promise<ActionState> {
  const parsed = monthResetSchema.safeParse(monthKey);
  if (!parsed.success) return { error: "Mês inválido." };
  const { user, membership } = await requireMembership();
  if (!["OWNER", "ADMIN"].includes(membership.role))
    return {
      error: "Somente proprietários e administradores podem reabrir o mês.",
    };
  const month = monthStartUtc(parsed.data);
  const removed = await db.financialMonthClose.deleteMany({
    where: { householdId: membership.householdId, month },
  });
  if (!removed.count) return { error: "Este mês não está fechado." };
  await db.auditLog.create({
    data: {
      householdId: membership.householdId,
      actorId: user.id,
      entity: "FinancialMonthClose",
      entityId: parsed.data,
      action: "REOPEN_MONTH",
    },
  });
  revalidatePath("/");
  return { success: true };
}

const debtSchema = z.object({
  name: z.string().trim().min(2).max(100),
  creditor: z.string().trim().max(100).optional(),
  originalAmount: z.coerce.number().positive(),
  outstandingBalance: z.coerce.number().positive(),
  monthlyInterestRate: z.coerce.number().min(0).max(100),
  installmentAmount: z.coerce.number().positive(),
  minimumPayment: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().positive().optional(),
  ),
  dueDay: optionalDay,
  remainingInstallments: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().positive().max(600).optional(),
  ),
  notes: z.string().trim().max(1000).optional(),
});
export async function createDebt(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = debtSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { error: "Confira saldo, parcela, juros e vencimento da dívida." };
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para cadastrar dívidas." };
  const debt = await db.debt.create({
    data: {
      householdId: membership.householdId,
      ...parsed.data,
      creditor: parsed.data.creditor || null,
      minimumPayment: parsed.data.minimumPayment || null,
      dueDay: parsed.data.dueDay || null,
      remainingInstallments: parsed.data.remainingInstallments || null,
      notes: parsed.data.notes || null,
    },
  });
  await db.auditLog.create({
    data: {
      householdId: membership.householdId,
      actorId: user.id,
      entity: "Debt",
      entityId: debt.id,
      action: "CREATE",
      after: {
        name: debt.name,
        balance: Number(debt.outstandingBalance),
        monthlyInterestRate: Number(debt.monthlyInterestRate),
      },
    },
  });
  revalidatePath("/");
  return { success: true };
}

export async function registerDebtPayment(
  debtId: string,
  input: unknown,
): Promise<ActionState> {
  const parsed = splitPaymentSchema.safeParse(input);
  if (!parsed.success) return { error: "Informe um pagamento válido." };
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para registrar pagamentos." };
  const debt = await db.debt.findFirst({
    where: {
      id: debtId,
      householdId: membership.householdId,
      status: { in: ["ACTIVE", "NEGOTIATING", "DEFAULTED"] },
    },
  });
  if (!debt) return { error: "Dívida não encontrada ou já quitada." };
  if (parsed.data.amount > Number(debt.outstandingBalance))
    return { error: "O pagamento não pode superar o saldo devedor." };
  const balance =
    Math.round((Number(debt.outstandingBalance) - parsed.data.amount) * 100) /
    100;
  const status = balance <= 0 ? ("PAID" as const) : debt.status;
  await db.$transaction([
    db.debtPayment.create({
      data: {
        debtId: debt.id,
        amount: parsed.data.amount,
        notes: parsed.data.notes || null,
      },
    }),
    db.debt.update({
      where: { id: debt.id },
      data: { outstandingBalance: balance, status },
    }),
    db.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "Debt",
        entityId: debt.id,
        action: "REGISTER_PAYMENT",
        before: {
          balance: Number(debt.outstandingBalance),
          status: debt.status,
        },
        after: { balance, status, payment: parsed.data.amount },
      },
    }),
  ]);
  revalidatePath("/");
  return { success: true };
}

export async function updateDebtStatus(
  debtId: string,
  status: unknown,
): Promise<ActionState> {
  const parsed = z
    .enum(["ACTIVE", "NEGOTIATING", "PAID", "DEFAULTED"])
    .safeParse(status);
  if (!parsed.success) return { error: "Status inválido." };
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para alterar dívidas." };
  const debt = await db.debt.findFirst({
    where: { id: debtId, householdId: membership.householdId },
  });
  if (!debt) return { error: "Dívida não encontrada." };
  if (parsed.data === "PAID" && Number(debt.outstandingBalance) > 0)
    return {
      error: "Registre o pagamento do saldo antes de marcar como quitada.",
    };
  await db.$transaction([
    db.debt.update({ where: { id: debt.id }, data: { status: parsed.data } }),
    db.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "Debt",
        entityId: debt.id,
        action: "CHANGE_STATUS",
        before: { status: debt.status },
        after: { status: parsed.data },
      },
    }),
  ]);
  revalidatePath("/");
  return { success: true };
}

const transferSchema = z
  .object({
    fromAccountId: z.string().min(1),
    toAccountId: z.string().min(1),
    amount: z.coerce.number().positive(),
    transferredAt: z.string().date(),
    description: z.string().trim().max(160).optional(),
  })
  .refine((value) => value.fromAccountId !== value.toAccountId, {
    message: "As contas devem ser diferentes.",
  });
export async function createAccountTransfer(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = transferSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { error: "Confira contas, data e valor da transferência." };
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para transferir entre contas." };
  const accounts = await db.account.findMany({
    where: {
      householdId: membership.householdId,
      active: true,
      id: { in: [parsed.data.fromAccountId, parsed.data.toAccountId] },
    },
    select: { id: true },
  });
  if (accounts.length !== 2)
    return {
      error: "Uma das contas não pertence à sua família ou está inativa.",
    };
  const transfer = await db.accountTransfer.create({
    data: {
      householdId: membership.householdId,
      fromAccountId: parsed.data.fromAccountId,
      toAccountId: parsed.data.toAccountId,
      amount: parsed.data.amount,
      transferredAt: new Date(`${parsed.data.transferredAt}T12:00:00`),
      description: parsed.data.description || null,
    },
  });
  await db.auditLog.create({
    data: {
      householdId: membership.householdId,
      actorId: user.id,
      entity: "AccountTransfer",
      entityId: transfer.id,
      action: "CREATE",
      after: {
        fromAccountId: transfer.fromAccountId,
        toAccountId: transfer.toAccountId,
        amount: Number(transfer.amount),
      },
    },
  });
  revalidatePath("/");
  return { success: true };
}

const attachmentSchema = z.object({
  key: z.string().min(10).max(500),
  fileName: z.string().trim().min(1).max(160),
  contentType: z.string().regex(/^(image\/(jpeg|png|webp)|application\/pdf)$/),
  kind: z.enum(["RECEIPT", "INVOICE", "OTHER"]).default("RECEIPT"),
});
export async function registerAttachment(
  transactionId: string,
  input: unknown,
): Promise<ActionState> {
  const parsed = attachmentSchema.safeParse(input);
  if (!parsed.success) return { error: "Comprovante inválido." };
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para anexar comprovantes." };
  const transaction = await db.transaction.findFirst({
    where: { id: transactionId, householdId: membership.householdId },
  });
  if (
    !transaction ||
    !parsed.data.key.startsWith(
      `households/${membership.householdId}/receipts/`,
    )
  )
    return { error: "Lançamento ou arquivo inválido." };
  const attachment = await db.attachment.create({
    data: { transactionId: transaction.id, ...parsed.data },
  });
  await db.auditLog.create({
    data: {
      householdId: membership.householdId,
      actorId: user.id,
      entity: "Attachment",
      entityId: attachment.id,
      action: "CREATE",
      after: {
        transactionId,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
      },
    },
  });
  revalidatePath("/");
  return { success: true };
}

export async function removeAttachment(
  attachmentId: string,
): Promise<ActionState> {
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para remover comprovantes." };
  const attachment = await db.attachment.findFirst({
    where: {
      id: attachmentId,
      transaction: { householdId: membership.householdId },
    },
  });
  if (!attachment) return { error: "Comprovante não encontrado." };
  await deleteObject(attachment.key);
  await db.$transaction([
    db.attachment.delete({ where: { id: attachment.id } }),
    db.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "Attachment",
        entityId: attachment.id,
        action: "DELETE",
        before: {
          transactionId: attachment.transactionId,
          fileName: attachment.fileName,
        },
      },
    }),
  ]);
  revalidatePath("/");
  return { success: true };
}

export async function reviewTransactionMatch(
  matchId: string,
  decision: "CONFIRMED" | "REJECTED",
): Promise<ActionState> {
  const parsed = z.enum(["CONFIRMED", "REJECTED"]).safeParse(decision);
  if (!parsed.success) return { error: "Decisão inválida." };
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para revisar conciliações." };
  const match = await db.transactionMatch.findFirst({
    where: {
      id: matchId,
      householdId: membership.householdId,
      status: "SUGGESTED",
    },
  });
  if (!match) return { error: "Sugestão não encontrada ou já revisada." };
  await db.$transaction([
    db.transactionMatch.update({
      where: { id: match.id },
      data: { status: parsed.data },
    }),
    db.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "TransactionMatch",
        entityId: match.id,
        action: parsed.data,
        after: {
          externalTransactionId: match.externalTransactionId,
          transactionId: match.transactionId,
          confidence: Number(match.confidence),
        },
      },
    }),
  ]);
  revalidatePath("/");
  return { success: true };
}

export async function importExternalTransaction(
  externalTransactionId: string,
): Promise<ActionState> {
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para importar movimentações bancárias." };
  const external = await db.externalTransaction.findFirst({
    where: {
      id: externalTransactionId,
      externalAccount: {
        connection: {
          householdId: membership.householdId,
          status: { not: "REVOKED" },
        },
      },
    },
    include: { externalAccount: true, match: true },
  });
  if (!external) return { error: "Movimentação externa não encontrada." };
  if (external.match?.status === "IMPORTED")
    return { error: "Esta movimentação já foi importada." };
  const externalRef = `pluggy:${external.id}`;
  const duplicate = await db.transaction.findFirst({
    where: { householdId: membership.householdId, externalRef },
  });
  if (duplicate) return { error: "Esta movimentação já possui um lançamento." };
  const type =
    external.type.toUpperCase() === "CREDIT"
      ? ("INCOME" as const)
      : ("EXPENSE" as const);
  const date = external.transactionDate;
  const competenceDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
  );
  const status =
    external.externalAccount.type.toUpperCase() === "BANK" &&
    external.status.toUpperCase() === "POSTED"
      ? ("PAID" as const)
      : ("PENDING" as const);
  const transaction = await db.$transaction(async (tx) => {
    const created = await tx.transaction.create({
      data: {
        householdId: membership.householdId,
        type,
        status,
        description: external.description,
        merchant: external.merchant,
        amount: Math.abs(Number(external.amount)),
        purchasedAt: date,
        competenceDate,
        paidAt: status === "PAID" ? date : null,
        externalRef,
        notes: `Importado da conta externa ${external.externalAccount.name}.`,
      },
    });
    await tx.transactionMatch.upsert({
      where: { externalTransactionId: external.id },
      create: {
        householdId: membership.householdId,
        externalTransactionId: external.id,
        transactionId: created.id,
        confidence: 1,
        status: "IMPORTED",
        reasons: { importedByUser: true },
      },
      update: {
        transactionId: created.id,
        confidence: 1,
        status: "IMPORTED",
        reasons: { importedByUser: true },
      },
    });
    await tx.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "ExternalTransaction",
        entityId: external.id,
        action: "IMPORT",
        after: {
          transactionId: created.id,
          amount: Number(created.amount),
          type,
          status,
        },
      },
    });
    return created;
  });
  revalidatePath("/");
  return { success: Boolean(transaction) };
}
