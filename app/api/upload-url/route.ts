import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "@/lib/auth";
import { signedUploadUrl } from "@/lib/r2";

const bodySchema = z.object({ fileName: z.string().min(1).max(160), contentType: z.string().regex(/^(image\/(jpeg|png|webp)|application\/pdf)$/), fileSize: z.number().int().positive().max(10 * 1024 * 1024) });

export async function POST(request: NextRequest) {
  try {
    const { membership } = await requireMembership();
    if (["VIEWER", "GUEST"].includes(membership.role)) throw new Error("Seu perfil não tem permissão para enviar comprovantes.");
    const body = bodySchema.parse(await request.json());
    const extension = body.fileName.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "bin";
    const key = `households/${membership.householdId}/receipts/${randomUUID()}.${extension}`;
    return NextResponse.json({ key, uploadUrl: await signedUploadUrl(key, body.contentType, body.fileSize), expiresIn: 300 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível preparar o upload." }, { status: 400 }); }
}
