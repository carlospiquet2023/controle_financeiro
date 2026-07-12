"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  calculateTaxSimulation,
  TAX_RULE_CODE,
  TAX_RULE_SOURCE,
  TRANSITION_RULES,
} from "@/lib/tax";

export type TaxSimulationState = {
  error?: string;
  result?: ReturnType<typeof calculateTaxSimulation>;
};
const simulationSchema = z.object({
  amount: z.coerce.number().positive(),
  priceMode: z.enum(["NET", "GROSS"]),
  operationDate: z.string().date(),
  mode: z.enum(["FAMILY", "BUSINESS"]),
  cbsRate: z.coerce.number().min(0).max(100),
  ibsStateRate: z.coerce.number().min(0).max(100),
  ibsCityRate: z.coerce.number().min(0).max(100),
  selectiveTaxRate: z.coerce.number().min(0).max(100),
  legacyTaxAmount: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().min(0).optional(),
  ),
  description: z.string().trim().max(160).optional(),
});

async function ruleVersion() {
  return db.taxRuleVersion.upsert({
    where: { code: TAX_RULE_CODE },
    create: {
      code: TAX_RULE_CODE,
      name: "Transição oficial RTC — posição de 03/07/2026",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      sourceUrl: TAX_RULE_SOURCE,
      rules: JSON.parse(
        JSON.stringify(TRANSITION_RULES),
      ) as Prisma.InputJsonValue,
    },
    update: {
      name: "Transição oficial RTC — posição de 03/07/2026",
      sourceUrl: TAX_RULE_SOURCE,
      rules: JSON.parse(
        JSON.stringify(TRANSITION_RULES),
      ) as Prisma.InputJsonValue,
      fetchedAt: new Date(),
    },
  });
}

export async function simulateTax(
  _: TaxSimulationState,
  formData: FormData,
): Promise<TaxSimulationState> {
  const parsed = simulationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { error: "Confira valor, data e alíquotas da simulação." };
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para registrar simulações." };
  const rule = await ruleVersion();
  const result = calculateTaxSimulation(parsed.data);
  await db.$transaction(async (tx) => {
    const simulation = await tx.taxSimulation.create({
      data: {
        householdId: membership.householdId,
        ruleVersionId: rule.id,
        mode: parsed.data.mode,
        operationDate: new Date(`${parsed.data.operationDate}T00:00:00Z`),
        input: parsed.data as Prisma.InputJsonValue,
        result: result as unknown as Prisma.InputJsonValue,
        createdById: user.id,
      },
    });
    await tx.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "TaxSimulation",
        entityId: simulation.id,
        action: "SIMULATE",
        after: {
          year: result.year,
          mode: parsed.data.mode,
          baseAmount: result.baseAmount,
          taxTotal: result.taxTotal,
          ruleVersion: TAX_RULE_CODE,
        },
      },
    });
  });
  revalidatePath("/");
  return { result };
}

export async function createTransactionFromTaxDocument(documentId: string) {
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para criar lançamentos." };
  const document = await db.taxDocument.findFirst({
    where: { id: documentId, householdId: membership.householdId },
  });
  if (!document) return { error: "Documento fiscal não encontrado." };
  const externalRef = `tax-document:${document.id}`;
  if (
    await db.transaction.findFirst({
      where: { householdId: membership.householdId, externalRef },
    })
  )
    return { error: "Este documento fiscal já gerou um lançamento." };
  const date = document.issuedAt || new Date();
  const competenceDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
  );
  const transaction = await db.$transaction(async (tx) => {
    const created = await tx.transaction.create({
      data: {
        householdId: membership.householdId,
        type: "EXPENSE",
        status: "PENDING",
        description: document.issuerName || `Compra ${document.documentType}`,
        merchant: document.issuerName,
        amount: Number(document.totalAmount),
        purchasedAt: date,
        competenceDate,
        externalRef,
        notes: `Documento fiscal ${document.accessKey || document.fileName}. Tributos identificados: CBS ${Number(document.cbsAmount).toFixed(2)}, IBS ${(Number(document.ibsStateAmount) + Number(document.ibsCityAmount)).toFixed(2)}, IS ${Number(document.selectiveTaxAmount).toFixed(2)}.`,
      },
    });
    await tx.taxDocument.update({
      where: { id: document.id },
      data: { transactionId: created.id, status: "VALIDATED" },
    });
    await tx.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "TaxDocument",
        entityId: document.id,
        action: "CREATE_TRANSACTION",
        after: { transactionId: created.id, amount: Number(created.amount) },
      },
    });
    return created;
  });
  revalidatePath("/");
  return { success: true, transactionId: transaction.id };
}

