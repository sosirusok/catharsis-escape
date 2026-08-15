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
import { safePaymentReceiptUrl } from "@/lib/store-policy";

export const dynamic = "force-dynamic";

type LookupRow = {
  booking_code: string;
  status: string;
  theme_name_snapshot: string;
  service_date: string;
  start_minute: number;
  duration_min: number;
  party_size: number;
  price_total: number;
  payment_status: string;
  receipt_url: string;
  created_at: string;
};

export async function POST(request: Request) {
  if (!sameOrigin(request)) return publicError("INVALID_ORIGIN", "요청을 확인할 수 없습니다.", 403);
  if (!isJsonRequest(request)) return publicError("INVALID_CONTENT_TYPE", "요청 형식을 확인해 주세요.", 415);
  try {
    if (!(await enforceRateLimit(request, "lookup", 10, 600))) return publicError("RATE_LIMITED", "잠시 후 다시 시도해 주세요.", 429);
    let payload: { bookingCode?: unknown; phone?: unknown };
    try { payload = await readJsonBody<typeof payload>(request, 4000); }
    catch (error) {
      const tooLarge = error instanceof Error && error.message === "PAYLOAD_TOO_LARGE";
      return publicError(tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON", "입력 내용을 확인해 주세요.", tooLarge ? 413 : 400);
    }
    const bookingCode = typeof payload.bookingCode === "string" ? payload.bookingCode.trim().toUpperCase() : "";
    const phone = normalizePhone(payload.phone);
    if (!/^CT-[2-9A-HJ-NP-Z]{6}$/.test(bookingCode) || !phone) return publicError("NOT_FOUND", "예약번호와 전화번호를 확인해 주세요.", 404);
    const digest = await phoneHash(phone);
    const row = await getD1().prepare("SELECT booking_code, status, theme_name_snapshot, service_date, start_minute, duration_min, party_size, price_total, payment_status, receipt_url, created_at FROM reservations WHERE booking_code = ? AND phone_hash = ? AND payment_status IN ('paid','manual','refund_processing','refunded') LIMIT 1").bind(bookingCode, digest).first<LookupRow>();
    if (!row) return publicError("NOT_FOUND", "예약번호와 전화번호를 확인해 주세요.", 404);
    return json({ ok: true, reservation: {
      bookingCode: row.booking_code,
      status: row.status,
      themeName: row.theme_name_snapshot,
      date: row.service_date,
      startMinute: row.start_minute,
      durationMin: row.duration_min,
      partySize: row.party_size,
      priceTotal: row.price_total,
      paymentStatus: row.payment_status,
      receiptUrl: safePaymentReceiptUrl(row.receipt_url),
      createdAt: row.created_at,
    } });
  } catch {
    return publicError("SERVICE_ERROR", "예약을 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
