import { fallbackPublicData, getSettings, getThemes, json } from "@/lib/booking";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [themes, settings] = await Promise.all([getThemes("active"), getSettings()]);
    return json({ ok: true, themes, settings });
  } catch (error) {
    if (error instanceof Error && error.message === "BOOKING_DATABASE_UNAVAILABLE") {
      return json({ ok: true, ...fallbackPublicData() });
    }
    return json({ ok: false, error: { code: "SERVICE_ERROR", message: "예약 정보를 불러오지 못했습니다." } }, 500);
  }
}
