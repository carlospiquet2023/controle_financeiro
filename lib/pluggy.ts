import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { transactionMatchScore } from "@/lib/transaction-matching";

const API = "https://api.pluggy.ai";
type TokenCache = { value: string; expiresAt: number };
const globalPluggy = global as typeof globalThis & { pluggyToken?: TokenCache };
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export const pluggyConfigured = () =>
  Boolean(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET);

async function apiKey() {
  if (
    globalPluggy.pluggyToken &&
    globalPluggy.pluggyToken.expiresAt > Date.now()
  )
    return globalPluggy.pluggyToken.value;
  if (!process.env.PLUGGY_CLIENT_ID || !process.env.PLUGGY_CLIENT_SECRET)
    throw new Error("Open Finance ainda não está configurado.");
  const response = await fetch(`${API}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: process.env.PLUGGY_CLIENT_ID,
      clientSecret: process.env.PLUGGY_CLIENT_SECRET,
    }),
    cache: "no-store",
  });
  const data = (await response.json()) as { apiKey?: string; message?: string };
  if (!response.ok || !data.apiKey)
    throw new Error(data.message || "Não foi possível autenticar na Pluggy.");
  globalPluggy.pluggyToken = {
    value: data.apiKey,
    expiresAt: Date.now() + 110 * 60 * 1000,
  };
  return data.apiKey;
}

export async function pluggyRequest<T>(path: string, init: RequestInit = {}) {
  const token = await apiKey();
  const response = await fetch(
    path.startsWith("http") ? path : `${API}${path}`,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": token,
        ...init.headers,
      },
      cache: "no-store",
    },
  );
  const data = (await response.json().catch(() => ({}))) as T & {
    message?: string;
  };
  if (!response.ok)
    throw new Error(data.message || `Pluggy respondeu ${response.status}.`);
  return data;
}

export async function createPluggyConnectToken(householdId: string) {
  return pluggyRequest<{ accessToken?: string; connectToken?: string }>(
    "/connect_token",
    {
      method: "POST",
      body: JSON.stringify({
        options: { clientUserId: householdId, avoidDuplicates: true },
      }),
    },
  );
}

type PluggyItem = {
  id: string;
  status?: string;
  executionStatus?: string;
  clientUserId?: string;
  connector?: { id?: number; name?: string };
  consentExpiresAt?: string | null;
  error?: { code?: string; message?: string } | null;
};
type PluggyAccount = {
  id: string;
  type?: string;
  subtype?: string;
  name?: string;
  number?: string;
  balance?: number;
  currencyCode?: string;
  creditData?: { creditLimit?: number };
} & Record<string, unknown>;
type PluggyTransaction = {
  id: string;
  accountId: string;
  type?: string;
  status?: string;
  description?: string;
  descriptionRaw?: string;
  merchant?: { name?: string } | string | null;
  category?: string;
  amount: number;
  currencyCode?: string;
  date: string;
} & Record<string, unknown>;

async function fetchAllTransactions(accountId: string) {
  const all: PluggyTransaction[] = [];
  let path = `/v2/transactions?accountId=${encodeURIComponent(accountId)}`;
  for (let page = 0; page < 50 && path; page++) {
    const data = await pluggyRequest<{
      results?: PluggyTransaction[];
      next?: string | null;
    }>(path);
    all.push(...(data.results || []));
    path = data.next
      ? data.next.startsWith("http")
        ? data.next
        : data.next.startsWith("?")
          ? `/v2/transactions${data.next}`
          : data.next.startsWith("/")
            ? data.next
            : `/v2/transactions?${data.next}`
      : "";
  }
  return all;
}

async function suggestMatch(
  householdId: string,
  externalTransactionId: string,
  transaction: PluggyTransaction,
) {
  const date = new Date(transaction.date);
  const start = new Date(date.getTime() - 4 * 86_400_000);
  const end = new Date(date.getTime() + 4 * 86_400_000);
  const amount = Math.abs(Number(transaction.amount));
  const candidates = await db.transaction.findMany({
    where: {
      householdId,
      amount: { gte: Math.max(amount - 1, 0), lte: amount + 1 },
      status: { notIn: ["CANCELED", "REFUNDED"] },
      OR: [
        { purchasedAt: { gte: start, lte: end } },
        { dueDate: { gte: start, lte: end } },
        { competenceDate: { gte: start, lte: end } },
      ],
    },
    take: 20,
  });
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      ...transactionMatchScore(
        {
          amount,
          date,
          description:
            transaction.description || transaction.descriptionRaw || "",
        },
        {
          amount: Number(candidate.amount),
          date:
            candidate.purchasedAt ||
            candidate.dueDate ||
            candidate.competenceDate,
          description: candidate.description,
        },
      ),
    }))
    .sort((a, b) => b.confidence - a.confidence);
  const best = ranked[0];
  if (!best || best.confidence < 0.72) return;
  const current = await db.transactionMatch.findUnique({
    where: { externalTransactionId },
  });
  if (current && current.status !== "SUGGESTED") return;
  await db.transactionMatch.upsert({
    where: { externalTransactionId },
    create: {
      householdId,
      externalTransactionId,
      transactionId: best.candidate.id,
      confidence: best.confidence,
      reasons: best.reasons,
    },
    update: {
      transactionId: best.candidate.id,
      confidence: best.confidence,
      reasons: best.reasons,
    },
  });
}

export async function syncPluggyItem(
  itemId: string,
  expectedHouseholdId?: string,
  trigger = "MANUAL",
) {
  const item = await pluggyRequest<PluggyItem>(`/items/${itemId}`);
  const householdId = expectedHouseholdId || item.clientUserId;
  if (!householdId || (item.clientUserId && item.clientUserId !== householdId))
    throw new Error("A conexão não pertence à família atual.");
  const household = await db.household.findUnique({
    where: { id: householdId },
    select: { id: true },
  });
  if (!household) throw new Error("Família da conexão não encontrada.");
  const connection = await db.financialConnection.upsert({
    where: {
      provider_externalItemId: { provider: "PLUGGY", externalItemId: item.id },
    },
    create: {
      householdId,
      externalItemId: item.id,
      connectorId: item.connector?.id ? String(item.connector.id) : null,
      connectorName: item.connector?.name || null,
      status:
        item.status === "UPDATED" || item.status === "SUCCESS"
          ? "ACTIVE"
          : "SYNCING",
      consentExpiresAt: item.consentExpiresAt
        ? new Date(item.consentExpiresAt)
        : null,
    },
    update: {
      connectorId: item.connector?.id ? String(item.connector.id) : undefined,
      connectorName: item.connector?.name || undefined,
      status: item.error
        ? "ERROR"
        : item.status === "UPDATED" || item.status === "SUCCESS"
          ? "ACTIVE"
          : "SYNCING",
      consentExpiresAt: item.consentExpiresAt
        ? new Date(item.consentExpiresAt)
        : null,
      errorCode: item.error?.code || null,
      errorMessage: item.error?.message || null,
    },
  });
  if (connection.householdId !== householdId)
    throw new Error("Conexão já vinculada a outra família.");
  await db.consentRecord.upsert({
    where: {
      connectionId_externalConsentId: {
        connectionId: connection.id,
        externalConsentId: item.id,
      },
    },
    create: {
      connectionId: connection.id,
      externalConsentId: item.id,
      products: [
        "ACCOUNTS",
        "CREDIT_CARDS",
        "TRANSACTIONS",
        "LOANS",
        "INVESTMENTS",
      ],
      permissions: { source: "PLUGGY_CONNECT", clientUserId: householdId },
      grantedAt: connection.createdAt,
      expiresAt: item.consentExpiresAt ? new Date(item.consentExpiresAt) : null,
    },
    update: {
      expiresAt: item.consentExpiresAt ? new Date(item.consentExpiresAt) : null,
      revokedAt: null,
    },
  });
  const job = await db.syncJob.create({
    data: {
      connectionId: connection.id,
      status: "RUNNING",
      trigger,
      startedAt: new Date(),
    },
  });
  try {
    const accountResponse = await pluggyRequest<{ results?: PluggyAccount[] }>(
      `/accounts?itemId=${encodeURIComponent(item.id)}`,
    );
    let transactionCount = 0;
    for (const account of accountResponse.results || []) {
      const externalAccount = await db.externalAccount.upsert({
        where: {
          connectionId_externalId: {
            connectionId: connection.id,
            externalId: account.id,
          },
        },
        create: {
          connectionId: connection.id,
          externalId: account.id,
          type: account.type || "UNKNOWN",
          subtype: account.subtype || null,
          name: account.name || "Conta externa",
          numberMasked: account.number || null,
          currency: account.currencyCode || "BRL",
          balance: typeof account.balance === "number" ? account.balance : null,
          creditLimit:
            typeof account.creditData?.creditLimit === "number"
              ? account.creditData.creditLimit
              : null,
          raw: json(account),
        },
        update: {
          type: account.type || "UNKNOWN",
          subtype: account.subtype || null,
          name: account.name || "Conta externa",
          numberMasked: account.number || null,
          currency: account.currencyCode || "BRL",
          balance: typeof account.balance === "number" ? account.balance : null,
          creditLimit:
            typeof account.creditData?.creditLimit === "number"
              ? account.creditData.creditLimit
              : null,
          raw: json(account),
          lastSyncedAt: new Date(),
        },
      });
      const transactions = await fetchAllTransactions(account.id);
      transactionCount += transactions.length;
      for (const transaction of transactions) {
        const merchant =
          typeof transaction.merchant === "string"
            ? transaction.merchant
            : transaction.merchant?.name || null;
        const external = await db.externalTransaction.upsert({
          where: {
            externalAccountId_externalId: {
              externalAccountId: externalAccount.id,
              externalId: transaction.id,
            },
          },
          create: {
            externalAccountId: externalAccount.id,
            externalId: transaction.id,
            type: transaction.type || "UNKNOWN",
            status: transaction.status || "UNKNOWN",
            description:
              transaction.description ||
              transaction.descriptionRaw ||
              "Transação bancária",
            merchant,
            category: transaction.category || null,
            amount: transaction.amount,
            currency: transaction.currencyCode || "BRL",
            transactionDate: new Date(transaction.date),
            raw: json(transaction),
          },
          update: {
            type: transaction.type || "UNKNOWN",
            status: transaction.status || "UNKNOWN",
            description:
              transaction.description ||
              transaction.descriptionRaw ||
              "Transação bancária",
            merchant,
            category: transaction.category || null,
            amount: transaction.amount,
            currency: transaction.currencyCode || "BRL",
            transactionDate: new Date(transaction.date),
            raw: json(transaction),
          },
        });
        await suggestMatch(householdId, external.id, transaction);
      }
    }
    await db.$transaction([
      db.syncJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          result: {
            accounts: accountResponse.results?.length || 0,
            transactions: transactionCount,
          },
        },
      }),
      db.financialConnection.update({
        where: { id: connection.id },
        data: {
          status: "ACTIVE",
          lastSyncAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      }),
    ]);
    return {
      connectionId: connection.id,
      accounts: accountResponse.results?.length || 0,
      transactions: transactionCount,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Sincronização falhou.";
    await db
      .$transaction([
        db.syncJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            finishedAt: new Date(),
            errorMessage: message,
          },
        }),
        db.financialConnection.update({
          where: { id: connection.id },
          data: { status: "ERROR", errorMessage: message },
        }),
      ])
      .catch(() => undefined);
    throw error;
  }
}

export async function deletePluggyItem(itemId: string) {
  await pluggyRequest(`/items/${itemId}`, { method: "DELETE" });
}
