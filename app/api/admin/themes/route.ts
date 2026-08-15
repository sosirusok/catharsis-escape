import { audit, requireAdminApi } from "@/lib/admin-api";
import { createId, getBucket, getD1, json, kstDateKey, minuteToTime, sameOrigin, weekdayKst } from "@/lib/booking";
import { findDailyOverlap, findWeeklyOverlap, slotsOverlap, type DailyTimedSlot } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

type ThemeInput = {
  id?: unknown;
  slug?: unknown;
  name?: unknown;
  shortName?: unknown;
  genre?: unknown;
  synopsis?: unknown;
  artKey?: unknown;
  imageKey?: unknown;
  difficulty?: unknown;
  difficultyLabel?: unknown;
  durationMin?: unknown;
  turnoverMin?: unknown;
  minPeople?: unknown;
  maxPeople?: unknown;
  notice?: unknown;
  prices?: unknown;
  status?: unknown;
  displayOrder?: unknown;
};

type RuleRow = { weekday: number; start_minute: number };
type OverrideRow = { service_date: string; start_minute: number; action: string; duration_min: number | null };
type BookingRow = { service_date: string; start_minute: number; duration_min: number };

function validate(input: ThemeInput) {
  const id = typeof input.id === "string" && /^[a-z0-9_-]{1,60}$/i.test(input.id) ? input.id : createId("theme");
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  const shortName = typeof input.shortName === "string" ? input.shortName.trim().slice(0, 40) : "";
  const genre = typeof input.genre === "string" ? input.genre.trim().slice(0, 50) : "";
  const synopsis = typeof input.synopsis === "string" ? input.synopsis.trim().slice(0, 500) : "";
  const artKey = typeof input.artKey === "string" && ["life", "office", "knock"].includes(input.artKey) ? input.artKey : "life";
  const difficulty = Math.max(1, Math.min(5, Number(input.difficulty) || 3));
  const durationMin = Math.max(30, Math.min(180, Number(input.durationMin) || 60));
  const turnoverValue = Number(input.turnoverMin);
  const turnoverMin = Math.max(0, Math.min(180, Math.round(Number.isFinite(turnoverValue) ? turnoverValue : 30)));
  const minPeople = Math.max(1, Math.min(20, Number(input.minPeople) || 2));
  const maxPeople = Math.max(minPeople, Math.min(30, Number(input.maxPeople) || 5));
  const status = typeof input.status === "string" && ["active", "hidden", "archived"].includes(input.status) ? input.status : "hidden";
  const slugBase = typeof input.slug === "string" ? input.slug.trim().toLowerCase() : name.toLowerCase();
  const slug = slugBase.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || id;
  const prices = input.prices && typeof input.prices === "object" ? input.prices : {};
  if (!name || !shortName || !genre || !synopsis) return null;
  const imageKey = typeof input.imageKey === "string" && /^themes\/[a-zA-Z0-9._/-]{1,180}$/.test(input.imageKey) ? input.imageKey : null;
  return { id, slug, name, shortName, genre, synopsis, artKey, imageKey, difficulty, difficultyLabel: typeof input.difficultyLabel === "string" ? input.difficultyLabel.trim().slice(0, 30) : "", durationMin, turnoverMin, minPeople, maxPeople, notice: typeof input.notice === "string" ? input.notice.trim().slice(0, 100) : "", pricesJson: JSON.stringify(prices), status, displayOrder: Math.max(0, Number(input.displayOrder) || 0) };
}

async function deleteReplacedImage(db: D1Database, previous: unknown, current: string | null) {
  const previousKey = typeof previous === "string" && /^themes\/[a-zA-Z0-9._/-]{1,180}$/.test(previous) ? previous : null;
  if (!previousKey || previousKey === current) return;
  try {
    const reference = await db.prepare("SELECT id FROM themes WHERE image_key = ? LIMIT 1").bind(previousKey).first();
    if (reference) return;
    await getBucket().delete(previousKey);
  } catch {
    return;
  }
}

async function timingConflict(db: D1Database, themeId: string, durationMin: number, turnoverMin: number): Promise<string | null> {
  const today = kstDateKey();
  const [rulesResult, overridesResult, bookingsResult] = await Promise.all([
    db.prepare("SELECT weekday, start_minute FROM schedule_rules WHERE theme_id = ? ORDER BY weekday, start_minute").bind(themeId).all<RuleRow>(),
    db.prepare("SELECT service_date, start_minute, action, duration_min FROM slot_overrides WHERE theme_id = ? AND service_date >= ? ORDER BY service_date, start_minute").bind(themeId, today).all<OverrideRow>(),
    db.prepare("SELECT service_date, start_minute, duration_min FROM reservations WHERE theme_id = ? AND service_date >= ? AND status IN ('confirmed','checked_in') ORDER BY service_date, start_minute").bind(themeId, today).all<BookingRow>(),
  ]);
  const rules = rulesResult.results.map((row) => ({ weekday: row.weekday, startMinute: row.start_minute }));
  const weekly = findWeeklyOverlap(rules.map((rule) => ({ ...rule, durationMin })), turnoverMin);
  if (weekly) return `${minuteToTime(weekly.first.startMinute)}과 ${minuteToTime(weekly.second.startMinute)} 운영 시간이 겹칩니다. 먼저 주간 시간을 조정해 주세요.`;

  const affectedDates = new Set([
    ...overridesResult.results.map((row) => row.service_date),
    ...bookingsResult.results.map((row) => row.service_date),
  ]);
  for (const date of affectedDates) {
    const slots = new Map<number, DailyTimedSlot>();
    const weekday = weekdayKst(date);
    for (const rule of rules) {
      if (rule.weekday === weekday) slots.set(rule.startMinute, { startMinute: rule.startMinute, durationMin });
    }
    for (const override of overridesResult.results.filter((row) => row.service_date === date)) {
      if (override.action === "block") slots.delete(override.start_minute);
      else slots.set(override.start_minute, { startMinute: override.start_minute, durationMin: override.duration_min || durationMin });
    }
    const dateOverlap = findDailyOverlap([...slots.values()], turnoverMin);
    if (dateOverlap) return `${date}의 ${minuteToTime(dateOverlap.first.startMinute)}과 ${minuteToTime(dateOverlap.second.startMinute)} 운영 시간이 겹칩니다. 날짜별 시간을 먼저 조정해 주세요.`;
    for (const booking of bookingsResult.results.filter((row) => row.service_date === date)) {
      const collision = [...slots.values()].find((slot) => slot.startMinute !== booking.start_minute && slotsOverlap(slot, { startMinute: booking.start_minute, durationMin: booking.duration_min }, turnoverMin));
      if (collision) return `${date} ${minuteToTime(booking.start_minute)} 확정 예약과 운영 시간이 겹칩니다. 예약 시간을 유지하도록 일정을 먼저 조정해 주세요.`;
    }
  }
  return null;
}

