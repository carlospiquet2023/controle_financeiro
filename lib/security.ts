import { createHash, randomUUID } from "crypto";
import { db } from "@/lib/db";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

export const normalizeEmail = (email: string) => email.trim().toLocaleLowerCase("pt-BR");
const emailHash = (email: string) => createHash("sha256").update(normalizeEmail(email)).digest("hex");

export async function loginAllowed(email: string, now = new Date()) {
  const throttle = await db.loginThrottle.findUnique({ where: { emailHash: emailHash(email) } });
  return !throttle?.lockedUntil || throttle.lockedUntil <= now;
}

export async function recordLoginFailure(email: string, now = new Date()) {
  const hash = emailHash(email);
  const existing = await db.loginThrottle.findUnique({ where: { emailHash: hash } });
  const insideWindow = existing && now.getTime() - existing.windowStartedAt.getTime() < LOGIN_WINDOW_MS;
  const attempts = insideWindow ? existing.failedAttempts + 1 : 1;
  const lockedUntil = attempts >= LOGIN_MAX_FAILURES ? new Date(now.getTime() + LOGIN_LOCK_MS) : null;
  await db.loginThrottle.upsert({
    where: { emailHash: hash },
    create: { id: randomUUID(), emailHash: hash, failedAttempts: lockedUntil ? 0 : attempts, windowStartedAt: now, lockedUntil },
    update: { failedAttempts: lockedUntil ? 0 : attempts, windowStartedAt: insideWindow ? existing!.windowStartedAt : now, lockedUntil },
  });
  return { locked: Boolean(lockedUntil), lockedUntil };
}

export async function clearLoginFailures(email: string) {
  await db.loginThrottle.deleteMany({ where: { emailHash: emailHash(email) } });
}

export async function pwnedPasswordCount(password: string): Promise<number | null> {
  const digest = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "Finora/1.0 (security@finora.local)" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const match = (await response.text()).split(/\r?\n/).find((line) => line.startsWith(`${suffix}:`));
    return match ? Number(match.split(":")[1]) || 1 : 0;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function authSecret() {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET precisa ter no mínimo 32 caracteres.");
  return "development-only-change-me-please-32chars";
}
