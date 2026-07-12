import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncPluggyItem } from "@/lib/pluggy";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { membership } = await requireMembership();
    if (!["OWNER", "ADMIN"].includes(membership.role)) return NextResponse.json({ error: "Sem permissão para sincronizar conexões." }, { status: 403 });
    const { id } = await params;
    const connection = await db.financialConnection.findFirst({ where: { id, householdId: membership.householdId, provider: "PLUGGY" } });
    if (!connection) return NextResponse.json({ error: "Conexão não encontrada." }, { status: 404 });
    return NextResponse.json({ ok: true, ...await syncPluggyItem(connection.externalItemId, membership.householdId, "MANUAL") });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sincronização indisponível." }, { status: 400 });
  }
}
