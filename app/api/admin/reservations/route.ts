import { audit, requireAdminApi } from "@/lib/admin-api";
import { createBookingCode, createId, encryptPrivate, getD1, isUniqueError, json, normalizeName, normalizePhone, phoneHash, sameOrigin, timeToMinute } from "@/lib/booking";
import { refundReservationPayment } from "@/lib/payment-flow";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const auth = await requireAdminApi(request);
  if (auth.response || !auth.admin) return auth.response;
  try {
    const body = (await request.json()) as { id?: unknown; status?: unknown; partySize?: unknown; name?: unknown; phone?: unknown; memo?: unknown };
    const id = typeof body.id === "string" ? body.id : "";
    const db = getD1();
    const before = await db.prepare("SELECT * FROM reservations WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!before) return json({ ok: false, error: { message: "예약을 찾을 수 없습니다." } }, 404);
    const status = typeof body.status === "string" && ["confirmed", "cancelled", "checked_in", "completed", "no_show"].includes(body.status) ? body.status : String(before.status);
    if (status === "cancelled" && ["paid", "refund_processing"].includes(String(before.payment_status))) {
      try {
        await refundReservationPayment(id, "관리자 취소");
        await audit(db, auth.admin.email, "refund", "reservation", id, before, { status: "cancelled" });
        return json({ ok: true, refunded: true });
      } catch {
        return json({ ok: false, error: { code: "REFUND_PENDING", message: "카드 환불 상태를 확인하고 있습니다. 잠시 후 다시 시도해 주세요." } }, 409);
      }
    }
    if (["confirming", "review_required", "refund_processing"].includes(String(before.payment_status))) {
      return json({ ok: false, error: { code: "PAYMENT_IN_PROGRESS", message: "결제 또는 환불 처리 중인 예약은 변경할 수 없습니다. 잠시 후 다시 확인해 주세요." } }, 409);
    }
    if (String(before.payment_status) === "ready" && status !== "cancelled") {
      return json({ ok: false, error: { code: "PAYMENT_IN_PROGRESS", message: "결제 진행 중인 예약은 취소만 할 수 있습니다." } }, 409);
    }
    if (String(before.payment_status) === "refunded" && status !== "cancelled") {
      return json({ ok: false, error: { code: "REFUNDED_RESERVATION", message: "환불된 예약은 다시 활성화할 수 없습니다. 새 예약으로 등록해 주세요." } }, 409);
    }
    if (["failed", "expired"].includes(String(before.payment_status)) && status !== "cancelled") {
      return json({ ok: false, error: { code: "PAYMENT_REQUIRED", message: "결제가 완료되지 않은 예약은 다시 활성화할 수 없습니다. 새 예약으로 등록해 주세요." } }, 409);
    }
    const partySize = Math.max(1, Math.min(30, Number(body.partySize) || Number(before.party_size)));
    const memo = typeof body.memo === "string" ? body.memo.trim().slice(0, 500) : String(before.admin_memo || "");
    const name = body.name === undefined ? null : normalizeName(body.name);
    const phone = body.phone === undefined ? null : normalizePhone(body.phone);
    let nameEnc = String(before.customer_name_enc);
    let phoneEnc = String(before.phone_enc);
    let phoneDigest = String(before.phone_hash);
    let last4 = String(before.phone_last4);
    if (body.name !== undefined) {
      if (!name) return json({ ok: false, error: { message: "대표자 이름을 확인해 주세요." } }, 400);
      nameEnc = await encryptPrivate(name);
    }
    if (body.phone !== undefined) {
      if (!phone) return json({ ok: false, error: { message: "전화번호를 확인해 주세요." } }, 400);
      phoneEnc = await encryptPrivate(phone);
      phoneDigest = await phoneHash(phone);
      last4 = phone.slice(-4);
    }
    try {
      const updated = await db.prepare("UPDATE reservations SET status = ?, party_size = ?, customer_name_enc = ?, phone_enc = ?, phone_hash = ?, phone_last4 = ?, admin_memo = ?, cancelled_at = CASE WHEN ? = 'cancelled' THEN COALESCE(cancelled_at, CURRENT_TIMESTAMP) ELSE NULL END, cancel_reason = CASE WHEN ? = 'cancelled' THEN '관리자 취소' ELSE '' END, payment_status = CASE WHEN ? = 'cancelled' AND payment_status = 'ready' THEN 'failed' ELSE payment_status END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (payment_status NOT IN ('ready','confirming','review_required','refund_processing') OR (payment_status = 'ready' AND ? = 'cancelled'))")
        .bind(status, partySize, nameEnc, phoneEnc, phoneDigest, last4, memo, status, status, status, id, status).run();
      if (!updated.meta.changes) return json({ ok: false, error: { code: "PAYMENT_IN_PROGRESS", message: "결제 상태가 변경되어 예약을 저장하지 않았습니다. 새로고침 후 다시 확인해 주세요." } }, 409);
    } catch (error) {
      if (isUniqueError(error)) return json({ ok: false, error: { code: "SLOT_TAKEN", message: "같은 시간에 이미 확정된 예약이 있어 다시 활성화할 수 없습니다." } }, 409);
      throw error;
    }
    await audit(db, auth.admin.email, "update", "reservation", id, before, { status, partySize, memo });
    await db.prepare("INSERT INTO reservation_events (reservation_id, event_type, actor_type, actor_id, payload_json) VALUES (?, 'updated', 'admin', ?, ?)").bind(id, auth.admin.email, JSON.stringify({ status, partySize, memo })).run();
    if (status === "cancelled") await db.prepare("INSERT OR IGNORE INTO owner_alerts (reservation_id, type, booking_code, theme_name, service_date, start_minute, party_size, amount, status, payment_status, customer_name_enc, phone_enc) SELECT id, 'reservation.cancelled', booking_code, theme_name_snapshot, service_date, start_minute, party_size, price_total, 'cancelled', payment_status, customer_name_enc, phone_enc FROM reservations WHERE id = ?").bind(id).run();
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: { message: "예약을 저장하지 못했습니다." } }, 500);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false }, 403);
  const auth = await requireAdminApi(request);
  if (auth.response || !auth.admin) return auth.response;
  try {
    const body = (await request.json()) as { themeId?: unknown; date?: unknown; time?: unknown; partySize?: unknown; name?: unknown; phone?: unknown; memo?: unknown };
    const themeId = typeof body.themeId === "string" ? body.themeId : "";
    const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : "";
    const startMinute = timeToMinute(body.time);
    const partySize = Number(body.partySize);
    const name = normalizeName(body.name);
    const phone = normalizePhone(body.phone);
    if (!themeId || !date || startMinute === null || !Number.isInteger(partySize) || !name || !phone) return json({ ok: false, error: { message: "예약 정보를 모두 확인해 주세요." } }, 400);
    const db = getD1();
    const theme = await db.prepare("SELECT * FROM themes WHERE id = ?").bind(themeId).first<Record<string, unknown>>();
    if (!theme) return json({ ok: false, error: { message: "테마를 찾을 수 없습니다." } }, 404);
    const slotId = `slot_${themeId}_${date.replaceAll("-", "")}_${startMinute}`;
    const startAtUtc = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), Math.floor(startMinute / 60) - 9, startMinute % 60);
    const duration = Number(theme.duration_min);
    const turnover = Math.max(0, Number(theme.turnover_min) || 0);
    const overlapping = await db.prepare("SELECT r.id FROM reservations r JOIN booking_slots s ON s.id = r.slot_id WHERE r.theme_id = ? AND r.service_date = ? AND r.status IN ('confirmed','checked_in') AND s.start_minute < ? AND (s.start_minute + s.duration_min + ?) > ? LIMIT 1")
      .bind(themeId, date, startMinute + duration + turnover, turnover, startMinute).first();
    if (overlapping) return json({ ok: false, error: { code: "TIME_OVERLAP", message: "선택한 시간과 겹치는 예약이 있습니다." } }, 409);
    const id = createId("res");
    const [nameEnc, phoneEnc, digest] = await Promise.all([encryptPrivate(name), encryptPrivate(phone), phoneHash(phone)]);
    const bookingCode = createBookingCode();
    const memo = typeof body.memo === "string" ? body.memo.trim().slice(0, 500) : "";
    await db.batch([
      db.prepare("INSERT INTO booking_slots (id, theme_id, service_date, start_minute, start_at_utc, duration_min, source) VALUES (?, ?, ?, ?, ?, ?, 'admin') ON CONFLICT(id) DO UPDATE SET theme_id = excluded.theme_id, service_date = excluded.service_date, start_minute = excluded.start_minute, start_at_utc = excluded.start_at_utc, duration_min = excluded.duration_min, source = excluded.source WHERE NOT EXISTS (SELECT 1 FROM reservations WHERE slot_id = booking_slots.id AND status IN ('confirmed','checked_in'))")
        .bind(slotId, themeId, date, startMinute, startAtUtc, duration),
      db.prepare("INSERT INTO reservations (id, booking_code, request_id, request_fingerprint, slot_id, theme_id, status, party_size, customer_name_enc, phone_enc, phone_hash, phone_last4, theme_name_snapshot, service_date, start_minute, duration_min, price_total, consent_version, source, admin_memo) SELECT ?, ?, ?, '', ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'admin', 'admin', ? WHERE NOT EXISTS (SELECT 1 FROM reservations r JOIN booking_slots s ON s.id = r.slot_id WHERE r.theme_id = ? AND r.service_date = ? AND r.status IN ('confirmed','checked_in') AND s.start_minute < ? AND (s.start_minute + s.duration_min + ?) > ?)")
        .bind(id, bookingCode, createId("admin"), slotId, themeId, partySize, nameEnc, phoneEnc, digest, phone.slice(-4), String(theme.name), date, startMinute, duration, memo, themeId, date, startMinute + duration + turnover, turnover, startMinute),
      db.prepare("INSERT INTO reservation_events (reservation_id, event_type, actor_type, actor_id, payload_json) VALUES (?, 'created', 'admin', ?, ?)").bind(id, auth.admin.email, JSON.stringify({ source: "admin" })),
      db.prepare("INSERT OR IGNORE INTO owner_alerts (reservation_id, type, booking_code, theme_name, service_date, start_minute, party_size, amount, status, payment_status, customer_name_enc, phone_enc) SELECT id, 'reservation.confirmed', booking_code, theme_name_snapshot, service_date, start_minute, party_size, price_total, 'confirmed', 'manual', customer_name_enc, phone_enc FROM reservations WHERE id = ?").bind(id),
    ]);
    await audit(db, auth.admin.email, "create", "reservation", id, null, { bookingCode, themeId, date, startMinute, partySize });
    return json({ ok: true, bookingCode }, 201);
  } catch (error) {
    if (isUniqueError(error)) return json({ ok: false, error: { code: "SLOT_TAKEN", message: "이미 예약된 시간입니다." } }, 409);
    if (/FOREIGN KEY constraint failed/i.test(error instanceof Error ? error.message : String(error))) return json({ ok: false, error: { code: "TIME_OVERLAP", message: "동시에 등록된 예약과 시간이 겹칩니다. 예약 현황을 다시 확인해 주세요." } }, 409);
    return json({ ok: false, error: { message: "예약을 등록하지 못했습니다." } }, 500);
  }
}
