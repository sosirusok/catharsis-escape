import {
  enforceRateLimit,
  getD1,
  getSettings,
  json,
  normalizePhone,
  phoneHash,
  publicError,
  sameOrigin,
} from "@/lib/booking";

export const dynamic = "force-dynamic";

type CancelRow = {
  id: string;
  booking_code: string;
  status: string;
  phone_hash: string;
  start_at_utc: number;
};

export async function POST(request: Request) {
  if (!sameOrigin(request)) return publicError("INVALID_ORIGIN", "요청을 확인할 수 없습니다.", 403);
  try {
    if (Number(request.headers.get("content-length") || "0") > 4000) return publicError("PAYLOAD_TOO_LARGE", "입력 내용을 확인해 주세요.", 413);
    if (!(await enforceRateLimit(request, "cancel", 6, 600))) return publicError("RATE_LIMITED", "잠시 후 다시 시도해 주세요.", 429);
    let payload: { bookingCode?: unknown; phone?: unknown };
    try { payload = (await request.json()) as typeof payload; } catch { return publicError("INVALID_JSON", "입력 내용을 확인해 주세요.", 400); }
    const bookingCode = typeof payload.bookingCode === "string" ? payload.bookingCode.trim().toUpperCase() : "";
    const phone = normalizePhone(payload.phone);
    if (!/^CT-[2-9A-HJ-NP-Z]{6}$/.test(bookingCode) || !phone) return publicError("NOT_FOUND", "예약번호와 전화번호를 확인해 주세요.", 404);
    const db = getD1();
    const digest = await phoneHash(phone);
    const row = await db.prepare("SELECT r.id, r.booking_code, r.status, r.phone_hash, s.start_at_utc FROM reservations r JOIN booking_slots s ON s.id = r.slot_id WHERE r.booking_code = ? AND r.phone_hash = ? LIMIT 1").bind(bookingCode, digest).first<CancelRow>();
    if (!row) return publicError("NOT_FOUND", "예약번호와 전화번호를 확인해 주세요.", 404);
    if (row.status === "cancelled") return json({ ok: true, status: "cancelled" });
    if (row.status !== "confirmed") return publicError("NOT_CANCELLABLE", "온라인에서 취소할 수 없는 예약입니다. 매장으로 문의해 주세요.", 409);
    const settings = await getSettings(db);
    if (row.start_at_utc <= Date.now() + settings.cancelCutoffMinutes * 60_000) {
      return publicError("CUTOFF_PASSED", "취소 가능 시간이 지났습니다. 매장으로 문의해 주세요.", 409);
    }
    const result = await db.prepare("UPDATE reservations SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = '고객 온라인 취소', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'confirmed'").bind(row.id).run();
    if (!result.meta.changes) return publicError("NOT_CANCELLABLE", "예약 상태가 변경되었습니다. 다시 조회해 주세요.", 409);
    await db.prepare("INSERT INTO reservation_events (reservation_id, event_type, actor_type, actor_id, payload_json) VALUES (?, 'cancelled', 'customer', ?, ?)").bind(row.id, digest, JSON.stringify({ reason: "고객 온라인 취소" })).run();
    return json({ ok: true, status: "cancelled" });
  } catch {
    return publicError("SERVICE_ERROR", "예약을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
