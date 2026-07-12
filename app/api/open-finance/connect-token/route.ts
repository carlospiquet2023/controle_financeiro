import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { createPluggyConnectToken, pluggyConfigured } from "@/lib/pluggy";

export async function POST() {
  try {
    const { membership } = await requireMembership();
    if (!["OWNER", "ADMIN"].includes(membership.role)) return NextResponse.json({ error: "Somente proprietários e administradores podem conectar instituições." }, { status: 403 });
    if (!pluggyConfigured()) return NextResponse.json({ configured: false, error: "Configure PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET para habilitar Open Finance." }, { status: 503 });
    const token = await createPluggyConnectToken(membership.householdId);
    return NextResponse.json({ configured: true, connectToken: token.accessToken || token.connectToken });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível iniciar a conexão bancária." }, { status: 400 });
  }
}
