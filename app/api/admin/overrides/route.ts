import { audit, requireAdminApi } from "@/lib/admin-api";
import { createId, getD1, isDateKey, json, timeToMinute } from "@/lib/booking";
import { slotsOverlap, type DailyTimedSlot } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

type ThemeRow = { id: string; duration_min: number; turnover_min: number };
type RuleRow = { start_minute: number };
type OverrideRow = { id: string; theme_id: string; service_date: string; start_minute: number; action: string; duration_min: number | null; note: string };
type BookingRow = { booking_code: string; start_minute: number; duration_min: number };

function effectiveSlots(rules: RuleRow[], overrides: OverrideRow[], defaultDurationMin: number): Map<number, DailyTimedSlot> {
  const slots = new Map(rules.map((rule) => [rule.start_minute, { startMinute: rule.start_minute, durationMin: defaultDurationMin }]));
  for (const override of overrides) {
    if (override.action === "block") slots.delete(override.start_minute);
    else slots.set(override.start_minute, { startMinute: override.start_minute, durationMin: override.duration_min || defaultDurationMin });
  }
  return slots;
}

async function restoreOverride(db: D1Database, before: OverrideRow | null, themeId: string, date: string, startMinute: number) {
  if (before) {
    await db.prepare("UPDATE slot_overrides SET action = ?, duration_min = ?, note = ? WHERE id = ?")
      .bind(before.action, before.duration_min, before.note, before.id).run();
  } else {
    await db.prepare("DELETE FROM slot_overrides WHERE theme_id = ? AND service_date = ? AND start_minute = ?")
      .bind(themeId, date, startMinute).run();
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminApi(request);
  if (auth.response || !auth.admin) return auth.response;
  try {
    const body = (await request.json()) as { themeId?: unknown; date?: unknown; time?: unknown; action?: unknown; note?: unknown; durationMin?: unknown };
    const themeId = typeof body.themeId === "string" && /^[a-z0-9_-]{1,80}$/i.test(body.themeId) ? body.themeId : "";
    const date = isDateKey(body.date) ? body.date : "";
    const startMinute = timeToMinute(body.time);
    const action = body.action === "add" || body.action === "block" ? body.action : "";
    if (!themeId || !date || startMinute === null || !action) return json({ ok: false, error: { message: "날짜와 시간을 확인해 주세요." } }, 400);
    const db = getD1();
    const theme = await db.prepare("SELECT id, duration_min, turnover_min FROM themes WHERE id = ? AND status != 'archived'").bind(themeId).first<ThemeRow>();
    if (!theme) return json({ ok: false, error: { message: "테마를 찾을 수 없습니다." } }, 404);
    let durationMin: number | null = null;
    if (action === "add" && body.durationMin !== undefined && body.durationMin !== null && body.durationMin !== "") {
      const parsedDuration = Number(body.durationMin);
      if (!Number.isInteger(parsedDuration) || parsedDuration < 30 || parsedDuration > 180) {
        return json({ ok: false, error: { message: "진행 시간은 30분부터 180분 사이로 입력해 주세요." } }, 400);
      }
      durationMin = parsedDuration;
    }
    const weekday = new Date(`${date}T12:00:00+09:00`).getUTCDay();
    const [rulesResult, overridesResult, bookingsResult] = await Promise.all([
      db.prepare("SELECT start_minute FROM schedule_rules WHERE theme_id = ? AND weekday = ? ORDER BY start_minute").bind(themeId, weekday).all<RuleRow>(),
      db.prepare("SELECT id, theme_id, service_date, start_minute, action, duration_min, note FROM slot_overrides WHERE theme_id = ? AND service_date = ? ORDER BY start_minute").bind(themeId, date).all<OverrideRow>(),
      db.prepare("SELECT booking_code, start_minute, duration_min FROM reservations WHERE theme_id = ? AND service_date = ? AND status IN ('confirmed','checked_in') ORDER BY start_minute").bind(themeId, date).all<BookingRow>(),
    ]);
    const before = overridesResult.results.find((row) => row.start_minute === startMinute) || null;
    if (action === "block") {
      const booked = bookingsResult.results.find((row) => row.start_minute === startMinute);
      if (booked) return json({ ok: false, error: { code: "HAS_BOOKING", message: "확정된 예약이 있어 이 시간을 마감할 수 없습니다." } }, 409);
    } else {
      const effective = effectiveSlots(rulesResult.results, overridesResult.results.filter((row) => row.start_minute !== startMinute), Number(theme.duration_min));
      effective.delete(startMinute);
      const candidate = { startMinute, durationMin: durationMin || Number(theme.duration_min) };
      const scheduleCollision = [...effective.values()].find((slot) => slotsOverlap(candidate, slot, Number(theme.turnover_min)));
      if (scheduleCollision) {
        return json({ ok: false, error: { code: "SLOT_OVERLAP", message: "추가하려는 시간이 기존 운영 시간의 진행·정리 시간과 겹칩니다. 시간 간격을 조정해 주세요." } }, 409);
      }
      const bookingCollision = bookingsResult.results.find((booking) => booking.start_minute !== startMinute && slotsOverlap(candidate, { startMinute: booking.start_minute, durationMin: booking.duration_min }, Number(theme.turnover_min)));
      if (bookingCollision) {
        return json({ ok: false, error: { code: "BOOKING_OVERLAP", message: "추가하려는 시간이 확정 예약의 진행·정리 시간과 겹칩니다. 예약 현황을 확인해 주세요." } }, 409);
      }
    }
    const id = createId("override");
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 120) : "";
    await db.prepare("INSERT INTO slot_overrides (id, theme_id, service_date, start_minute, action, duration_min, note) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(theme_id, service_date, start_minute) DO UPDATE SET action = excluded.action, duration_min = excluded.duration_min, note = excluded.note")
      .bind(id, themeId, date, startMinute, action, durationMin, note).run();
    if (action === "block") {
      const collision = await db.prepare("SELECT booking_code FROM reservations WHERE theme_id = ? AND service_date = ? AND start_minute = ? AND status IN ('confirmed','checked_in') LIMIT 1").bind(themeId, date, startMinute).first();
      if (collision) {
        await restoreOverride(db, before, themeId, date, startMinute);
        return json({ ok: false, error: { code: "HAS_BOOKING", message: "동시에 새 예약이 접수되어 이 시간을 마감하지 않았습니다. 예약 현황을 확인해 주세요." } }, 409);
      }
    }
    await audit(db, auth.admin.email, "upsert", "slot_override", `${themeId}:${date}:${startMinute}`, before, { action, durationMin, note });
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: { message: "시간 변경을 적용하지 못했습니다." } }, 500);
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAdminApi(request);
  if (auth.response || !auth.admin) return auth.response;
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const db = getD1();
  const before = await db.prepare("SELECT * FROM slot_overrides WHERE id = ?").bind(id).first<OverrideRow>();
  if (!before) return json({ ok: false, error: { message: "변경 시간을 찾을 수 없습니다." } }, 404);
  const booked = await db.prepare("SELECT booking_code FROM reservations WHERE theme_id = ? AND service_date = ? AND start_minute = ? AND status IN ('confirmed','checked_in') LIMIT 1").bind(before.theme_id, before.service_date, before.start_minute).first();
  if (booked) return json({ ok: false, error: { code: "HAS_BOOKING", message: "확정된 예약이 있어 이 시간 변경을 삭제할 수 없습니다." } }, 409);
  await db.prepare("DELETE FROM slot_overrides WHERE id = ?").bind(id).run();
  await audit(db, auth.admin.email, "delete", "slot_override", id, before, null);
  return json({ ok: true });
}
