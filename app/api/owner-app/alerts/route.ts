import { decryptPrivate, getD1, json } from "@/lib/booking";
import { authorizeOwnerDevice } from "@/lib/owner-device";

export const dynamic = "force-dynamic";

type AlertRow = {
  alert_id: number;
  alert_type: string;
  alert_created_at: string;
  reservation_id: string;
  booking_code: string;
  theme_name: string;
  service_date: string;
  start_minute: number;
  party_size: number;
  amount: number;
  payment_status: string;
  status: string;
  customer_name_enc: string;
  phone_enc: string;
};

export async function GET(request: Request) {
  try {
    const device = await authorizeOwnerDevice(request);
    if (!device) return json({ ok: false, error: { code: "DEVICE_ACCESS_REQUIRED", message: "앱을 다시 연결해 주세요." } }, 401);
    const url = new URL(request.url);
    const after = Math.max(0, Math.floor(Number(url.searchParams.get("after") || "0")) || 0);
    const limit = Math.max(1, Math.min(100, Math.floor(Number(url.searchParams.get("limit") || "100")) || 100));
    const result = await getD1().prepare(
      "SELECT id alert_id, type alert_type, created_at alert_created_at, reservation_id, booking_code, theme_name, service_date, start_minute, party_size, amount, payment_status, status, customer_name_enc, phone_enc FROM owner_alerts WHERE id > ? ORDER BY id ASC LIMIT ?",
    ).bind(after, limit).all<AlertRow>();
    const alerts = await Promise.all(result.results.map(async (row) => {
      const phone = await decryptPrivate(row.phone_enc);
      return {
        id: row.alert_id,
        type: row.alert_type,
        createdAt: row.alert_created_at.includes("T") ? row.alert_created_at : `${row.alert_created_at.replace(" ", "T")}Z`,
        reservation: {
          id: row.reservation_id,
          bookingCode: row.booking_code,
          themeName: row.theme_name,
          serviceDate: row.service_date,
          startMinute: row.start_minute,
          time: `${String(Math.floor(row.start_minute / 60)).padStart(2, "0")}:${String(row.start_minute % 60).padStart(2, "0")}`,
          partySize: row.party_size,
          name: await decryptPrivate(row.customer_name_enc),
          phone,
          phoneLast4: phone.slice(-4),
          amount: row.amount,
          paymentStatus: row.payment_status,
          status: row.status,
        },
      };
    }));
    return json({ ok: true, alerts, latestId: alerts.reduce((max, alert) => Math.max(max, alert.id), after), hasMore: alerts.length === limit });
  } catch {
    return json({ ok: false, error: { code: "SERVICE_ERROR", message: "예약 알림을 불러오지 못했습니다." } }, 500);
  }
}
