import { audit, requireAdminApi } from "@/lib/admin-api";
import { getD1, json, kstDateKey, minuteToTime, timeToMinute, weekdayKst } from "@/lib/booking";
import { findDailyOverlap, findWeeklyOverlap, slotsOverlap, type DailyTimedSlot } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

type ThemeScheduleRow = { id: string; duration_min: number; turnover_min: number };
type OverrideRow = { service_date: string; start_minute: number; action: string; duration_min: number | null };
type ActiveBookingRow = { booking_code: string; service_date: string; start_minute: number; duration_min: number };
type EffectiveSlot = DailyTimedSlot & { source: "rule" | "override" };

const dayNames = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

function effectiveSlotsForDate(
  date: string,
  rules: Array<{ weekday: number; startMinute: number }>,
  overrides: OverrideRow[],
  defaultDurationMin: number,
): EffectiveSlot[] {
  const slots = new Map<number, EffectiveSlot>();
  for (const rule of rules) {
    if (rule.weekday === weekdayKst(date)) slots.set(rule.startMinute, { startMinute: rule.startMinute, durationMin: defaultDurationMin, source: "rule" });
  }
  for (const override of overrides) {
    if (override.service_date !== date) continue;
    if (override.action === "block") slots.delete(override.start_minute);
    else slots.set(override.start_minute, { startMinute: override.start_minute, durationMin: override.duration_min || defaultDurationMin, source: "override" });
  }
  return [...slots.values()];
}

export async function GET(request: Request) {
  const auth = await requireAdminApi(request);
  if (auth.response) return auth.response;
  const themeId = new URL(request.url).searchParams.get("themeId") || "";
  if (!/^[a-z0-9_-]{1,80}$/i.test(themeId)) return json({ ok: false, error: { message: "테마를 선택해 주세요." } }, 400);
  const rows = await getD1().prepare("SELECT weekday, start_minute FROM schedule_rules WHERE theme_id = ? ORDER BY weekday, start_minute").bind(themeId).all();
  return json({ ok: true, rules: rows.results });
}

export async function PUT(request: Request) {
  const auth = await requireAdminApi(request);
  if (auth.response || !auth.admin) return auth.response;
  try {
    const payload = (await request.json()) as { themeId?: unknown; week?: unknown };
    const themeId = typeof payload.themeId === "string" && /^[a-z0-9_-]{1,80}$/i.test(payload.themeId) ? payload.themeId : "";
    if (!themeId || !payload.week || typeof payload.week !== "object") return json({ ok: false, error: { message: "운영 시간을 확인해 주세요." } }, 400);
    const week = payload.week as Record<string, unknown>;
    const values: Array<{ weekday: number; startMinute: number }> = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const list = week[String(weekday)];
      if (!Array.isArray(list) || list.length > 30) return json({ ok: false, error: { message: "요일별 시간을 확인해 주세요." } }, 400);
      for (const time of list) {
        const startMinute = timeToMinute(time);
        if (startMinute === null) return json({ ok: false, error: { message: "시간 형식을 확인해 주세요." } }, 400);
        values.push({ weekday, startMinute });
      }
    }
    const db = getD1();
    const theme = await db.prepare("SELECT id, duration_min, turnover_min FROM themes WHERE id = ? AND status != 'archived'").bind(themeId).first<ThemeScheduleRow>();
    if (!theme) return json({ ok: false, error: { message: "테마를 찾을 수 없습니다." } }, 404);
    const uniqueValues = [...new Map(values.map((value) => [`${value.weekday}:${value.startMinute}`, value])).values()];
    const durationMin = Number(theme.duration_min);
    const turnoverMin = Number(theme.turnover_min);
    const weeklyOverlap = findWeeklyOverlap(uniqueValues.map((value) => ({ ...value, durationMin })), turnoverMin);
    if (weeklyOverlap) {
      return json({ ok: false, error: { code: "SCHEDULE_OVERLAP", message: `${dayNames[weeklyOverlap.first.weekday]} ${minuteToTime(weeklyOverlap.first.startMinute)}과 ${dayNames[weeklyOverlap.second.weekday]} ${minuteToTime(weeklyOverlap.second.startMinute)}은 진행·정리 시간이 겹칩니다. 최소 ${durationMin + turnoverMin}분 간격으로 조정해 주세요.` } }, 409);
    }

    const today = kstDateKey();
    const [before, overridesResult, bookingsResult] = await Promise.all([
      db.prepare("SELECT weekday, start_minute FROM schedule_rules WHERE theme_id = ? ORDER BY weekday, start_minute").bind(themeId).all(),
      db.prepare("SELECT service_date, start_minute, action, duration_min FROM slot_overrides WHERE theme_id = ? AND service_date >= ? ORDER BY service_date, start_minute").bind(themeId, today).all<OverrideRow>(),
      db.prepare("SELECT booking_code, service_date, start_minute, duration_min FROM reservations WHERE theme_id = ? AND service_date >= ? AND status IN ('confirmed','checked_in') ORDER BY service_date, start_minute").bind(themeId, today).all<ActiveBookingRow>(),
    ]);
    const affectedDates = new Set([
      ...overridesResult.results.map((row) => row.service_date),
      ...bookingsResult.results.map((row) => row.service_date),
    ]);
    for (const date of affectedDates) {
      const effective = effectiveSlotsForDate(date, uniqueValues, overridesResult.results, durationMin);
      const dateOverlap = findDailyOverlap(effective, turnoverMin);
      if (dateOverlap) {
        return json({ ok: false, error: { code: "SCHEDULE_OVERLAP", message: `${date}의 ${minuteToTime(dateOverlap.first.startMinute)}과 ${minuteToTime(dateOverlap.second.startMinute)} 운영 시간이 겹칩니다. 날짜별 추가 시간을 먼저 조정해 주세요.` } }, 409);
      }
      for (const booking of bookingsResult.results.filter((row) => row.service_date === date)) {
        const collision = effective.find((slot) => slot.startMinute !== booking.start_minute && slotsOverlap(slot, { startMinute: booking.start_minute, durationMin: booking.duration_min }, turnoverMin));
        if (collision) {
          return json({ ok: false, error: { code: "BOOKING_OVERLAP", message: `${date} ${minuteToTime(booking.start_minute)} 확정 예약과 ${minuteToTime(collision.startMinute)} 운영 시간이 겹칩니다. 예약 시간을 유지하도록 일정을 조정해 주세요.` } }, 409);
        }
      }
    }

    const statements = [db.prepare("DELETE FROM schedule_rules WHERE theme_id = ?").bind(themeId)];
    for (const value of uniqueValues) statements.push(db.prepare("INSERT INTO schedule_rules (theme_id, weekday, start_minute) VALUES (?, ?, ?)").bind(themeId, value.weekday, value.startMinute));
    await db.batch(statements);
    await audit(db, auth.admin.email, "replace", "schedule", themeId, before.results, uniqueValues);
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: { message: "운영 시간을 저장하지 못했습니다." } }, 500);
  }
}
