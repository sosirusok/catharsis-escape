import { audit, requireAdminApi } from "@/lib/admin-api";
import { getD1, json, readJsonBody } from "@/lib/booking";
import { reconcileReservationPayment, releaseReviewedUnpaidReservation } from "@/lib/payment-flow";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAdminApi(request);
  if (auth.response || !auth.admin) return auth.response;
  let body: { id?: unknown; action?: unknown };
  try { body = await readJsonBody<typeof body>(request, 4000); }
  catch { return json({ ok: false, error: { code: "INVALID_JSON", message: "예약 정보를 확인해 주세요." } }, 400); }
  const id = typeof body.id === "string" && /^[a-zA-Z0-9_-]{3,100}$/.test(body.id) ? body.id : "";
  const action = body.action === "release" ? "release" : "recheck";
  if (!id) return json({ ok: false, error: { code: "INVALID_RESERVATION", message: "예약 정보를 확인해 주세요." } }, 400);
  try {
    const db = getD1();
    const before = await db.prepare("SELECT * FROM reservations WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!before) return json({ ok: false, error: { code: "RESERVATION_NOT_FOUND", message: "예약을 찾을 수 없습니다." } }, 404);
    const reservation = action === "release"
      ? await releaseReviewedUnpaidReservation(id, auth.admin.email)
      : await reconcileReservationPayment(id);
    await audit(db, auth.admin.email, action === "release" && reservation.payment_status === "failed" ? "release_unpaid" : "reconcile", "reservation_payment", id, before, { paymentStatus: reservation.payment_status });
    return json({ ok: true, paymentStatus: reservation.payment_status });
  } catch (error) {
    const code = error instanceof Error ? error.message : "SERVICE_ERROR";
    if (code === "RESERVATION_NOT_FOUND") return json({ ok: false, error: { code, message: "예약을 찾을 수 없습니다." } }, 404);
    if (code === "PAYMENT_NOT_COMPLETED") return json({ ok: false, error: { code, message: "결제가 완료되지 않은 예약입니다." } }, 410);
    if (code === "PAYMENT_PROCESSING") return json({ ok: false, error: { code, message: "결제사 상태를 아직 확인할 수 없습니다. 잠시 후 다시 확인해 주세요." } }, 409);
    return json({ ok: false, error: { code: "PAYMENT_RECONCILE_FAILED", message: "결제사 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." } }, 409);
  }
}
