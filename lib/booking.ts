import { DEFAULT_SETTINGS, DEFAULT_THEMES, type BookingSettingsRecord, type ThemeRecord } from "@/lib/models";
import { isPublicWebOriginAllowed } from "@/lib/request-origin";
export { DEFAULT_SETTINGS, DEFAULT_THEMES } from "@/lib/models";

export const DEFAULT_TIMES = [630, 720, 810, 900, 990, 1080, 1170, 1260, 1350];

export type RuntimeEnv = {
  DB?: D1Database;
  BUCKET?: R2Bucket;
  ADMIN_ACCESS_KEY?: string;
  ADMIN_SESSION_SECRET?: string;
  BOOKING_DATA_KEY?: string;
  BOOKING_LOOKUP_PEPPER?: string;
  NAVER_PAY_CLIENT_ID?: string;
  NAVER_PAY_CLIENT_SECRET?: string;
  NAVER_PAY_CHAIN_ID?: string;
  NAVER_PAY_MODE?: string;
  NAVER_PAY_TAX_SCOPE?: string;
  PAYMENT_PROVIDER?: string;
  TOSS_CLIENT_KEY?: string;
  TOSS_SECRET_KEY?: string;
  ALLOW_PUBLIC_TEST_PAYMENTS?: string;
  PUBLIC_SITE_URL?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
  FIREBASE_PRIVATE_KEY_ID?: string;
};

export function getBucket(): R2Bucket {
  const bucket = runtimeEnv().BUCKET;
  if (!bucket) throw new Error("BOOKING_BUCKET_UNAVAILABLE");
  return bucket;
}

export function runtimeEnv(): RuntimeEnv {
  return (globalThis as typeof globalThis & { __SITES_ENV__?: RuntimeEnv }).__SITES_ENV__ || {};
}

export function getD1(): D1Database {
  const db = runtimeEnv().DB;
  if (!db) throw new Error("BOOKING_DATABASE_UNAVAILABLE");
  return db;
}

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function publicError(code: string, message: string, status: number) {
  return json({ ok: false, error: { code, message } }, status);
}

export async function readJsonBody<T>(request: Request, maximumBytes: number): Promise<T> {
  const declared = Number(request.headers.get("content-length") || "0");
  if (declared > maximumBytes) throw new Error("PAYLOAD_TOO_LARGE");
  if (!request.body) throw new Error("INVALID_JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("PAYLOAD_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("INVALID_JSON"); }
  try { return JSON.parse(raw) as T; }
  catch { throw new Error("INVALID_JSON"); }
}

export function isJsonRequest(request: Request): boolean {
  return request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

export function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return /^01[016789]\d{7,8}$/.test(digits) ? digits : null;
}

export function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 30 ? name : null;
}

export function isDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function minuteToTime(minute: number): string {
  const hour = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function timeToMinute(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

export function kstDateKey(timestamp = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function weekdayKst(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00+09:00`).getUTCDay();
}

export function startAtUtcMs(dateKey: string, startMinute: number): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  const hour = Math.floor(startMinute / 60);
  const minute = startMinute % 60;
  return Date.UTC(year, month - 1, day, hour - 9, minute);
}

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function createBookingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "CT-";
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return code;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveAesKey(): Promise<CryptoKey> {
  const secret = runtimeEnv().BOOKING_DATA_KEY;
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) throw new Error("BOOKING_CRYPTO_UNAVAILABLE");
  const material = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptPrivate(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey();
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return `v1.${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}

export async function decryptPrivate(value: string): Promise<string> {
  const [, ivText, dataText] = value.split(".");
  if (!ivText || !dataText) throw new Error("INVALID_ENCRYPTED_VALUE");
  const key = await deriveAesKey();
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64url(ivText) }, key, fromBase64url(dataText));
  return new TextDecoder().decode(decrypted);
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64url(new Uint8Array(digest));
}

export async function phoneHash(phone: string): Promise<string> {
  const pepper = runtimeEnv().BOOKING_LOOKUP_PEPPER;
  if (!pepper || new TextEncoder().encode(pepper).byteLength < 32) throw new Error("BOOKING_CRYPTO_UNAVAILABLE");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(phone));
  return base64url(new Uint8Array(digest));
}

export async function requestFingerprint(value: unknown): Promise<string> {
  const pepper = runtimeEnv().BOOKING_LOOKUP_PEPPER;
  if (!pepper || new TextEncoder().encode(pepper).byteLength < 32) throw new Error("BOOKING_CRYPTO_UNAVAILABLE");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(JSON.stringify(value)));
  return base64url(new Uint8Array(digest));
}

