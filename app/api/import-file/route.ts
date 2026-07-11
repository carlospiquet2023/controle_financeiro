import { createHash, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { uploadObject } from "@/lib/r2";

const allowed = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
]);

export async function POST(request: Request) {
  try {
    const { membership } = await requireMembership();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Selecione uma planilha para importar.");
    if (file.size < 1 || file.size > 10 * 1024 * 1024) throw new Error("A planilha deve ter no máximo 10 MB.");
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["xlsx", "xls", "csv"].includes(extension)) throw new Error("Use um arquivo .xlsx, .xls ou .csv.");
    if (file.type && !allowed.has(file.type)) throw new Error("O tipo do arquivo não é permitido.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = createHash("sha256").update(bytes).digest("hex");
    const key = `households/${membership.householdId}/imports/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;
    await uploadObject(key, bytes, file.type || "application/octet-stream", { sha256: hash, originalname: encodeURIComponent(file.name).slice(0, 900) });
    return NextResponse.json({ key, hash });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível guardar a planilha." }, { status: 400 });
  }
}
