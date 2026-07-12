import { createHash } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const key = () => new TextEncoder().encode(process.env.AUTH_SECRET || "development-only-change-me-please-32chars");
const cookieName = (linkId: string) => `finora_share_${linkId}`;

export const shareTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function grantSharedAccess(linkId: string, authorName: string) {
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  const token = await new SignJWT({ linkId, authorName }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(key());
  (await cookies()).set(cookieName(linkId), token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", expires: expiresAt, path: "/compartilhar" });
}

export async function sharedAccess(linkId: string) {
  const token = (await cookies()).get(cookieName(linkId))?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return payload.linkId === linkId && typeof payload.authorName === "string" ? { authorName: payload.authorName } : null;
  } catch {
    return null;
  }
}
