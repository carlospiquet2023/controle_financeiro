import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { signedDownloadUrl } from "@/lib/r2";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { membership } = await requireMembership();
    const { id } = await params;
    const attachment = await db.attachment.findFirst({ where: { id, transaction: { householdId: membership.householdId } } });
    if (!attachment) return NextResponse.json({ error: "Comprovante não encontrado." }, { status: 404 });
    return NextResponse.redirect(await signedDownloadUrl(attachment.key, attachment.fileName));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível abrir o comprovante." }, { status: 400 });
  }
}
