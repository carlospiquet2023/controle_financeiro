import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const DAILY_AI_ANALYSIS_LIMIT = 5;

export function saoPauloUsageDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return new Date(`${value("year")}-${value("month")}-${value("day")}T00:00:00.000Z`);
}

export async function reserveDailyAnalysis(userId: string) {
  const usageDate = saoPauloUsageDate();
  const rows = await db.$queryRaw<{ count: number }[]>(Prisma.sql`
    INSERT INTO "AiDailyUsage" ("id", "userId", "usageDate", "count", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${userId}, ${usageDate}, 1, NOW(), NOW())
    ON CONFLICT ("userId", "usageDate") DO UPDATE
      SET "count" = "AiDailyUsage"."count" + 1, "updatedAt" = NOW()
      WHERE "AiDailyUsage"."count" < ${DAILY_AI_ANALYSIS_LIMIT}
    RETURNING "count"
  `);
  const used = rows[0]?.count ?? DAILY_AI_ANALYSIS_LIMIT;
  return { allowed: rows.length > 0, used, remaining: Math.max(DAILY_AI_ANALYSIS_LIMIT - used, 0), limit: DAILY_AI_ANALYSIS_LIMIT, usageDate };
}

export async function releaseDailyAnalysis(userId: string, usageDate: Date) {
  await db.aiDailyUsage.updateMany({
    where: { userId, usageDate, count: { gt: 0 } },
    data: { count: { decrement: 1 } },
  });
}