const ledgerSchema = z.object({
  kind: z.enum([
    "DEBIT",
    "CREDIT",
    "PRESUMED_CREDIT",
    "ADJUSTMENT",
    "SETTLEMENT",
  ]),
  competenceDate: z.string().date(),
  description: z.string().trim().min(2).max(160),
  cbsAmount: z.coerce.number().min(0),
  ibsAmount: z.coerce.number().min(0),
  selectiveTaxAmount: z.coerce.number().min(0),
  sourceReference: z.string().trim().max(160).optional(),
});
export async function createTaxLedgerEntry(
  _: { error?: string; success?: boolean },
  formData: FormData,
) {
  const parsed = ledgerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { error: "Confira competência e valores fiscais." };
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para editar o livro fiscal." };
  const entry = await db.taxLedgerEntry.create({
    data: {
      householdId: membership.householdId,
      ...parsed.data,
      competenceDate: new Date(`${parsed.data.competenceDate}T00:00:00Z`),
      sourceReference: parsed.data.sourceReference || null,
    },
  });
  await db.auditLog.create({
    data: {
      householdId: membership.householdId,
      actorId: user.id,
      entity: "TaxLedgerEntry",
      entityId: entry.id,
      action: "CREATE",
      after: {
        kind: entry.kind,
        competenceDate: parsed.data.competenceDate,
        cbsAmount: Number(entry.cbsAmount),
        ibsAmount: Number(entry.ibsAmount),
      },
    },
  });
  revalidatePath("/");
  return { success: true };
}

const cashbackSchema = z.object({
  competence: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
  householdMembers: z.coerce.number().int().min(1).max(30),
  householdIncome: z.coerce.number().min(0),
  eligibleSpending: z.coerce.number().min(0),
  cbsPaid: z.coerce.number().min(0),
  ibsPaid: z.coerce.number().min(0),
  cbsRefundPercent: z.coerce.number().min(0).max(100),
  ibsRefundPercent: z.coerce.number().min(0).max(100),
  receivedAmount: z.coerce.number().min(0),
});

export async function saveTaxCashbackScenario(
  _: { error?: string; success?: boolean; estimatedAmount?: number },
  formData: FormData,
) {
  const parsed = cashbackSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { error: "Confira os dados do cenário de cashback." };
  const { user, membership } = await requireMembership();
  if (["VIEWER", "GUEST"].includes(membership.role))
    return { error: "Sem permissão para registrar cenários." };
  const input = parsed.data;
  const estimatedAmount =
    Math.round(
      ((input.cbsPaid * input.cbsRefundPercent) / 100 +
        (input.ibsPaid * input.ibsRefundPercent) / 100) *
        100,
    ) / 100;
  const competenceDate = new Date(`${input.competence}-01T00:00:00Z`);
  const inputs = {
    householdMembers: input.householdMembers,
    householdIncome: input.householdIncome,
    perCapitaIncome:
      Math.round((input.householdIncome / input.householdMembers) * 100) / 100,
    eligibleSpending: input.eligibleSpending,
    cbsPaid: input.cbsPaid,
    ibsPaid: input.ibsPaid,
    cbsRefundPercent: input.cbsRefundPercent,
    ibsRefundPercent: input.ibsRefundPercent,
    disclaimer:
      "Hipótese informativa; elegibilidade e valores dependem dos sistemas oficiais.",
  } as Prisma.InputJsonValue;
  const scenario = await db.taxCashback.upsert({
    where: {
      householdId_competenceDate: {
        householdId: membership.householdId,
        competenceDate,
      },
    },
    create: {
      householdId: membership.householdId,
      competenceDate,
      estimatedAmount,
      receivedAmount: input.receivedAmount,
      inputs,
    },
    update: { estimatedAmount, receivedAmount: input.receivedAmount, inputs },
  });
  await db.auditLog.create({
    data: {
      householdId: membership.householdId,
      actorId: user.id,
      entity: "TaxCashback",
      entityId: scenario.id,
      action: "UPSERT_SCENARIO",
      after: {
        competence: input.competence,
        estimatedAmount,
        receivedAmount: input.receivedAmount,
      },
    },
  });
  revalidatePath("/");
  return { success: true, estimatedAmount };
}
