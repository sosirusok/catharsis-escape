import { confirmReservationPayment, paymentRedirect } from "@/lib/payment-flow";
import { TossApiError } from "@/lib/toss-payments";

export const dynamic = "force-dynamic";

function clean(value: string | null, pattern: RegExp) {
  return value && pattern.test(value) ? value : "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = clean(url.searchParams.get("state"), /^[a-f0-9]{64}$/);
  const orderId = clean(url.searchParams.get("orderId"), /^[A-Za-z0-9_-]{6,64}$/);
  const paymentKey = clean(url.searchParams.get("paymentKey"), /^[A-Za-z0-9_-]{10,200}$/);
  const amount = Number(url.searchParams.get("amount"));
  if (!state || !orderId || !paymentKey || !Number.isSafeInteger(amount) || amount < 100) {
    return paymentRedirect("fail", { code: "INVALID_PAYMENT", message: "결제 정보를 확인할 수 없습니다." });
  }
  try {
    await confirmReservationPayment({ state, orderId, paymentKey, amount });
    return paymentRedirect("success", { state, orderId });
  } catch (error) {
    if (error instanceof TossApiError && error.status < 500) {
      return paymentRedirect("fail", { code: error.code, message: error.message.slice(0, 120) });
    }
    if (error instanceof Error && ["PAYMENT_EXPIRED", "PAYMENT_NOT_AVAILABLE", "PAYMENT_NOT_COMPLETED", "PAYMENT_INFORMATION_MISMATCH"].includes(error.message)) {
      return paymentRedirect("fail", { code: error.message, message: "결제가 완료되지 않아 예약이 확정되지 않았습니다." });
    }
    return paymentRedirect("processing", { state, orderId });
  }
}
