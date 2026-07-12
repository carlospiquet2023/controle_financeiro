import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const databaseUrl = process.env.DATABASE_PUBLIC_URL;
const appUrl = process.env.APP_URL;
const authSecret = process.env.AUTH_SECRET;
if (!databaseUrl || !appUrl || !authSecret) throw new Error("Configure DATABASE_PUBLIC_URL, APP_URL e AUTH_SECRET.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

async function main() {
  const target = await prisma.membership.findFirst({ where: { role: "OWNER", household: { importBatches: { some: { status: "IMPORTED" } } } }, select: { userId: true } });
  if (!target) throw new Error("Família com importação ativa não encontrada.");
  const raw = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  const session = await prisma.session.create({ data: { userId: target.userId, tokenHash, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
  const token = await new SignJWT({ sid: raw }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(authSecret));
  const headers = { Cookie: `finora_session=${token}` };
  try {
    const page = await fetch(`${appUrl}/?month=2026-07`, { headers });
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Conselho Econ[oô]mico/);
    assert.ok(html.includes("1.372,18") || html.includes("1372.18"), "Total conciliado não apareceu no HTML.");
    const advisor = await fetch(`${appUrl}/api/ai/advisor`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ message: "Faça um diagnóstico objetivo e informe a principal limitação dos dados.", month: "2026-07" }) });
    const result = await advisor.json();
    assert.equal(advisor.status, 200, result.error || "Conselho Econômico falhou.");
    assert.equal(result.advice.riskLevel, "INCOMPLETE");
    assert.ok(result.advice.basis.length > 0);
    const review = await fetch(`${appUrl}/api/ai/advisor/feedback`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ adviceId: result.adviceId, feedback: "HELPFUL" }) });
    assert.equal(review.status, 200);
    console.log(JSON.stringify({ ok: true, dashboard: page.status, totalVisible: true, advisor: advisor.status, riskLevel: result.advice.riskLevel, feedback: review.status }));
  } finally {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
