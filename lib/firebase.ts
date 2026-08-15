import { runtimeEnv } from "@/lib/booking";

const FIREBASE_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OWNER_PACKAGE = "kr.co.catharsis.owner";

type AccessTokenCache = {
  value: string;
  expiresAt: number;
};

type GoogleErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{ "@type"?: string; errorCode?: string }>;
  };
};

let accessTokenCache: AccessTokenCache | null = null;
let accessTokenRequest: Promise<AccessTokenCache> | null = null;

export class FirebaseDeliveryError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly invalidInstallation: boolean,
    readonly retryAfterMs = 0,
  ) {
    super(message);
    this.name = "FirebaseDeliveryError";
  }
}

export function firebaseIsConfigured(): boolean {
  const env = runtimeEnv();
  return Boolean(
    env.FIREBASE_PROJECT_ID?.trim() &&
    env.FIREBASE_CLIENT_EMAIL?.trim() &&
    env.FIREBASE_PRIVATE_KEY?.trim(),
  );
}

function firebaseConfig() {
  const env = runtimeEnv();
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = env.FIREBASE_PRIVATE_KEY?.replaceAll("\\n", "\n").trim();
  const privateKeyId = env.FIREBASE_PRIVATE_KEY_ID?.trim();
  if (!projectId || !clientEmail || !privateKey) throw new Error("FIREBASE_UNAVAILABLE");
  return { projectId, clientEmail, privateKey, privateKeyId };
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function textToBase64url(value: string): string {
  return bytesToBase64url(new TextEncoder().encode(value));
}

function pemToBytes(value: string): Uint8Array {
  const base64 = value
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  if (!base64) throw new Error("FIREBASE_PRIVATE_KEY_INVALID");
  try {
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error("FIREBASE_PRIVATE_KEY_INVALID");
  }
}

async function serviceAccountAssertion(): Promise<string> {
  const { clientEmail, privateKey, privateKeyId } = firebaseConfig();
  const now = Math.floor(Date.now() / 1000);
  const header = textToBase64url(JSON.stringify({ alg: "RS256", typ: "JWT", ...(privateKeyId ? { kid: privateKeyId } : {}) }));
  const payload = textToBase64url(JSON.stringify({
    iss: clientEmail,
    scope: FIREBASE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${bytesToBase64url(new Uint8Array(signature))}`;
}

async function requestAccessToken(): Promise<AccessTokenCache> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: await serviceAccountAssertion(),
      }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({})) as { access_token?: unknown; expires_in?: unknown };
    if (!response.ok || typeof body.access_token !== "string") {
      throw new FirebaseDeliveryError("Firebase 인증에 실패했습니다.", "OAUTH_ERROR", response.status, response.status >= 500, false);
    }
    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : Number(body.expires_in || 3600);
    return {
      value: body.access_token,
      expiresAt: Date.now() + Math.max(300, expiresIn - 300) * 1000,
    };
  } catch (error) {
    if (error instanceof FirebaseDeliveryError) throw error;
    throw new FirebaseDeliveryError("Firebase 인증 서버에 연결하지 못했습니다.", "OAUTH_NETWORK", 0, true, false);
  } finally {
    clearTimeout(timeout);
  }
}

async function accessToken(): Promise<string> {
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now()) return accessTokenCache.value;
  if (!accessTokenRequest) {
    accessTokenRequest = requestAccessToken().finally(() => { accessTokenRequest = null; });
  }
  accessTokenCache = await accessTokenRequest;
  return accessTokenCache.value;
}

export function clearFirebaseAccessToken(): void {
  accessTokenCache = null;
}

function retryAfterMs(response: Response): number {
  const value = response.headers.get("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function fcmErrorCode(body: GoogleErrorBody): string {
  const detail = body.error?.details?.find((item) => item["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError");
  return detail?.errorCode || body.error?.status || "FCM_ERROR";
}

export async function sendFirebaseAlert(
  installationId: string,
  alertId: number,
  kind: string,
  retryAuthentication = true,
): Promise<string> {
  const { projectId } = firebaseConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let response: Response;
  try {
    response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          fid: installationId,
          data: {
            schema: "1",
            alertId: String(alertId),
            kind,
          },
          android: {
            priority: "HIGH",
            ttl: "86400s",
            restricted_package_name: OWNER_PACKAGE,
            notification: {
              channel_id: "confirmed_bookings",
              icon: "ic_notification",
              visibility: "PRIVATE",
            },
          },
        },
      }),
      signal: controller.signal,
    });
  } catch {
    throw new FirebaseDeliveryError("Firebase 발송 서버에 연결하지 못했습니다.", "FCM_NETWORK", 0, true, false);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 && retryAuthentication) {
    clearFirebaseAccessToken();
    return sendFirebaseAlert(installationId, alertId, kind, false);
  }

  const body = await response.json().catch(() => ({})) as GoogleErrorBody & { name?: unknown };
  if (response.ok && typeof body.name === "string") return body.name;

  const code = fcmErrorCode(body);
  const invalidInstallation = code === "UNREGISTERED" || code === "INVALID_ARGUMENT";
  const retryable = response.status === 429 || response.status >= 500 || code === "UNAVAILABLE" || code === "INTERNAL";
  throw new FirebaseDeliveryError(
    body.error?.message || "Firebase 알림 발송에 실패했습니다.",
    code,
    response.status,
    retryable,
    invalidInstallation,
    retryAfterMs(response),
  );
}
