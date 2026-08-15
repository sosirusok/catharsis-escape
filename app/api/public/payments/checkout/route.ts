import {
  addDays,
  createBookingCode,
  createId,
  encryptPrivate,
  enforceRateLimit,
  getD1,
  getSettings,
  isUniqueError,
  isJsonRequest,
  kstDateKey,
  normalizeName,
  normalizePhone,
  parsePrices,
  phoneHash,
  publicError,
  readJsonBody,
  requestFingerprint,
  sameOrigin,
} from "@/lib/booking";
import {
  createPaymentOrderId,
  createPaymentState,
  expirePaymentHolds,
  PAYMENT_HOLD_MS,
  type PaymentReservationRow,
} from "@/lib/payment-flow";
import { tossConfig } from "@/lib/toss-payments";

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
  turnover_min: number;
  status: string;
};

function checkoutResponse(request: Request, row: PaymentReservationRow, themeName: string) {
  const { clientKey, mode } = tossConfig();
  const origin = new URL(request.url).origin;
  const success = new URL("/api/public/payments/toss/success", origin);
  const fail = new URL("/api/public/payments/toss/fail", origin);
  success.searchParams.set("state", String(row.payment_state));
  fail.searchParams.set("state", String(row.payment_state));
  return {
    ok: true,
    payment: {
      clientKey,
      mode,
      orderId: row.payment_order_id,
      state: row.payment_state,
      orderName: themeName.length > 90 ? `${themeName.slice(0, 87)}...` : themeName,
      amount: row.price_total,
      expiresAt: row.payment_expires_at,
      successUrl: success.toString(),
      failUrl: fail.toString(),
    },
  };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return publicError("INVALID_ORIGIN", "요청을 확인할 수 없습니다.", 403);
  if (!isJsonRequest(request)) return publicError("INVALID_CONTENT_TYPE", "요청 형식을 확인해 주세요.", 415);
  try {
    tossConfig();
    if (!(await enforceRateLimit(request, "checkout", 8, 600))) return publicError("RATE_LIMITED", "잠시 후 다시 시도해 주세요.", 429);
  } catch (error) {
    if (error instanceof Error && ["TOSS_PAYMENT_UNAVAILABLE", "TOSS_PAYMENT_KEY_MISMATCH"].includes(error.message)) {
      return publicError("PAYMENT_UNAVAILABLE", "현재 카드결제를 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.", 503);
    }
    return publicError("SERVICE_ERROR", "결제를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }

  let payload: Payload;
  try { payload = await readJsonBody<Payload>(request, 12_000); }
  catch (error) { return publicError(error instanceof Error && error.message === "PAYLOAD_TOO_LARGE" ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON", "입력 내용을 확인해 주세요.", error instanceof Error && error.message === "PAYLOAD_TOO_LARGE" ? 413 : 400); }

  const name = normalizeName(payload.name);
  const phone = normalizePhone(payload.phone);
  const partySize = Number(payload.partySize);
  const slotId = typeof payload.slotId === "string" ? payload.slotId.trim() : "";
  const requestId = typeof payload.requestId === "string" ? payload.requestId.trim() : "";
  const consentVersion = typeof payload.consentVersion === "string" ? payload.consentVersion : "";
  if (!name) return publicError("INVALID_NAME", "대표자 이름을 확인해 주세요.", 400);
  if (!phone) return publicError("INVALID_PHONE", "휴대전화 번호를 확인해 주세요.", 400);
  if (!Number.isInteger(partySize)) return publicError("INVALID_PARTY", "인원을 확인해 주세요.", 400);
  const slotMatch = /^slot_([a-zA-Z0-9_-]{1,80})_(\d{8})_(\d{1,4})$/.exec(slotId);
  if (!slotMatch) return publicError("INVALID_SLOT", "예약 시간을 다시 선택해 주세요.", 400);
  if (!/^[a-f0-9-]{20,50}$/i.test(requestId)) return publicError("INVALID_REQUEST", "예약 정보를 다시 확인해 주세요.", 400);

  try {
    const db = getD1();
    await expirePaymentHolds();
    const settings = await getSettings(db);
    if (!settings.bookingOpen) return publicError("BOOKING_PAUSED", settings.pausedMessage, 409);
    if (consentVersion !== settings.consentVersion) return publicError("CONSENT_UPDATED", "개인정보 수집 동의를 다시 확인해 주세요.", 409);

    const fingerprint = await requestFingerprint({ slotId, partySize, name, phone, consentVersion });
    const existing = await db.prepare("SELECT id, booking_code, request_id, request_fingerprint, slot_id, theme_name_snapshot, service_date, start_minute, duration_min, party_size, price_total, status, payment_status, payment_order_id, payment_state, payment_key, payment_expires_at, payment_result_expires_at, paid_amount FROM reservations WHERE request_id = ? LIMIT 1")
      .bind(requestId).first<PaymentReservationRow>();
    if (existing) {
      if (existing.request_fingerprint !== fingerprint) return publicError("REQUEST_REUSED", "예약 정보를 새로 확인해 주세요.", 409);
      if (["ready", "confirming"].includes(existing.payment_status) && Number(existing.payment_expires_at) > Date.now()) {
        return Response.json(checkoutResponse(request, existing, existing.theme_name_snapshot), { headers: { "Cache-Control": "no-store" } });
      }
      if (existing.payment_status === "paid") return publicError("ALREADY_PAID", "이미 결제가 완료된 예약입니다.", 409);
      return publicError("CHECKOUT_EXPIRED", "결제 시간이 만료되었습니다. 예약 내용을 다시 확인해 주세요.", 409);
    }

    const themeId = slotMatch[1];
    const compactDate = slotMatch[2];
    const serviceDate = `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
    const startMinute = Number(slotMatch[3]);
    const today = kstDateKey();
    if (serviceDate < today || serviceDate > addDays(today, settings.horizonDays - 1) || startMinute < 0 || startMinute > 1439) {
      return publicError("SLOT_UNAVAILABLE", "예약 가능한 기간이 아닙니다.", 409);
    }
    const theme = await db.prepare("SELECT id, name, duration_min, turnover_min, min_people, max_people, prices_json, status FROM themes WHERE id = ?").bind(themeId).first<ThemeRow>();
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
    const turnoverMin = Math.max(0, Number(theme.turnover_min) || 0);
    const overlapping = await db.prepare("SELECT r.id FROM reservations r JOIN booking_slots s ON s.id = r.slot_id WHERE r.theme_id = ? AND r.service_date = ? AND r.status IN ('confirmed','checked_in') AND s.start_minute < ? AND (s.start_minute + s.duration_min + ?) > ? LIMIT 1")
      .bind(themeId, serviceDate, startMinute + durationMin + turnoverMin, turnoverMin, startMinute).first();
    if (overlapping) return publicError("SLOT_TAKEN", "다른 예약과 이용 시간이 겹칩니다. 다른 시간을 선택해 주세요.", 409);
    const priceTotal = Number(parsePrices(theme.prices_json)[String(partySize)] || 0);
    if (!Number.isSafeInteger(priceTotal) || priceTotal < 100) return publicError("PRICE_UNAVAILABLE", "이용 요금이 설정되지 않았습니다. 매장으로 문의해 주세요.", 409);

    const id = createId("res");
    const bookingCode = createBookingCode();
    const paymentOrderId = createPaymentOrderId();
    const paymentState = createPaymentState();
    const paymentExpiresAt = Date.now() + PAYMENT_HOLD_MS;
    const [nameEnc, phoneEnc, phoneDigest] = await Promise.all([encryptPrivate(name), encryptPrivate(phone), phoneHash(phone)]);

    try {
      await db.batch([
        db.prepare("INSERT INTO booking_slots (id, theme_id, service_date, start_minute, start_at_utc, duration_min, source) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET theme_id = excluded.theme_id, service_date = excluded.service_date, start_minute = excluded.start_minute, start_at_utc = excluded.start_at_utc, duration_min = excluded.duration_min, source = excluded.source WHERE NOT EXISTS (SELECT 1 FROM reservations WHERE slot_id = booking_slots.id AND status IN ('confirmed','checked_in'))")
          .bind(slotId, themeId, serviceDate, startMinute, startAtUtc, durationMin, override ? "override" : "rule"),
        db.prepare("INSERT INTO reservations (id, booking_code, request_id, request_fingerprint, slot_id, theme_id, status, party_size, customer_name_enc, phone_enc, phone_hash, phone_last4, theme_name_snapshot, service_date, start_minute, duration_min, price_total, consent_version, source, payment_status, payment_order_id, payment_state, payment_expires_at) SELECT ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'web', 'ready', ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM closures WHERE start_date <= ? AND end_date >= ? AND (scope = 'store' OR theme_id = ?)) AND NOT EXISTS (SELECT 1 FROM slot_overrides WHERE theme_id = ? AND service_date = ? AND start_minute = ? AND action = 'block') AND (EXISTS (SELECT 1 FROM schedule_rules WHERE theme_id = ? AND weekday = ? AND start_minute = ?) OR EXISTS (SELECT 1 FROM slot_overrides WHERE theme_id = ? AND service_date = ? AND start_minute = ? AND action = 'add')) AND NOT EXISTS (SELECT 1 FROM reservations r JOIN booking_slots s ON s.id = r.slot_id WHERE r.theme_id = ? AND r.service_date = ? AND r.status IN ('confirmed','checked_in') AND s.start_minute < ? AND (s.start_minute + s.duration_min + ?) > ?)")
          .bind(
            id, bookingCode, requestId, fingerprint, slotId, themeId, partySize, nameEnc, phoneEnc, phoneDigest,
            phone.slice(-4), theme.name, serviceDate, startMinute, durationMin, priceTotal, consentVersion,
            paymentOrderId, paymentState, paymentExpiresAt,
            serviceDate, serviceDate, themeId,
            themeId, serviceDate, startMinute,
            themeId, weekday, startMinute,
            themeId, serviceDate, startMinute,
            themeId, serviceDate, startMinute + durationMin + turnoverMin, turnoverMin, startMinute,
          ),
        db.prepare("INSERT INTO reservation_events (reservation_id, event_type, actor_type, actor_id, payload_json) VALUES (?, 'checkout_started', 'customer', ?, ?)")
          .bind(id, phoneDigest, JSON.stringify({ slotId, partySize, orderId: paymentOrderId })),
      ]);
    } catch (error) {
      if (isUniqueError(error)) {
        const duplicate = await db.prepare("SELECT id, booking_code, request_id, request_fingerprint, slot_id, theme_name_snapshot, service_date, start_minute, duration_min, party_size, price_total, status, payment_status, payment_order_id, payment_state, payment_key, payment_expires_at, payment_result_expires_at, paid_amount FROM reservations WHERE request_id = ? LIMIT 1").bind(requestId).first<PaymentReservationRow>();
        if (duplicate?.request_fingerprint === fingerprint && Number(duplicate.payment_expires_at) > Date.now()) {
          return Response.json(checkoutResponse(request, duplicate, duplicate.theme_name_snapshot), { headers: { "Cache-Control": "no-store" } });
        }
        return publicError("SLOT_TAKEN", "방금 다른 고객이 결제를 시작했습니다. 다른 시간을 선택해 주세요.", 409);
      }
      if (/FOREIGN KEY constraint failed/i.test(error instanceof Error ? error.message : String(error))) {
        return publicError("SLOT_UNAVAILABLE", "운영 일정이 변경되었습니다. 예약 시간을 다시 선택해 주세요.", 409);
      }
      throw error;
    }

    const row: PaymentReservationRow = {
      id, booking_code: bookingCode, request_id: requestId, request_fingerprint: fingerprint, slot_id: slotId,
      theme_name_snapshot: theme.name, service_date: serviceDate, start_minute: startMinute, duration_min: durationMin,
      party_size: partySize, price_total: priceTotal, status: "confirmed", payment_status: "ready",
      payment_order_id: paymentOrderId, payment_state: paymentState, payment_key: null,
      payment_expires_at: paymentExpiresAt, payment_result_expires_at: null, paid_amount: 0,
    };
    return Response.json(checkoutResponse(request, row, theme.name), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && ["TOSS_PAYMENT_UNAVAILABLE", "TOSS_PAYMENT_KEY_MISMATCH"].includes(error.message)) {
      return publicError("PAYMENT_UNAVAILABLE", "현재 카드결제를 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.", 503);
    }
    return publicError("SERVICE_ERROR", "결제를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
