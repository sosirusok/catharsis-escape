import { getD1, json } from "@/lib/booking";
import { authorizeOwnerDevice } from "@/lib/owner-device";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  try {
    const device = await authorizeOwnerDevice(request);
    if (!device) return json({ ok: false, error: { code: "DEVICE_ACCESS_REQUIRED", message: "앱을 다시 연결해 주세요." } }, 401);
    await getD1().prepare("UPDATE owner_devices SET active = 0, last_seen_at = CURRENT_TIMESTAMP WHERE id = ? AND active = 1").bind(device.id).run();
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: { code: "SERVICE_ERROR", message: "기기 연결을 해제하지 못했습니다." } }, 500);
  }
}
