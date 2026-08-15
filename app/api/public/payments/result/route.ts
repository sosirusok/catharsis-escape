import { isJsonRequest, publicError, readJsonBody, sameOrigin } from "@/lib/booking";
import { getPaymentResult } from "@/lib/payment-flow";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return publicError("INVALID_ORIGIN", "요청을 확인할 수 없습니다.", 403);
  if (!isJsonRequest(request)) return publicError("INVALID_CONTENT_TYPE", "요청 형식을 확인해 주세요.", 415);
  let body: { state?: unknown; orderId?: unknown };
  try { body = await readJsonBody<typeof body>(request, 4000); }
  catch (error) {
    const tooLarge = error instanceof Error && error.message === "PAYLOAD_TOO_LARGE";
    return publicError(tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON", "결제 정보를 확인해 주세요.", tooLarge ? 413 : 400);
  }
  const state = typeof body.state === "string" && /^[a-f0-9]{64}$/.test(body.state) ? body.state : "";
  const orderId = typeof body.orderId === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(body.orderId) ? body.orderId : "";
  if (!state || !orderId) return publicError("INVALID_PAYMENT", "결제 정보를 확인할 수 없습니다.", 400);
  try {
    const reservation = await getPaymentResult(state, orderId);
    return Response.json({ ok: true, reservation }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "PAYMENT_RESULT_NOT_FOUND") return publicError("PAYMENT_RESULT_NOT_FOUND", "결제 결과를 확인할 수 없습니다.", 404);
    if (message === "PAYMENT_RESULT_NOT_READY" || message === "PAYMENT_PROCESSING") return publicError("PAYMENT_PROCESSING", "결제 승인을 확인하고 있습니다. 잠시 후 다시 확인해 주세요.", 409);
    if (message === "PAYMENT_NOT_COMPLETED") return publicError("PAYMENT_NOT_COMPLETED", "결제가 완료되지 않아 예약이 확정되지 않았습니다.", 410);
    if (message === "PAYMENT_RESULT_EXPIRED") return publicError("PAYMENT_RESULT_EXPIRED", "결제 완료 내역은 예약 조회에서 확인해 주세요.", 410);
    return publicError("SERVICE_ERROR", "결제 결과를 확인하지 못했습니다. 매장으로 문의해 주세요.", 500);
  }
}
