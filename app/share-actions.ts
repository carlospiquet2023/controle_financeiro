"use server";

import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { addUtcMonths, monthStartUtc } from "@/lib/format";
import { grantSharedAccess, sharedAccess, shareTokenHash } from "@/lib/share-access";

const monthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
const passwordSchema = z.string().regex(/^\d{6}$/);

export async function createSharedLedgerLink(monthKey: string, password: string) {
  const month = monthSchema.safeParse(monthKey);
  const pass = passwordSchema.safeParse(password);
  if (!month.success || !pass.success) return { error: "Informe uma senha com exatamente 6 números." };
  const { user, membership } = await requireMembership();
  if (!["OWNER", "ADMIN"].includes(membership.role)) return { error: "Somente proprietários e administradores podem compartilhar compromissos." };
  const rawToken = randomBytes(32).toString("base64url");
  const link = await db.sharedLedgerLink.create({ data: { householdId: membership.householdId, createdById: user.id, month: monthStartUtc(month.data), tokenHash: shareTokenHash(rawToken), passwordHash: await bcrypt.hash(pass.data, 12) } });
  await db.auditLog.create({ data: { householdId: membership.householdId, actorId: user.id, entity: "SharedLedgerLink", entityId: link.id, action: "CREATE_SHARE_LINK", after: { month: month.data } } });
  revalidatePath("/");
  return { success: true, linkId: link.id, path: `/compartilhar/${rawToken}` };
}

export async function revokeSharedLedgerLink(linkId: string) {
  const { user, membership } = await requireMembership();
  if (!["OWNER", "ADMIN"].includes(membership.role)) return { error: "Sem permissão para revogar este link." };
  const link = await db.sharedLedgerLink.findFirst({ where: { id: linkId, householdId: membership.householdId, active: true } });
  if (!link) return { error: "Link não encontrado ou já revogado." };
  await db.$transaction([
    db.sharedLedgerLink.update({ where: { id: link.id }, data: { active: false, revokedAt: new Date() } }),
    db.auditLog.create({ data: { householdId: membership.householdId, actorId: user.id, entity: "SharedLedgerLink", entityId: link.id, action: "REVOKE_SHARE_LINK" } }),
  ]);
  revalidatePath("/");
  return { success: true };
}

export async function unlockSharedLedger(token: string, formData: FormData) {
  const input = z.object({ name: z.string().trim().min(2).max(40), password: passwordSchema }).safeParse(Object.fromEntries(formData));
  if (!input.success) redirect(`/compartilhar/${token}?erro=dados`);
  const link = await db.sharedLedgerLink.findUnique({ where: { tokenHash: shareTokenHash(token) } });
  if (!link?.active) redirect(`/compartilhar/${token}?erro=indisponivel`);
  if (link.lockedUntil && link.lockedUntil > new Date()) redirect(`/compartilhar/${token}?erro=bloqueado`);
  const valid = await bcrypt.compare(input.data.password, link.passwordHash);
  if (!valid) {
    const attempts = link.failedAttempts + 1;
    await db.sharedLedgerLink.update({ where: { id: link.id }, data: { failedAttempts: attempts >= 5 ? 0 : attempts, lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null } });
    redirect(`/compartilhar/${token}?erro=senha`);
  }
  await db.sharedLedgerLink.update({ where: { id: link.id }, data: { failedAttempts: 0, lockedUntil: null } });
  await grantSharedAccess(link.id, input.data.name);
  redirect(`/compartilhar/${token}`);
}

export async function addSharedLedgerComment(token: string, transactionId: string, formData: FormData) {
  const message = z.string().trim().min(2).max(500).safeParse(formData.get("message"));
  if (!message.success) return;
  const link = await db.sharedLedgerLink.findUnique({ where: { tokenHash: shareTokenHash(token) } });
  if (!link?.active) return;
  const access = await sharedAccess(link.id);
  if (!access) return;
  const nextMonth = addUtcMonths(link.month, 1);
  const transaction = await db.transaction.findFirst({ where: { id: transactionId, householdId: link.householdId, type: "EXPENSE", competenceDate: { gte: link.month, lt: nextMonth }, status: { notIn: ["CANCELED", "REFUNDED"] } } });
  if (!transaction) return;
  await db.sharedLedgerComment.create({ data: { linkId: link.id, transactionId: transaction.id, authorName: access.authorName, message: message.data } });
  revalidatePath(`/compartilhar/${token}`);
}
