import Groq from "groq-sdk";
import { z } from "zod";

const draftSchema = z.object({
  description: z.string().min(2).max(120), amount: z.number().positive(), type: z.enum(["EXPENSE", "INCOME"]),
  competenceDate: z.string().date().nullable(), dueDate: z.string().date().nullable(), installmentCount: z.number().int().min(1).max(360),
  cardName: z.string().max(80).nullable(), accountName: z.string().max(80).nullable(), categoryName: z.string().max(80).nullable(), notes: z.string().max(600).nullable(), confidence: z.number().min(0).max(1),
});
export type TransactionDraft = z.infer<typeof draftSchema> & { cardId: string | null; accountId: string | null; categoryId: string | null };

const schema = { type: "object", additionalProperties: false, properties: {
  description: { type: "string" }, amount: { type: "number" }, type: { type: "string", enum: ["EXPENSE", "INCOME"] },
  competenceDate: { type: ["string", "null"] }, dueDate: { type: ["string", "null"] }, installmentCount: { type: "integer" },
  cardName: { type: ["string", "null"] }, accountName: { type: ["string", "null"] }, categoryName: { type: ["string", "null"] }, notes: { type: ["string", "null"] }, confidence: { type: "number" },
}, required: ["description", "amount", "type", "competenceDate", "dueDate", "installmentCount", "cardName", "accountName", "categoryName", "notes", "confidence"] } as const;

export async function createTransactionDraft(text: string, context: { cards: { id: string; name: string }[]; accounts: { id: string; name: string }[]; categories: { id: string; name: string }[] }) {
  if (!process.env.GROQ_API_KEY) throw new Error("A IA ainda não está configurada neste ambiente.");
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const response = await client.chat.completions.create({ model: process.env.GROQ_MODEL || "openai/gpt-oss-120b", reasoning_effort: "medium", temperature: 0.1, max_completion_tokens: 1000, messages: [{ role: "system", content: "Você extrai lançamentos financeiros em português do Brasil. Nunca invente datas, cartões, contas ou categorias: use null se não estiver explícito ou se não houver correspondência. Use a data de hoje apenas para interpretar palavras como hoje, amanhã e próximo mês. O valor deve ser o valor total da compra; parcelas é a quantidade total. Não faça aconselhamento financeiro. Responda estritamente no esquema solicitado." }, { role: "user", content: `Lançamento informado: ${text}\n\nCartões disponíveis: ${JSON.stringify(context.cards)}\nContas disponíveis: ${JSON.stringify(context.accounts)}\nCategorias disponíveis: ${JSON.stringify(context.categories)}` }], response_format: { type: "json_schema", json_schema: { name: "financial_transaction_draft", strict: true, schema } } });
  const content = response.choices[0]?.message.content;
  if (!content) throw new Error("A IA não retornou uma sugestão utilizável.");
  const draft = draftSchema.parse(JSON.parse(content));
  const same = (a: string | null, values: { id: string; name: string }[]) => a ? values.find(v => v.name.trim().toLocaleLowerCase("pt-BR") === a.trim().toLocaleLowerCase("pt-BR"))?.id ?? null : null;
  return { ...draft, cardId: same(draft.cardName, context.cards), accountId: same(draft.accountName, context.accounts), categoryId: same(draft.categoryName, context.categories) } satisfies TransactionDraft;
}
