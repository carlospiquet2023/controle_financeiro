import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z.object({ adviceId: z.string().uuid(), feedback: z.enum(["DISAGREE", "HELPFUL"]) });
export async function POST(request: Request) {
  try {
    const { user, membership } = await requireMembership(); const input = schema.parse(await request.json());
    const advice = await db.auditLog.findFirst({ where: { householdId: membership.householdId, entityId: input.adviceId, action: "AI_ADVICE" } });
    if (!advice) throw new Error("Análise não encontrada.");
    await db.auditLog.create({ data: { householdId: membership.householdId, actorId: user.id, entity: "EconomicAdvice", entityId: input.adviceId, action: "AI_ADVICE_FEEDBACK", after: { feedback: input.feedback } } });
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível registrar sua revisão." }, { status: 400 }); }
}
