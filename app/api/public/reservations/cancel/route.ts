import {
  enforceRateLimit,
  getD1,
  json,
  isJsonRequest,
  normalizePhone,
  phoneHash,
  publicError,
  readJsonBody,
  sameOrigin,
} from "@/lib/booking";
import { refundReservationPayment } from "@/lib/payment-flow";

export const dynamic = "force-dynamic";

type CancelRow = {
  id: string;
  booking_code: string;
  status: string;
  phone_hash: string;
  start_at_utc: number;
  payment_status: string;
  cancel_cutoff_minutes_snapshot: number;
};

export async function POST(request: Request) {
  if (!sameOrigin(request)) return publicError("INVALID_ORIGIN", "요청을 확인할 수 없습니다.", 403);
  if (!isJsonRequest(request)) return publicError("INVALID_CONTENT_TYPE", "요청 형식을 확인해 주세요.", 415);
  try {
    if (!(await enforceRateLimit(request, "cancel", 6, 600))) return publicError("RATE_LIMITED", "잠시 후 다시 시도해 주세요.", 429);
    let payload: { bookingCode?: unknown; phone?: unknown };
    try { payload = await readJsonBody<typeof payload>(request, 4000); }
    catch (error) {
      const tooLarge = error instanceof Error && error.message === "PAYLOAD_TOO_LARGE";
      return publicError(tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON", "입력 내용을 확인해 주세요.", tooLarge ? 413 : 400);
    }
    const bookingCode = typeof payload.bookingCode === "string" ? payload.bookingCode.trim().toUpperCase() : "";
    const phone = normalizePhone(payload.phone);
    if (!/^CT-[2-9A-HJ-NP-Z]{6}$/.test(bookingCode) || !phone) return publicError("NOT_FOUND", "예약번호와 전화번호를 확인해 주세요.", 404);
    const db = getD1();
    const digest = await phoneHash(phone);
    const row = await db.prepare("SELECT r.id, r.booking_code, r.status, r.phone_hash, r.payment_status, r.cancel_cutoff_minutes_snapshot, s.start_at_utc FROM reservations r JOIN booking_slots s ON s.id = r.slot_id WHERE r.booking_code = ? AND r.phone_hash = ? AND r.payment_status IN ('paid','manual','refunded','refund_processing') LIMIT 1").bind(bookingCode, digest).first<CancelRow>();
    if (!row) return publicError("NOT_FOUND", "예약번호와 전화번호를 확인해 주세요.", 404);
    if (row.status === "cancelled") return json({ ok: true, status: "cancelled" });
    if (row.status !== "confirmed") return publicError("NOT_CANCELLABLE", "온라인에서 취소할 수 없는 예약입니다. 매장으로 문의해 주세요.", 409);
    const cutoffMinutes = Math.max(0, Number(row.cancel_cutoff_minutes_snapshot ?? 1440));
    if (row.start_at_utc <= Date.now() + cutoffMinutes * 60_000) {
      return publicError("CUTOFF_PASSED", "취소 가능 시간이 지났습니다. 매장으로 문의해 주세요.", 409);
    }
    if (["paid", "refund_processing"].includes(row.payment_status)) {
      try {
        await refundReservationPayment(row.id, "고객 온라인 취소", "1");
        return json({ ok: true, status: "cancelled", refunded: true });
      } catch {
        return publicError("REFUND_PENDING", "환불 처리를 확인하고 있습니다. 잠시 후 다시 조회해 주세요.", 409);
      }
    }
    const result = await db.prepare("UPDATE reservations SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = '고객 온라인 취소', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'confirmed'").bind(row.id).run();
    if (!result.meta.changes) return publicError("NOT_CANCELLABLE", "예약 상태가 변경되었습니다. 다시 조회해 주세요.", 409);
    await db.prepare("INSERT INTO reservation_events (reservation_id, event_type, actor_type, actor_id, payload_json) VALUES (?, 'cancelled', 'customer', ?, ?)").bind(row.id, digest, JSON.stringify({ reason: "고객 온라인 취소" })).run();
    await db.prepare("INSERT OR IGNORE INTO owner_alerts (reservation_id, type, booking_code, theme_name, service_date, start_minute, party_size, amount, status, payment_status, customer_name_enc, phone_enc) SELECT id, 'reservation.cancelled', booking_code, theme_name_snapshot, service_date, start_minute, party_size, price_total, 'cancelled', payment_status, customer_name_enc, phone_enc FROM reservations WHERE id = ?").bind(row.id).run();
    return json({ ok: true, status: "cancelled" });
  } catch {
    return publicError("SERVICE_ERROR", "예약을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
