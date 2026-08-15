import { getD1 } from "@/lib/booking";
import { confirmReservationPayment, paymentRedirect } from "@/lib/payment-flow";
import { isTransientNaverPayError, NaverPayApiError } from "@/lib/naver-payments";

export const dynamic = "force-dynamic";

function clean(value: string | null, pattern: RegExp) {
  return value && pattern.test(value) ? value : "";
}

function failureMessage(code: string) {
  if (code === "UserCancel" || code === "userCancel") return "네이버페이 결제를 취소했습니다. 예약은 확정되지 않았습니다.";
  if (code === "TimeExpired") return "네이버페이 결제 시간이 만료되었습니다. 다시 예약해 주세요.";
  return "네이버페이 결제를 완료하지 못했습니다. 다시 시도해 주세요.";
}

async function pendingOrder(state: string) {
  return getD1().prepare("SELECT payment_order_id FROM reservations WHERE payment_state = ? AND payment_provider = 'naverpay' LIMIT 1")
    .bind(state).first<{ payment_order_id: string }>();
}

async function markFailed(state: string, code: string, message: string) {
  await getD1().prepare("UPDATE reservations SET status = 'cancelled', payment_status = 'failed', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = '네이버페이 결제 미완료', payment_failure_code = ?, payment_failure_message = ?, payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE payment_state = ? AND payment_provider = 'naverpay' AND payment_status = 'ready'")
    .bind(code.slice(0, 80), message.slice(0, 240), Date.now(), state).run();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = clean(url.searchParams.get("state"), /^[a-f0-9]{64}$/);
  const resultCode = clean(url.searchParams.get("resultCode"), /^[A-Za-z0-9_-]{1,80}$/);
  if (!state || !resultCode) {
    return paymentRedirect("fail", { code: "INVALID_PAYMENT", message: "네이버페이 결제 정보를 확인할 수 없습니다." });
  }

  const pending = await pendingOrder(state).catch(() => null);
  const orderId = pending?.payment_order_id || "";
  if (resultCode !== "Success") {
    const message = failureMessage(resultCode);
    await markFailed(state, resultCode, message).catch(() => undefined);
    return paymentRedirect("fail", { code: resultCode, message, state, ...(orderId ? { orderId } : {}) });
  }

  const paymentId = clean(url.searchParams.get("paymentId"), /^[A-Za-z0-9_-]{6,50}$/);
  if (!paymentId || !orderId) {
    return paymentRedirect("fail", { code: "INVALID_PAYMENT", message: "네이버페이 결제 정보를 확인할 수 없습니다.", state });
  }

  try {
    const reservation = await confirmReservationPayment({ state, paymentKey: paymentId });
    return paymentRedirect("success", { state, orderId: String(reservation.payment_order_id) });
  } catch (error) {
    if (error instanceof NaverPayApiError && !isTransientNaverPayError(error)) {
      await markFailed(state, error.code, error.message).catch(() => undefined);
      return paymentRedirect("fail", { code: error.code, message: error.message.slice(0, 120), state, orderId });
    }
    if (error instanceof Error && ["PAYMENT_EXPIRED", "PAYMENT_NOT_AVAILABLE", "PAYMENT_NOT_COMPLETED", "PAYMENT_INFORMATION_MISMATCH"].includes(error.message)) {
      return paymentRedirect("fail", { code: error.message, message: "결제가 완료되지 않아 예약이 확정되지 않았습니다.", state, orderId });
    }
    return paymentRedirect("processing", { state, orderId });
  }
}
