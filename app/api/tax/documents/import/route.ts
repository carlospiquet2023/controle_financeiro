import { createHash, randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { uploadObject } from "@/lib/r2";
import { parseTaxXml } from "@/lib/tax-xml";

export async function POST(request: Request) {
  try {
    const { user, membership } = await requireMembership();
    if (["VIEWER", "GUEST"].includes(membership.role)) return NextResponse.json({ error: "Sem permissão para importar documentos fiscais." }, { status: 403 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Selecione um XML de NF-e ou NFC-e.");
    if (!file.name.toLocaleLowerCase("pt-BR").endsWith(".xml")) throw new Error("O documento precisa ter extensão .xml.");
    if (file.size < 1 || file.size > 10 * 1024 * 1024) throw new Error("O XML deve ter no máximo 10 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (await db.taxDocument.findFirst({ where: { householdId: membership.householdId, sourceHash: hash } })) return NextResponse.json({ error: "Este documento fiscal já foi importado." }, { status: 409 });
    const parsed = parseTaxXml(new TextDecoder("utf-8").decode(bytes));
    const key = `households/${membership.householdId}/tax-documents/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.xml`;
    await uploadObject(key, bytes, file.type || "application/xml", { sha256: hash, originalname: encodeURIComponent(file.name).slice(0, 900) });
    const document = await db.$transaction(async (tx) => {
      const created = await tx.taxDocument.create({ data: { householdId: membership.householdId, sourceKey: key, sourceHash: hash, fileName: file.name, documentType: parsed.documentType, accessKey: parsed.accessKey, issuerName: parsed.issuerName, issuerDocument: parsed.issuerDocument, issuedAt: parsed.issuedAt && !Number.isNaN(parsed.issuedAt.getTime()) ? parsed.issuedAt : null, totalAmount: parsed.totalAmount, cbsAmount: parsed.cbsAmount, ibsStateAmount: parsed.ibsStateAmount, ibsCityAmount: parsed.ibsCityAmount, selectiveTaxAmount: parsed.selectiveTaxAmount, status: "NEEDS_REVIEW", calculationSource: "Valores destacados no XML do emissor", rawSummary: { itemCount: parsed.items.length } as Prisma.InputJsonValue } });
      if (parsed.items.length) await tx.taxDocumentItem.createMany({ data: parsed.items.map((item) => ({ taxDocumentId: created.id, ...item })) });
      await tx.auditLog.create({ data: { householdId: membership.householdId, actorId: user.id, entity: "TaxDocument", entityId: created.id, action: "IMPORT_XML", after: { documentType: created.documentType, issuerName: created.issuerName, totalAmount: Number(created.totalAmount), itemCount: parsed.items.length, cbsAmount: Number(created.cbsAmount), ibsAmount: Number(created.ibsStateAmount) + Number(created.ibsCityAmount), selectiveTaxAmount: Number(created.selectiveTaxAmount) } } });
      return created;
    });
    return NextResponse.json({ ok: true, document: { id: document.id, type: document.documentType, issuerName: document.issuerName, totalAmount: Number(document.totalAmount), items: parsed.items.length } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível importar o documento fiscal." }, { status: 400 });
  }
}
