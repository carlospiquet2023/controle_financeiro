import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { processDocument } from "@/lib/ocr";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { user, membership } = await requireMembership();
    if (["VIEWER", "GUEST"].includes(membership.role))
      return NextResponse.json(
        { error: "Sem permissão para processar comprovantes." },
        { status: 403 },
      );
    const attachment = await db.attachment.findFirst({
      where: { id, transaction: { householdId: membership.householdId } },
    });
    if (!attachment)
      return NextResponse.json(
        { error: "Comprovante não encontrado." },
        { status: 404 },
      );
    await db.attachment.update({
      where: { id },
      data: {
        ocrStatus: "PROCESSING",
        ocrProvider: "GOOGLE_DOCUMENT_AI",
        ocrError: null,
      },
    });
    const result = await processDocument(
      attachment.key,
      attachment.contentType,
    );
    const status =
      result.confidence >= 0.85
        ? ("COMPLETED" as const)
        : ("NEEDS_REVIEW" as const);
    await db.$transaction([
      db.attachment.update({
        where: { id },
        data: {
          ocrStatus: status,
          extractedText: result.text,
          extractedData: {
            providerFields: result.fields,
            suggestion: result.suggestion,
          } as Prisma.InputJsonValue,
          confidence: result.confidence,
          processedAt: new Date(),
          ocrError: null,
        },
      }),
      db.auditLog.create({
        data: {
          householdId: membership.householdId,
          actorId: user.id,
          entity: "Attachment",
          entityId: id,
          action: "OCR_PROCESS",
          after: {
            provider: "GOOGLE_DOCUMENT_AI",
            confidence: result.confidence,
            status,
            fields: Object.keys(result.fields),
          },
        },
      }),
    ]);
    return NextResponse.json({
      ok: true,
      status,
      confidence: result.confidence,
      fields: result.fields,
      suggestion: result.suggestion,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OCR indisponível.";
    await db.attachment
      .updateMany({
        where: { id },
        data: {
          ocrStatus: "FAILED",
          ocrError: message,
          processedAt: new Date(),
        },
      })
      .catch(() => undefined);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
