import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { deletePluggyItem } from "@/lib/pluggy";

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, membership } = await requireMembership();
    if (!["OWNER", "ADMIN"].includes(membership.role))
      return NextResponse.json(
        { error: "Sem permissão para revogar conexões." },
        { status: 403 },
      );
    const { id } = await params;
    const connection = await db.financialConnection.findFirst({
      where: { id, householdId: membership.householdId, provider: "PLUGGY" },
    });
    if (!connection)
      return NextResponse.json(
        { error: "Conexão não encontrada." },
        { status: 404 },
      );
    await deletePluggyItem(connection.externalItemId).catch(() => undefined);
    await db.$transaction([
      db.financialConnection.update({
        where: { id: connection.id },
        data: { status: "REVOKED", revokedAt: new Date() },
      }),
      db.consentRecord.updateMany({
        where: { connectionId: connection.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      db.auditLog.create({
        data: {
          householdId: membership.householdId,
          actorId: user.id,
          entity: "FinancialConnection",
          entityId: connection.id,
          action: "REVOKE",
          after: { provider: connection.provider },
        },
      }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível revogar a conexão.",
      },
      { status: 400 },
    );
  }
}
