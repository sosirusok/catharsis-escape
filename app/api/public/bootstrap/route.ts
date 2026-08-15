import { fallbackPublicData, getSettings, getThemes, json } from "@/lib/booking";
import { paymentServiceStatus } from "@/lib/payment-flow";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [themes, settings] = await Promise.all([getThemes("active"), getSettings()]);
    return json({ ok: true, themes, settings, payments: paymentServiceStatus(settings) });
  } catch (error) {
    if (error instanceof Error && error.message === "BOOKING_DATABASE_UNAVAILABLE") {
      const fallback = fallbackPublicData();
      return json({ ok: true, ...fallback, payments: paymentServiceStatus(fallback.settings) });
    }
    return json({ ok: false, error: { code: "SERVICE_ERROR", message: "예약 정보를 불러오지 못했습니다." } }, 500);
  }
}