export async function POST(request: Request) {
  const auth = await requireAdminApi(request);
  if (auth.response || !auth.admin) return auth.response;
  try {
    const value = validate((await request.json()) as ThemeInput);
    if (!value) return json({ ok: false, error: { code: "INVALID_THEME", message: "필수 테마 정보를 모두 입력해 주세요." } }, 400);
    const db = getD1();
    await db.prepare("INSERT INTO themes (id, slug, name, short_name, genre, synopsis, art_key, image_key, difficulty, difficulty_label, duration_min, turnover_min, min_people, max_people, notice, prices_json, status, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(value.id, value.slug, value.name, value.shortName, value.genre, value.synopsis, value.artKey, value.imageKey, value.difficulty, value.difficultyLabel, value.durationMin, value.turnoverMin, value.minPeople, value.maxPeople, value.notice, value.pricesJson, value.status, value.displayOrder).run();
    await audit(db, auth.admin.email, "create", "theme", value.id, null, value);
    return json({ ok: true, id: value.id }, 201);
  } catch {
    return json({ ok: false, error: { code: "SAVE_FAILED", message: "테마를 등록하지 못했습니다. 테마명과 필수 정보를 확인해 주세요." } }, 409);
  }
}

export async function PUT(request: Request) {
  const auth = await requireAdminApi(request);
  if (auth.response || !auth.admin) return auth.response;
  try {
    const value = validate((await request.json()) as ThemeInput);
    if (!value) return json({ ok: false, error: { code: "INVALID_THEME", message: "필수 테마 정보를 모두 입력해 주세요." } }, 400);
    const db = getD1();
    const before = await db.prepare("SELECT * FROM themes WHERE id = ?").bind(value.id).first();
    if (!before) return json({ ok: false, error: { code: "NOT_FOUND", message: "테마를 찾을 수 없습니다." } }, 404);
    if (Number((before as Record<string, unknown>).duration_min) !== value.durationMin || Number((before as Record<string, unknown>).turnover_min) !== value.turnoverMin) {
      const conflict = await timingConflict(db, value.id, value.durationMin, value.turnoverMin);
      if (conflict) return json({ ok: false, error: { code: "SCHEDULE_OVERLAP", message: conflict } }, 409);
    }
    await db.prepare("UPDATE themes SET slug = ?, name = ?, short_name = ?, genre = ?, synopsis = ?, art_key = ?, image_key = ?, difficulty = ?, difficulty_label = ?, duration_min = ?, turnover_min = ?, min_people = ?, max_people = ?, notice = ?, prices_json = ?, status = ?, display_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(value.slug, value.name, value.shortName, value.genre, value.synopsis, value.artKey, value.imageKey, value.difficulty, value.difficultyLabel, value.durationMin, value.turnoverMin, value.minPeople, value.maxPeople, value.notice, value.pricesJson, value.status, value.displayOrder, value.id).run();
    await audit(db, auth.admin.email, "update", "theme", value.id, before, value);
    await deleteReplacedImage(db, (before as Record<string, unknown>).image_key, value.imageKey);
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: { code: "SAVE_FAILED", message: "테마를 저장하지 못했습니다." } }, 409);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false }, 403);
  const auth = await requireAdminApi(request);
  if (auth.response || !auth.admin) return auth.response;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[a-z0-9_-]{1,80}$/i.test(id)) return json({ ok: false, error: { code: "INVALID_ID", message: "테마를 확인해 주세요." } }, 400);
  const db = getD1();
  const before = await db.prepare("SELECT * FROM themes WHERE id = ?").bind(id).first();
  if (!before) return json({ ok: false, error: { code: "NOT_FOUND", message: "테마를 찾을 수 없습니다." } }, 404);
  const future = await db.prepare("SELECT COUNT(*) count FROM reservations WHERE theme_id = ? AND status IN ('confirmed','checked_in') AND service_date >= date('now','+9 hours')").bind(id).first<{ count: number }>();
  if (Number(future?.count || 0) > 0) return json({ ok: false, error: { code: "HAS_BOOKINGS", message: "예정된 예약이 있어 삭제할 수 없습니다. 숨김으로 변경해 주세요." } }, 409);
  await db.prepare("UPDATE themes SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
  await audit(db, auth.admin.email, "archive", "theme", id, before, { status: "archived" });
  return json({ ok: true });
}
