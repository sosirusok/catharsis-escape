import { encryptPrivate, getD1, isJsonRequest, json, readJsonBody, sha256 } from "@/lib/booking";
import { authorizeOwnerDevice } from "@/lib/owner-device";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  if (!isJsonRequest(request)) return json({ ok: false, error: { code: "INVALID_CONTENT_TYPE", message: "입력 내용을 확인해 주세요." } }, 415);
  try {
    const device = await authorizeOwnerDevice(request);
    if (!device) return json({ ok: false, error: { code: "DEVICE_ACCESS_REQUIRED", message: "앱을 다시 연결해 주세요." } }, 401);
    let body: { installationId?: unknown };
    try { body = await readJsonBody<typeof body>(request, 4096); }
    catch (error) {
      const tooLarge = error instanceof Error && error.message === "PAYLOAD_TOO_LARGE";
      return json({ ok: false, error: { code: tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON", message: "입력 내용을 확인해 주세요." } }, tooLarge ? 413 : 400);
    }
    const installationId = typeof body.installationId === "string" ? body.installationId.trim() : "";
    if (!/^[A-Za-z0-9_-]{10,256}$/.test(installationId)) {
      return json({ ok: false, error: { code: "INVALID_INSTALLATION_ID", message: "알림 기기 정보를 다시 등록해 주세요." } }, 400);
    }
    const digest = await sha256(installationId);
    const encrypted = await encryptPrivate(installationId);
    const db = getD1();
    await db.batch([
      db.prepare(
        `UPDATE owner_push_deliveries SET status = 'dead', lease_token = NULL, lease_until = NULL,
          last_error_code = 'DEVICE_REASSIGNED', updated_at = CURRENT_TIMESTAMP
         WHERE status IN ('pending','retry','sending')
           AND device_id IN (SELECT id FROM owner_devices WHERE fcm_fid_hash = ? AND id <> ?)`,
      ).bind(digest, device.id),
      db.prepare(
        `UPDATE owner_devices SET fcm_fid_enc = NULL, fcm_fid_hash = NULL, fcm_fid_updated_at = CURRENT_TIMESTAMP
         WHERE fcm_fid_hash = ? AND id <> ?`,
      ).bind(digest, device.id),
      db.prepare(
        `UPDATE owner_devices SET fcm_fid_enc = ?, fcm_fid_hash = ?, fcm_fid_updated_at = CURRENT_TIMESTAMP,
          active = 1, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).bind(encrypted, digest, device.id),
    ]);
    return json({ ok: true, pushEnabled: true });
  } catch {
    return json({ ok: false, error: { code: "SERVICE_ERROR", message: "푸시 알림 기기를 등록하지 못했습니다." } }, 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const device = await authorizeOwnerDevice(request);
    if (!device) return json({ ok: false, error: { code: "DEVICE_ACCESS_REQUIRED", message: "앱을 다시 연결해 주세요." } }, 401);
    const db = getD1();
    await db.batch([
      db.prepare(
        `UPDATE owner_push_deliveries SET status = 'dead', lease_token = NULL, lease_until = NULL,
          last_error_code = 'DEVICE_REVOKED', updated_at = CURRENT_TIMESTAMP
         WHERE device_id = ? AND status IN ('pending','retry','sending')`,
      ).bind(device.id),
      db.prepare(
        `UPDATE owner_devices SET active = 0, fcm_fid_enc = NULL, fcm_fid_hash = NULL,
          fcm_fid_updated_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP
         WHERE id = ? AND active = 1`,
      ).bind(device.id),
    ]);
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: { code: "SERVICE_ERROR", message: "기기 연결을 해제하지 못했습니다." } }, 500);
  }
}
