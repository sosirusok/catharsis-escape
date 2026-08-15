import { adminAccessKeyMatches } from "@/lib/admin";
import { createId, enforceRateLimit, getD1, isJsonRequest, json, readJsonBody, sha256 } from "@/lib/booking";

export const dynamic = "force-dynamic";

function deviceToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function POST(request: Request) {
  if (!isJsonRequest(request)) return json({ ok: false, error: { code: "INVALID_CONTENT_TYPE", message: "입력 내용을 확인해 주세요." } }, 415);
  try {
    if (!(await enforceRateLimit(request, "owner-pair", 8, 900))) return json({ ok: false, error: { code: "RATE_LIMITED", message: "잠시 후 다시 시도해 주세요." } }, 429);
    let body: { accessKey?: unknown; deviceName?: unknown };
    try { body = await readJsonBody<typeof body>(request, 4000); }
    catch (error) {
      const tooLarge = error instanceof Error && error.message === "PAYLOAD_TOO_LARGE";
      return json({ ok: false, error: { code: tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON", message: "입력 내용을 확인해 주세요." } }, tooLarge ? 413 : 400);
    }
    const accessKey = typeof body.accessKey === "string" ? body.accessKey : "";
    const deviceName = typeof body.deviceName === "string" ? body.deviceName.trim().replace(/\s+/g, " ").slice(0, 60) : "";
    if (!accessKey || !deviceName) return json({ ok: false, error: { code: "INVALID_INPUT", message: "관리자 키와 기기 이름을 입력해 주세요." } }, 400);
    if (!(await adminAccessKeyMatches(accessKey))) return json({ ok: false, error: { code: "INVALID_ACCESS_KEY", message: "관리자 키가 올바르지 않습니다." } }, 401);
    const token = deviceToken();
    const digest = await sha256(token);
    const id = createId("device");
    const db = getD1();
    await db.batch([
      db.prepare(
        `UPDATE owner_push_deliveries SET status = 'dead', lease_token = NULL, lease_until = NULL,
          last_error_code = 'DEVICE_REPLACED', updated_at = CURRENT_TIMESTAMP
         WHERE status IN ('pending','retry','sending')
           AND device_id IN (SELECT id FROM owner_devices WHERE active = 1)`,
      ),
      db.prepare(
        `UPDATE owner_devices SET active = 0, fcm_fid_enc = NULL, fcm_fid_hash = NULL,
          fcm_fid_updated_at = CURRENT_TIMESTAMP WHERE active = 1`,
      ),
      db.prepare("INSERT INTO owner_devices (id, device_name, token_hash, token_last8) VALUES (?, ?, ?, ?)").bind(id, deviceName, digest, token.slice(-8)),
    ]);
    return json({ ok: true, token, device: { id, name: deviceName } }, 201);
  } catch {
    return json({ ok: false, error: { code: "SERVICE_ERROR", message: "기기를 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." } }, 500);
  }
}
