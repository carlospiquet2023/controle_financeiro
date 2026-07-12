import { GoogleAuth } from "google-auth-library";
import { getObjectBytes } from "@/lib/r2";

type Entity = {
  type?: string;
  mentionText?: string;
  confidence?: number;
  normalizedValue?: {
    text?: string;
    moneyValue?: { units?: string | number; nanos?: number };
    dateValue?: { year?: number; month?: number; day?: number };
  };
  properties?: Entity[];
};
type DocumentResponse = { document?: { text?: string; entities?: Entity[] } };

export const ocrConfigured = () =>
  Boolean(
    process.env.GOOGLE_CLOUD_PROJECT &&
      process.env.GOOGLE_DOCUMENT_AI_LOCATION &&
      process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID,
  );

function normalized(entity: Entity) {
  const money = entity.normalizedValue?.moneyValue;
  if (money)
    return Number(money.units || 0) + Number(money.nanos || 0) / 1_000_000_000;
  const date = entity.normalizedValue?.dateValue;
  if (date?.year && date.month && date.day)
    return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
  return entity.normalizedValue?.text || entity.mentionText || null;
}

function firstField(fields: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = fields[name];
    if (Array.isArray(value) && value[0] !== undefined) return value[0];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

export async function processDocument(key: string, contentType: string) {
  if (!ocrConfigured())
    throw new Error(
      "OCR não configurado. Defina projeto, região e processorId do Google Document AI.",
    );
  const project = process.env.GOOGLE_CLOUD_PROJECT!;
  const location = process.env.GOOGLE_DOCUMENT_AI_LOCATION!;
  const processor = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID!;
  const bytes = await getObjectBytes(key);
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const url = `https://${location}-documentai.googleapis.com/v1/projects/${project}/locations/${location}/processors/${processor}:process`;
  const response = await client.request<DocumentResponse>({
    url,
    method: "POST",
    data: {
      rawDocument: {
        content: Buffer.from(bytes).toString("base64"),
        mimeType: contentType,
      },
      fieldMask: "text,entities",
    },
  });
  const document = response.data.document;
  const entities = document?.entities || [];
  const fields: Record<string, unknown> = {};
  const confidences: number[] = [];
  for (const entity of entities) {
    if (!entity.type) continue;
    if (typeof entity.confidence === "number")
      confidences.push(entity.confidence);
    const value = normalized(entity);
    if (fields[entity.type] === undefined) fields[entity.type] = value;
    else if (Array.isArray(fields[entity.type]))
      (fields[entity.type] as unknown[]).push(value);
    else fields[entity.type] = [fields[entity.type], value];
  }
  const confidence = confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : 0;
  const amount = firstField(fields, [
    "total_amount",
    "invoice_total",
    "net_amount",
    "total",
  ]);
  const suggestion = {
    description: firstField(fields, [
      "supplier_name",
      "vendor_name",
      "merchant_name",
      "receiver_name",
    ]),
    amount:
      typeof amount === "number"
        ? amount
        : Number(
            String(amount || "")
              .replace(/[^0-9,.-]/g, "")
              .replace(",", "."),
          ) || null,
    date: firstField(fields, ["invoice_date", "purchase_date", "receipt_date"]),
    dueDate: firstField(fields, ["due_date", "payment_due_date"]),
    documentNumber: firstField(fields, [
      "invoice_id",
      "invoice_number",
      "receipt_id",
    ]),
  };
  return {
    text: (document?.text || "").slice(0, 100_000),
    fields,
    suggestion,
    confidence: Math.round(confidence * 10_000) / 10_000,
  };
}
