import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "@/lib/auth";
import { syncPluggyItem } from "@/lib/pluggy";
import { db } from "@/lib/db";

const schema = z.object({ itemId: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const { user, membership } = await requireMembership();
    if (!["OWNER", "ADMIN"].includes(membership.role))
      return NextResponse.json(
        { error: "Sem permissão para registrar conexões." },
        { status: 403 },
      );
    const { itemId } = schema.parse(await request.json());
    const result = await syncPluggyItem(
      itemId,
      membership.householdId,
      "CONNECT_WIDGET",
    );
    await db.auditLog.create({
      data: {
        householdId: membership.householdId,
        actorId: user.id,
        entity: "FinancialConnection",
        entityId: result.connectionId,
        action: "CONNECT",
        after: {
          provider: "PLUGGY",
          accounts: result.accounts,
          transactions: result.transactions,
        },
      },
    });
    return NextResponse.json({ ok: true, ...result, actorId: user.id });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível sincronizar a conexão.",
      },
      { status: 400 },
    );
  }
}
