import { requireAdminApi } from "@/lib/admin-api";
import { decryptPrivate, getD1, json } from "@/lib/booking";
import { expirePaymentHolds, reconcileStalePayments } from "@/lib/payment-flow";

export const dynamic = "force-dynamic";

type ReservationRow = Record<string, unknown> & { customer_name_enc: string; phone_enc: string };

export async function GET(request: Request) {
  const auth = await requireAdminApi(request);
  if (auth.response) return auth.response;
  try {
    const db = getD1();
    await expirePaymentHolds();
    await reconcileStalePayments();
    const url = new URL(request.url);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
    const from = url.searchParams.get("from") || today;
    const to = url.searchParams.get("to") || from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from || new Date(to).getTime() - new Date(from).getTime() > 62 * 86_400_000) {
      return json({ ok: false, error: { code: "INVALID_RANGE", message: "조회 기간을 확인해 주세요." } }, 400);
    }
    const [reservationResult, themesResult, closuresResult, overridesResult, settingsResult] = await Promise.all([
      db.prepare("SELECT * FROM reservations WHERE service_date BETWEEN ? AND ? ORDER BY service_date, start_minute, created_at").bind(from, to).all<ReservationRow>(),
      db.prepare("SELECT * FROM themes ORDER BY display_order, created_at").all<Record<string, unknown>>(),
      db.prepare("SELECT * FROM closures WHERE end_date >= ? AND start_date <= ? ORDER BY start_date").bind(from, to).all<Record<string, unknown>>(),
      db.prepare("SELECT * FROM slot_overrides WHERE service_date BETWEEN ? AND ? ORDER BY service_date, start_minute").bind(from, to).all<Record<string, unknown>>(),
      db.prepare("SELECT * FROM booking_settings WHERE id = 1").first<Record<string, unknown>>(),
    ]);
    const reservations = await Promise.all(reservationResult.results.map(async (row) => ({
      id: String(row.id),
      booking_code: String(row.booking_code),
      status: String(row.status),
      theme_id: String(row.theme_id),
      theme_name_snapshot: String(row.theme_name_snapshot),
      service_date: String(row.service_date),
      start_minute: Number(row.start_minute),
      duration_min: Number(row.duration_min),
      party_size: Number(row.party_size),
      price_total: Number(row.price_total),
      source: String(row.source),
      admin_memo: String(row.admin_memo || ""),
      created_at: String(row.created_at),
      payment_status: String(row.payment_status || "manual"),
      payment_method: String(row.payment_method || ""),
      paid_amount: Number(row.paid_amount || 0),
      paid_at: row.paid_at ? String(row.paid_at) : "",
      refunded_at: row.refunded_at ? String(row.refunded_at) : "",
      customer_name: await decryptPrivate(row.customer_name_enc),
      phone: await decryptPrivate(row.phone_enc),
    })));
    return json({ ok: true, reservations, themes: themesResult.results, closures: closuresResult.results, overrides: overridesResult.results, settings: settingsResult });
  } catch {
    return json({ ok: false, error: { code: "SERVICE_ERROR", message: "관리 정보를 불러오지 못했습니다." } }, 500);
  }
}
