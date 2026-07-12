import { timingSafeEqual } from "crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { syncPluggyItem } from "@/lib/pluggy";

const eventSchema = z
  .object({
    event: z.string().min(1),
    eventId: z.string().min(1),
    itemId: z.string().optional(),
    accountId: z.string().optional(),
    transactionIds: z.array(z.string()).optional(),
  })
  .passthrough();

function validSecret(request: Request) {
  const expected = process.env.PLUGGY_WEBHOOK_SECRET;
  const received = request.headers.get("x-finora-webhook-secret");
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  if (!validSecret(request))
    return NextResponse.json(
      { error: "Webhook não autorizado." },
      { status: 401 },
    );
  let eventId: string | null = null;
  try {
    const payload = eventSchema.parse(await request.json());
    eventId = payload.eventId;
    const existing = await db.webhookEvent.findUnique({
      where: {
        provider_externalEventId: {
          provider: "PLUGGY",
          externalEventId: payload.eventId,
        },
      },
    });
    if (existing?.processedAt)
      return NextResponse.json({ ok: true, duplicate: true });
    const connection = payload.itemId
      ? await db.financialConnection.findUnique({
          where: {
            provider_externalItemId: {
              provider: "PLUGGY",
              externalItemId: payload.itemId,
            },
          },
        })
      : null;
    const event =
      existing ||
      (await db.webhookEvent.create({
        data: {
          householdId: connection?.householdId,
          provider: "PLUGGY",
          externalEventId: payload.eventId,
          eventType: payload.event,
          payload: payload as Prisma.InputJsonValue,
        },
      }));

    if (payload.event === "item/deleted" && connection) {
      await db.financialConnection.update({
        where: { id: connection.id },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
    } else if (
      payload.event === "transactions/deleted" &&
      connection &&
      payload.accountId &&
      payload.transactionIds?.length
    ) {
      const account = await db.externalAccount.findFirst({
        where: { connectionId: connection.id, externalId: payload.accountId },
      });
      if (account)
        await db.externalTransaction.deleteMany({
          where: {
            externalAccountId: account.id,
            externalId: { in: payload.transactionIds },
          },
        });
    } else if (
      payload.itemId &&
      [
        "item/created",
        "item/updated",
        "transactions/created",
        "transactions/updated",
      ].includes(payload.event)
    ) {
      await syncPluggyItem(
        payload.itemId,
        connection?.householdId,
        `WEBHOOK:${payload.event}`,
      );
    } else if (
      connection &&
      [
        "item/error",
        "item/waiting_user_input",
        "item/waiting_user_action",
      ].includes(payload.event)
    ) {
      await db.financialConnection.update({
        where: { id: connection.id },
        data: { status: "REAUTH_REQUIRED", errorMessage: payload.event },
      });
    }
    await db.webhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date(), errorMessage: null },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao processar webhook.";
    if (eventId)
      await db.webhookEvent
        .updateMany({
          where: { provider: "PLUGGY", externalEventId: eventId },
          data: { errorMessage: message },
        })
        .catch(() => undefined);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
