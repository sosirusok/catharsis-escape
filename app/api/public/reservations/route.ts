import { isJsonRequest, publicError, sameOrigin } from "@/lib/booking";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return publicError("INVALID_ORIGIN", "요청을 확인할 수 없습니다.", 403);
  if (!isJsonRequest(request)) return publicError("INVALID_CONTENT_TYPE", "요청 형식을 확인해 주세요.", 415);
  return publicError("PAYMENT_REQUIRED", "카드결제를 완료해야 예약이 확정됩니다.", 402);
}
