import {
  createBookingCode,
  createId,
  encryptPrivate,
  enforceRateLimit,
  getD1,
  getSettings,
  addDays,
  isUniqueError,
  kstDateKey,
  json,
  normalizeName,
  normalizePhone,
  phoneHash,
  publicError,
  requestFingerprint,
  sameOrigin,
} from "@/lib/booking";

export const dynamic = "force-dynamic";

type Payload = {
  slotId?: unknown;
  partySize?: unknown;
  name?: unknown;
  phone?: unknown;
  consentVersion?: unknown;
  requestId?: unknown;
};

type ThemeRow = {
  id: string;
  name: string;
  duration_min: number;
  min_people: number;
  max_people: number;
  prices_json: string;
  status: string;
};

type ExistingRow = {
  booking_code: string;
  request_fingerprint: string;
  theme_name_snapshot: string;
  service_date: string;
  start_minute: number;
  duration_min: number;
  party_size: number;
  price_total: number;
  status: string;
};

function summary(row: ExistingRow) {
  return {
    bookingCode: row.booking_code,
    themeName: row.theme_name_snapshot,
    date: row.service_date,
    startMinute: row.start_minute,
    durationMin: row.duration_min,
    partySize: row.party_size,
    priceTotal: row.price_total,
    status: row.status,
  };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return publicError("INVALID_ORIGIN", "요청을 확인할 수 없습니다.", 403);
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 12_000) return publicError("PAYLOAD_TOO_LARGE", "입력 내용을 확인해 주세요.", 413);

  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return publicError("INVALID_JSON", "입력 내용을 확인해 주세요.", 400);
  }

  const name = normalizeName(payload.name);
  const phone = normalizePhone(payload.phone);
  const partySize = Number(payload.partySize);
  const slotId = typeof payload.slotId === "string" ? payload.slotId.trim() : "";
  const requestId = typeof payload.requestId === "string" ? payload.requestId.trim() : "";
  const consentVersion = typeof payload.consentVersion === "string" ? payload.consentVersion : "";
  if (!name) return publicError("INVALID_NAME", "대표자 이름을 확인해 주세요.", 400);
  if (!phone) return publicError("INVALID_PHONE", "휴대전화 번호를 확인해 주세요.", 400);
  if (!Number.isInteger(partySize)) return publicError("INVALID_PARTY", "인원을 확인해 주세요.", 400);
  const slotMatch = /^slot_(.+)_(\d{8})_(\d{1,4})$/.exec(slotId);
  if (!slotMatch) return publicError("INVALID_SLOT", "예약 시간을 다시 선택해 주세요.", 400);
  if (!/^[a-f0-9-]{20,50}$/i.test(requestId)) return publicError("INVALID_REQUEST", "예약 정보를 다시 확인해 주세요.", 400);

  try {
    const db = getD1();
    if (!(await enforceRateLimit(request, "create", 8, 600))) return publicError("RATE_LIMITED", "잠시 후 다시 시도해 주세요.", 429);
    const settings = await getSettings(db);
    if (!settings.bookingOpen) return publicError("BOOKING_PAUSED", settings.pausedMessage, 409);
    if (consentVersion !== settings.consentVersion) return publicError("CONSENT_UPDATED", "개인정보 수집 동의를 다시 확인해 주세요.", 409);

    const fingerprintPayload = { slotId, partySize, name, phone, consentVersion };
    const fingerprint = await requestFingerprint(fingerprintPayload);
    const existing = await db.prepare("SELECT booking_code, request_fingerprint, theme_name_snapshot, service_date, start_minute, duration_min, party_size, price_total, status FROM reservations WHERE request_id = ?").bind(requestId).first<ExistingRow>();
    if (existing) {
      if (existing.request_fingerprint !== fingerprint) return publicError("REQUEST_REUSED", "예약 정보를 새로 확인해 주세요.", 409);
      return json({ ok: true, reservation: summary(existing) }, 200);
    }

    const themeId = slotMatch[1];
    const compactDate = slotMatch[2];
    const serviceDate = `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
    const startMinute = Number(slotMatch[3]);
    const today = kstDateKey();
    if (serviceDate < today || serviceDate > addDays(today, settings.horizonDays - 1) || startMinute < 0 || startMinute > 1439) {
      return publicError("SLOT_UNAVAILABLE", "예약 가능한 기간이 아닙니다.", 409);
    }
    const theme = await db.prepare("SELECT id, name, duration_min, min_people, max_people, prices_json, status FROM themes WHERE id = ?").bind(themeId).first<ThemeRow>();
    if (!theme || theme.status !== "active") return publicError("SLOT_UNAVAILABLE", "선택한 시간은 예약할 수 없습니다.", 409);
    if (partySize < theme.min_people || partySize > theme.max_people) return publicError("INVALID_PARTY", `${theme.min_people}명부터 ${theme.max_people}명까지 예약할 수 있습니다.`, 400);
    const startAtUtc = Date.UTC(Number(compactDate.slice(0, 4)), Number(compactDate.slice(4, 6)) - 1, Number(compactDate.slice(6, 8)), Math.floor(startMinute / 60) - 9, startMinute % 60);
    if (startAtUtc <= Date.now() + settings.leadMinutes * 60_000) return publicError("SLOT_CLOSED", "예약 접수가 마감된 시간입니다.", 409);

    const closure = await db.prepare("SELECT id FROM closures WHERE start_date <= ? AND end_date >= ? AND (scope = 'store' OR theme_id = ?) LIMIT 1").bind(serviceDate, serviceDate, themeId).first();
    const override = await db.prepare("SELECT action, duration_min FROM slot_overrides WHERE theme_id = ? AND service_date = ? AND start_minute = ?").bind(themeId, serviceDate, startMinute).first<{ action: string; duration_min: number | null }>();
    if (closure || override?.action === "block") return publicError("SLOT_BLOCKED", "선택한 시간은 마감되었습니다.", 409);
    const weekday = new Date(`${serviceDate}T12:00:00+09:00`).getUTCDay();
    const rule = await db.prepare("SELECT id FROM schedule_rules WHERE theme_id = ? AND weekday = ? AND start_minute = ? LIMIT 1").bind(themeId, weekday, startMinute).first();
    if (!rule && override?.action !== "add") return publicError("SLOT_UNAVAILABLE", "운영 일정이 변경되었습니다. 다른 시간을 선택해 주세요.", 409);
    const durationMin = override?.duration_min || theme.duration_min;
    let prices: Record<string, number> = {};
    try { prices = JSON.parse(theme.prices_json) as Record<string, number>; } catch {}
    const priceTotal = Number(prices[String(partySize)] || 0);
    const id = createId("res");
    const bookingCode = createBookingCode();
    const [nameEnc, phoneEnc, phoneDigest] = await Promise.all([encryptPrivate(name), encryptPrivate(phone), phoneHash(phone)]);

    try {
      await db.batch([
        db.prepare("INSERT INTO booking_slots (id, theme_id, service_date, start_minute, start_at_utc, duration_min, source) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET theme_id = excluded.theme_id, service_date = excluded.service_date, start_minute = excluded.start_minute, start_at_utc = excluded.start_at_utc, duration_min = excluded.duration_min, source = excluded.source WHERE NOT EXISTS (SELECT 1 FROM reservations WHERE slot_id = booking_slots.id AND status IN ('confirmed','checked_in'))")
          .bind(slotId, themeId, serviceDate, startMinute, startAtUtc, durationMin, override ? "override" : "rule"),
        db.prepare("INSERT INTO reservations (id, booking_code, request_id, request_fingerprint, slot_id, theme_id, status, party_size, customer_name_enc, phone_enc, phone_hash, phone_last4, theme_name_snapshot, service_date, start_minute, duration_min, price_total, consent_version, source) VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'web')")
          .bind(id, bookingCode, requestId, fingerprint, slotId, themeId, partySize, nameEnc, phoneEnc, phoneDigest, phone.slice(-4), theme.name, serviceDate, startMinute, durationMin, priceTotal, consentVersion),
        db.prepare("INSERT INTO reservation_events (reservation_id, event_type, actor_type, actor_id, payload_json) VALUES (?, 'created', 'customer', ?, ?)")
          .bind(id, phoneDigest, JSON.stringify({ slotId, partySize, source: "web" })),
      ]);
    } catch (error) {
      if (isUniqueError(error)) {
        const duplicate = await db.prepare("SELECT booking_code, request_fingerprint, theme_name_snapshot, service_date, start_minute, duration_min, party_size, price_total, status FROM reservations WHERE request_id = ?").bind(requestId).first<ExistingRow>();
        if (duplicate?.request_fingerprint === fingerprint) return json({ ok: true, reservation: summary(duplicate) });
        return publicError("SLOT_TAKEN", "방금 다른 예약이 접수되었습니다. 다른 시간을 선택해 주세요.", 409);
      }
      throw error;
    }

    return json({ ok: true, reservation: { bookingCode, themeName: theme.name, date: serviceDate, startMinute, durationMin, partySize, priceTotal, status: "confirmed" } }, 201);
  } catch {
    return publicError("SERVICE_ERROR", "예약을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
