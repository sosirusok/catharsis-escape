import { headers } from "next/headers";
import { runtimeEnv } from "@/lib/booking";
import { isAdminPagesOrigin } from "@/lib/request-origin";

export type AdminIdentity = { email: string; displayName: string };

export const ADMIN_SESSION_COOKIE = "__Host-catharsis_admin_session";
export const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function sessionSecret(): string {
  const secret = runtimeEnv().ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("ADMIN_SESSION_SECRET_UNAVAILABLE");
  return secret;
}

async function signSession(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64url(new Uint8Array(signature));
}

function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const segment of cookieHeader.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) continue;
    if (segment.slice(0, separator).trim() === name) {
      return segment.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

export async function adminAccessKeyMatches(candidate: string): Promise<boolean> {
  const expected = runtimeEnv().ADMIN_ACCESS_KEY;
  if (!expected || expected.length < 20) throw new Error("ADMIN_ACCESS_KEY_UNAVAILABLE");
  const [candidateDigest, expectedDigest] = await Promise.all([
    sha256Bytes(candidate),
    sha256Bytes(expected),
  ]);
  return constantTimeEqual(candidateDigest, expectedDigest);
}

type AdminSessionAudience = "site" | "github-pages";

export async function createAdminSession(audience: AdminSessionAudience = "site", now = Date.now()): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + ADMIN_SESSION_TTL_SECONDS;
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(18)));
  const payload = `v2.${audience}.${issuedAt}.${expiresAt}.${nonce}`;
  return `${payload}.${await signSession(payload)}`;
}

export async function verifyAdminSession(token: string | null, audience: AdminSessionAudience = "site", now = Date.now()): Promise<boolean> {
  if (!token || token.length > 512) return false;
  const parts = token.split(".");
  if (parts.length !== 6 || parts.some((part) => !part)) return false;
  const [version, tokenAudience, issuedText, expiresText, nonce, suppliedSignature] = parts;
  if (version !== "v2" || tokenAudience !== audience || !/^\d{10}$/.test(issuedText) || !/^\d{10}$/.test(expiresText)) return false;
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(nonce || "") || !/^[A-Za-z0-9_-]{40,60}$/.test(suppliedSignature || "")) return false;

  const issuedAt = Number(issuedText);
  const expiresAt = Number(expiresText);
  const current = Math.floor(now / 1000);
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) return false;
  if (issuedAt > current + 60 || expiresAt <= current || expiresAt - issuedAt !== ADMIN_SESSION_TTL_SECONDS) return false;

  try {
    const payload = `${version}.${tokenAudience}.${issuedText}.${expiresText}.${nonce}`;
    const expectedSignature = await signSession(payload);
    const [suppliedDigest, expectedDigest] = await Promise.all([
      sha256Bytes(suppliedSignature),
      sha256Bytes(expectedSignature),
    ]);
    return constantTimeEqual(suppliedDigest, expectedDigest);
  } catch {
    return false;
  }
}

export function adminSessionCookie(token: string): string {
  return `${ADMIN_SESSION_COOKIE}=${token}; Path=/; Max-Age=${ADMIN_SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearAdminSessionCookie(): string {
  return `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export async function getAdmin(request?: Request): Promise<AdminIdentity | null> {
  const requestHeaders = request?.headers ?? (await headers());
  const authorization = requestHeaders.get("authorization");
  const pagesRequest = Boolean(request && isAdminPagesOrigin(request));
  const bearer = pagesRequest
    ? authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1] || null
    : null;
  const cookie = pagesRequest ? null : cookieValue(requestHeaders.get("cookie"), ADMIN_SESSION_COOKIE);
  const valid = pagesRequest
    ? await verifyAdminSession(bearer, "github-pages")
    : await verifyAdminSession(cookie, "site");
  if (!valid) return null;
  return { email: "shared-access-key", displayName: "운영 관리자" };
}