export async function enforceRateLimit(
  request: Request,
  scope: string,
  maximum: number,
  windowSeconds: number,
): Promise<boolean> {
  const db = getD1();
  const address = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const pepper = runtimeEnv().BOOKING_LOOKUP_PEPPER;
  if (!pepper) throw new Error("BOOKING_CRYPTO_UNAVAILABLE");
  const identity = await sha256(`${pepper}:${address.trim()}`);
  const key = `${scope}:${identity}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  await db.prepare(
    "INSERT INTO rate_limits (bucket_key, window_start, request_count) VALUES (?, ?, 1) ON CONFLICT(bucket_key) DO UPDATE SET window_start = CASE WHEN window_start < ? THEN excluded.window_start ELSE window_start END, request_count = CASE WHEN window_start < ? THEN 1 ELSE request_count + 1 END",
  ).bind(key, windowStart, windowStart, windowStart).run();
  const row = await db.prepare("SELECT request_count FROM rate_limits WHERE bucket_key = ?").bind(key).first<{ request_count: number }>();
  return Number(row?.request_count || 0) <= maximum;
}

export function parsePrices(value: string): Record<string, number> {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, price]) => Number.isInteger(price) && Number(price) >= 0).map(([people, price]) => [people, Number(price)]));
  } catch {
    return {};
  }
}

export function themeFromRow(row: Record<string, unknown>): ThemeRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    shortName: String(row.short_name),
    genre: String(row.genre),
    synopsis: String(row.synopsis),
    artKey: String(row.art_key),
    imageKey: row.image_key ? String(row.image_key) : null,
    difficulty: Number(row.difficulty),
    difficultyLabel: String(row.difficulty_label || ""),
    durationMin: Number(row.duration_min),
    turnoverMin: Number(row.turnover_min),
    minPeople: Number(row.min_people),
    maxPeople: Number(row.max_people),
    notice: String(row.notice || ""),
    prices: parsePrices(String(row.prices_json || "{}")),
    status: String(row.status) as ThemeRecord["status"],
    displayOrder: Number(row.display_order),
  };
}

export async function getSettings(db = getD1()): Promise<BookingSettingsRecord> {
  const row = await db.prepare("SELECT * FROM booking_settings WHERE id = 1").first<Record<string, unknown>>();
  if (!row) return DEFAULT_SETTINGS;
  return {
    timezone: String(row.timezone),
    horizonDays: Number(row.horizon_days),
    leadMinutes: Number(row.lead_minutes),
    cancelCutoffMinutes: Number(row.cancel_cutoff_minutes),
    consentVersion: String(row.consent_version),
    termsVersion: String(row.terms_version || "2026-08-15-npay"),
    refundPolicyVersion: String(row.refund_policy_version || "2026-08-15-npay"),
    bookingOpen: Number(row.booking_open) === 1,
    pausedMessage: String(row.paused_message),
    storePhone: String(row.store_phone),
    businessName: String(row.business_name || "카타르시스 이스케이프"),
    representativeName: String(row.representative_name || ""),
    businessRegistrationNumber: String(row.business_registration_number || ""),
    mailOrderRegistrationNumber: String(row.mail_order_registration_number || ""),
    mailOrderRegistrationAuthority: String(row.mail_order_registration_authority || ""),
    mailOrderRegistrationExempt: Number(row.mail_order_registration_exempt || 0) === 1,
    businessAddress: String(row.business_address || "부산 부산진구 중앙대로680번가길 29, 3층"),
    businessEmail: String(row.business_email || ""),
    privacyOfficerName: String(row.privacy_officer_name || ""),
    operationalPiiRetentionDays: Math.max(30, Number(row.operational_pii_retention_days || 90)),
    legalRecordRetentionMonths: Math.max(60, Number(row.legal_record_retention_months || 60)),
  };
}

export async function getThemes(status?: string, db = getD1()): Promise<ThemeRecord[]> {
  const statement = status
    ? db.prepare("SELECT * FROM themes WHERE status = ? ORDER BY display_order, created_at").bind(status)
    : db.prepare("SELECT * FROM themes ORDER BY display_order, created_at");
  const result = await statement.all<Record<string, unknown>>();
  return result.results.map(themeFromRow);
}

export function fallbackPublicData() {
  return { themes: DEFAULT_THEMES, settings: DEFAULT_SETTINGS };
}

export function isUniqueError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed|reservations_one_active_per_slot/i.test(message);
}

export function sameOrigin(request: Request): boolean {
  return isPublicWebOriginAllowed(request);
}
