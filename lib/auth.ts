import { createHash, randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { authSecret } from "@/lib/security";

const COOKIE = "finora_session";
const key = () => new TextEncoder().encode(authSecret());
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function createSession(userId: string) {
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  await db.session.create({ data: { userId, tokenHash: hash(raw), expiresAt } });
  const token = await new SignJWT({ sid: raw }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30d").sign(key());
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", expires: expiresAt, path: "/" });
}

export async function clearSession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, key());
      if (typeof payload.sid === "string") await db.session.deleteMany({ where: { tokenHash: hash(payload.sid) } });
    } catch {
      // O cookie ainda deve ser removido quando estiver inválido ou expirado.
    }
  }
  store.delete(COOKIE);
}

export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    const sid = payload.sid;
    if (typeof sid !== "string") return null;
    const session = await db.session.findUnique({ where: { tokenHash: hash(sid) }, include: { user: { include: { memberships: { include: { household: true } } } } } });
    if (!session || session.expiresAt < new Date()) return null;
    return session.user;
  } catch { return null; }
}

export async function requireMembership() {
  const user = await currentUser();
  if (!user?.memberships[0]) redirect("/entrar");
  return { user, membership: user.memberships[0] };
}
