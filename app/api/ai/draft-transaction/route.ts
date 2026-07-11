import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createTransactionDraft } from "@/lib/ai";
import { requireMembership } from "@/lib/auth";
import { db } from "@/lib/db";

const requestSchema = z.object({ text: z.string().trim().min(8).max(1200) });

export async function POST(request: NextRequest) {
  try {
    const { user, membership } = await requireMembership(); const { text } = requestSchema.parse(await request.json());
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const used = await db.auditLog.count({ where: { householdId: membership.householdId, actorId: user.id, action: "AI_DRAFT", createdAt: { gte: hourAgo } } });
    if (used >= 15) return NextResponse.json({ error: "Limite de 15 sugestões por hora atingido. Tente novamente em breve." }, { status: 429 });
    const [cards, accounts, categories] = await Promise.all([db.card.findMany({ where: { householdId: membership.householdId, active: true }, select: { id: true, name: true } }), db.account.findMany({ where: { householdId: membership.householdId, active: true }, select: { id: true, name: true } }), db.category.findMany({ where: { householdId: membership.householdId }, select: { id: true, name: true } })]);
    const draft = await createTransactionDraft(text, { cards, accounts, categories });
    await db.auditLog.create({ data: { householdId: membership.householdId, actorId: user.id, entity: "AiDraft", entityId: crypto.randomUUID(), action: "AI_DRAFT", after: { confidence: draft.confidence } } });
    return NextResponse.json({ draft });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível gerar a sugestão." }, { status: 400 }); }
}
