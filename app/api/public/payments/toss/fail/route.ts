import { getD1 } from "@/lib/booking";
import { paymentRedirect } from "@/lib/payment-flow";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const code = (url.searchParams.get("code") || "PAYMENT_CANCELED").slice(0, 80);
  const orderId = url.searchParams.get("orderId") || "";
  const message = code === "PAY_PROCESS_CANCELED" ? "결제를 취소했습니다. 예약은 확정되지 않았습니다." : "결제를 완료하지 못했습니다. 다시 시도해 주세요.";
  if (/^[a-f0-9]{64}$/.test(state)) {
    try {
      await getD1().prepare("UPDATE reservations SET status = 'cancelled', payment_status = 'failed', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = '결제 취소', payment_failure_code = ?, payment_failure_message = ?, updated_at = CURRENT_TIMESTAMP WHERE payment_state = ? AND payment_status = 'ready'")
        .bind(code, message, state).run();
    } catch {}
  }
  return paymentRedirect("fail", {
    code,
    message,
    ...(state && /^[a-f0-9]{64}$/.test(state) ? { state } : {}),
    ...(orderId && /^[A-Za-z0-9_-]{6,64}$/.test(orderId) ? { orderId } : {}),
  });
}
