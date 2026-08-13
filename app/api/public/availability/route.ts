import { buildAvailability } from "@/lib/availability";
import { json, publicError } from "@/lib/booking";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const themeId = url.searchParams.get("themeId")?.trim() || "";
    const days = Number(url.searchParams.get("days") || "21");
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(themeId)) return publicError("INVALID_THEME", "테마를 다시 선택해 주세요.", 400);
    const availability = await buildAvailability(themeId, days);
    if (!availability) return publicError("THEME_NOT_FOUND", "예약 가능한 테마가 아닙니다.", 404);
    return json({ ok: true, ...availability });
  } catch {
    return publicError("SERVICE_ERROR", "예약 시간을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
