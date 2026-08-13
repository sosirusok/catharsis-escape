import { audit, requireAdminApi } from "@/lib/admin-api";
import { getD1, json } from "@/lib/booking";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const auth = await requireAdminApi(request);
  if (auth.response || !auth.admin) return auth.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const horizonInput = Number(body.horizonDays);
    const leadInput = Number(body.leadMinutes);
    const cancelInput = Number(body.cancelCutoffMinutes);
    const horizonDays = Math.max(1, Math.min(31, Number.isFinite(horizonInput) ? horizonInput : 21));
    const leadMinutes = Math.max(0, Math.min(1440, Number.isFinite(leadInput) ? leadInput : 60));
    const cancelCutoffMinutes = Math.max(0, Math.min(10080, Number.isFinite(cancelInput) ? cancelInput : 1440));
    const bookingOpen = body.bookingOpen === true ? 1 : 0;
    const pausedMessage = typeof body.pausedMessage === "string" ? body.pausedMessage.trim().slice(0, 100) : "현재 예약 접수가 잠시 중단되었습니다.";
    const storePhone = typeof body.storePhone === "string" ? body.storePhone.trim().slice(0, 30) : "051-802-3341";
    const db = getD1();
    const before = await db.prepare("SELECT * FROM booking_settings WHERE id = 1").first();
    await db.prepare("UPDATE booking_settings SET horizon_days = ?, lead_minutes = ?, cancel_cutoff_minutes = ?, booking_open = ?, paused_message = ?, store_phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1")
      .bind(horizonDays, leadMinutes, cancelCutoffMinutes, bookingOpen, pausedMessage, storePhone).run();
    const after = { horizonDays, leadMinutes, cancelCutoffMinutes, bookingOpen, pausedMessage, storePhone };
    await audit(db, auth.admin.email, "update", "settings", "1", before, after);
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: { message: "예약 설정을 저장하지 못했습니다." } }, 500);
  }
}
