import {
  createId,
  getD1,
  json,
  runtimeEnv,
} from "@/lib/booking";
import {
  cancelTossPayment,
  confirmTossPayment,
  getTossPayment,
  tossConfig,
  TossApiError,
  type TossPayment,
} from "@/lib/toss-payments";

export const PAYMENT_HOLD_MS = 10 * 60_000;
export const PAYMENT_RESULT_MS = 24 * 60 * 60_000;

export type PaymentReservationRow = {
  id: string;
  booking_code: string;
  request_id: string;
  request_fingerprint: string;
  slot_id: string;
  theme_name_snapshot: string;
  service_date: string;
  start_minute: number;
  duration_min: number;
  party_size: number;
  price_total: number;
  status: string;
  payment_status: string;
  payment_order_id: string | null;
  payment_state: string | null;
  payment_key: string | null;
  payment_expires_at: number | null;
  payment_result_expires_at: number | null;
  paid_amount: number;
  updated_at?: string;
};

export function paymentSummary(row: PaymentReservationRow) {
  return {
    bookingCode: row.booking_code,
    themeName: row.theme_name_snapshot,
    date: row.service_date,
    startMinute: row.start_minute,
    durationMin: row.duration_min,
    partySize: row.party_size,
    priceTotal: row.price_total,
    status: row.status,
    paymentStatus: row.payment_status,
  };
}

export function createPaymentOrderId() {
  return `CTP_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function createPaymentState() {
  return `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

export function publicSiteUrl() {
  const configured = runtimeEnv().PUBLIC_SITE_URL || "https://sosirusok.github.io/catharsis-escape/";
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:") throw new Error("INVALID_PUBLIC_SITE_URL");
    return url.toString();
  } catch {
    return "https://sosirusok.github.io/catharsis-escape/";
  }
}

export function paymentRedirect(kind: "success" | "processing" | "fail", values: Record<string, string>) {
  const destination = new URL(publicSiteUrl());
  const fragment = new URLSearchParams({ payment: kind, ...values });
  destination.hash = fragment.toString();
  return Response.redirect(destination.toString(), 303);
}

export async function expirePaymentHolds(now = Date.now()) {
  await getD1().prepare(
    "UPDATE reservations SET status = 'cancelled', payment_status = 'expired', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = '결제 시간 만료', updated_at = CURRENT_TIMESTAMP WHERE status = 'confirmed' AND payment_status = 'ready' AND payment_expires_at IS NOT NULL AND payment_expires_at <= ?",
  ).bind(now).run();
}

async function rowByState(state: string) {
  return getD1().prepare(
    "SELECT id, booking_code, request_id, request_fingerprint, slot_id, theme_name_snapshot, service_date, start_minute, duration_min, party_size, price_total, status, payment_status, payment_order_id, payment_state, payment_key, payment_expires_at, payment_result_expires_at, paid_amount FROM reservations WHERE payment_state = ? LIMIT 1",
  ).bind(state).first<PaymentReservationRow>();
}

async function rowById(id: string) {
  return getD1().prepare(
    "SELECT id, booking_code, request_id, request_fingerprint, slot_id, theme_name_snapshot, service_date, start_minute, duration_min, party_size, price_total, status, payment_status, payment_order_id, payment_state, payment_key, payment_expires_at, payment_result_expires_at, paid_amount FROM reservations WHERE id = ? LIMIT 1",
  ).bind(id).first<PaymentReservationRow>();
}

function validateTossResult(row: PaymentReservationRow, payment: TossPayment) {
  if (
    payment.orderId !== row.payment_order_id ||
    payment.paymentKey !== row.payment_key ||
    Number(payment.totalAmount) !== row.price_total ||
    payment.status !== "DONE"
  ) {
    throw new Error("PAYMENT_VERIFICATION_FAILED");
  }
}

async function finalizePaid(row: PaymentReservationRow, payment: TossPayment) {
  validateTossResult(row, payment);
  const db = getD1();
  const receiptUrl = payment.receipt?.url || "";
  await db.batch([
    db.prepare("INSERT INTO reservation_events (reservation_id, event_type, actor_type, actor_id, payload_json) SELECT id, 'payment_confirmed', 'payment', '', ? FROM reservations WHERE id = ? AND payment_status IN ('confirming','review_required')")
      .bind(JSON.stringify({ orderId: payment.orderId, amount: payment.totalAmount, method: payment.method || "카드" }), row.id),
    db.prepare("INSERT OR IGNORE INTO owner_alerts (reservation_id, type, booking_code, theme_name, service_date, start_minute, party_size, amount, status, payment_status, customer_name_enc, phone_enc) SELECT id, 'reservation.confirmed', booking_code, theme_name_snapshot, service_date, start_minute, party_size, price_total, 'confirmed', 'paid', customer_name_enc, phone_enc FROM reservations WHERE id = ? AND payment_status IN ('confirming','review_required')")
      .bind(row.id),
    db.prepare("UPDATE reservations SET status = 'confirmed', payment_status = 'paid', payment_key = ?, payment_method = ?, paid_amount = ?, paid_at = ?, receipt_url = ?, payment_result_expires_at = ?, payment_failure_code = '', payment_failure_message = '', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status IN ('confirming','review_required')")
      .bind(payment.paymentKey, payment.method || "카드", payment.totalAmount, payment.approvedAt || new Date().toISOString(), receiptUrl, Date.now() + PAYMENT_RESULT_MS, row.id),
  ]);
  const finalized = await rowById(row.id);
  if (!finalized || finalized.status !== "confirmed" || finalized.payment_status !== "paid" || finalized.paid_amount !== payment.totalAmount) {
    throw new Error("PAYMENT_FINALIZATION_PENDING");
  }
  return finalized;
}

export async function reconcileStalePayments(now = Date.now(), limit = 3) {
  const db = getD1();
  const stale = await db.prepare(
    "SELECT id, booking_code, request_id, request_fingerprint, slot_id, theme_name_snapshot, service_date, start_minute, duration_min, party_size, price_total, status, payment_status, payment_order_id, payment_state, payment_key, payment_expires_at, payment_result_expires_at, paid_amount, updated_at FROM reservations WHERE status = 'confirmed' AND payment_status IN ('confirming','review_required') AND payment_expires_at IS NOT NULL AND payment_expires_at <= ? AND ((payment_status = 'confirming' AND updated_at <= datetime('now', '-2 minutes')) OR (payment_status = 'review_required' AND updated_at <= datetime('now', '-30 minutes'))) ORDER BY payment_expires_at LIMIT ?",
  ).bind(now, Math.max(1, Math.min(3, limit))).all<PaymentReservationRow>();
  await Promise.allSettled(stale.results.map(async (row) => {
    if (!row.payment_order_id || !row.payment_key) return;
    const claimed = await db.prepare("UPDATE reservations SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status IN ('confirming','review_required') AND updated_at = ?")
      .bind(row.id, row.updated_at || "").run();
    if (!claimed.meta.changes) return;
    await recoverConfirming(row);
  }));
}

async function recoverConfirming(row: PaymentReservationRow) {
  if (!row.payment_order_id || !row.payment_key) throw new Error("PAYMENT_RECOVERY_UNAVAILABLE");
  let payment: TossPayment;
  try {
    payment = await getTossPayment(row.payment_order_id);
  } catch (error) {
    if (!(error instanceof TossApiError) || error.status !== 404) throw error;
    if (Number(row.payment_expires_at || 0) + 30 * 60_000 <= Date.now()) {
      await getD1().prepare("UPDATE reservations SET payment_status = 'review_required', payment_failure_code = 'PAYMENT_LOOKUP_NOT_FOUND', payment_failure_message = '토스 결제 내역 확인 필요', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status IN ('confirming','review_required')").bind(row.id).run();
      throw new Error("PAYMENT_PROCESSING");
    }
    try {
      payment = await confirmTossPayment(row.payment_key, row.payment_order_id, row.price_total, `confirm-${row.payment_order_id}`);
    } catch {
      throw new Error("PAYMENT_PROCESSING");
    }
  }
  if (payment.status === "DONE") return finalizePaid(row, payment);
  if (["CANCELED", "ABORTED", "EXPIRED"].includes(payment.status)) {
    await getD1().prepare("UPDATE reservations SET status = 'cancelled', payment_status = 'failed', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = '결제 미완료', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status IN ('confirming','review_required')").bind(row.id).run();
    throw new Error("PAYMENT_NOT_COMPLETED");
  }
  if (["READY", "IN_PROGRESS"].includes(payment.status) && Number(row.payment_expires_at || 0) + 20 * 60_000 > Date.now()) {
    try {
      payment = await confirmTossPayment(row.payment_key, row.payment_order_id, row.price_total, `confirm-${row.payment_order_id}`);
      return finalizePaid(row, payment);
    } catch (error) {
      if (!(error instanceof TossApiError) || error.status >= 500 || error.code === "ALREADY_PROCESSED_PAYMENT") throw new Error("PAYMENT_PROCESSING");
      try {
        const authoritative = await getTossPayment(row.payment_order_id);
        if (authoritative.status === "DONE") return finalizePaid(row, authoritative);
        if (["CANCELED", "ABORTED", "EXPIRED"].includes(authoritative.status)) {
          await getD1().prepare("UPDATE reservations SET status = 'cancelled', payment_status = 'failed', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = '결제 미완료', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status IN ('confirming','review_required')").bind(row.id).run();
          throw new Error("PAYMENT_NOT_COMPLETED");
        }
      } catch (verificationError) {
        if (verificationError instanceof Error && verificationError.message === "PAYMENT_NOT_COMPLETED") throw verificationError;
      }
      throw new Error("PAYMENT_PROCESSING");
    }
  }
  if (["READY", "IN_PROGRESS"].includes(payment.status) && Number(row.payment_expires_at || 0) + 30 * 60_000 <= Date.now()) {
    await getD1().prepare("UPDATE reservations SET status = 'cancelled', payment_status = 'failed', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = '결제 승인 시간 만료', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status IN ('confirming','review_required')").bind(row.id).run();
    throw new Error("PAYMENT_NOT_COMPLETED");
  }
  throw new Error("PAYMENT_PROCESSING");
}

export async function confirmReservationPayment(input: { state: string; orderId: string; paymentKey: string; amount: number }) {
  const row = await rowByState(input.state);
  if (!row || !row.payment_order_id || row.payment_order_id !== input.orderId || row.price_total !== input.amount) {
    throw new Error("PAYMENT_INFORMATION_MISMATCH");
  }
  if (row.payment_status === "paid") return row;
  if (["confirming", "review_required"].includes(row.payment_status)) return recoverConfirming(row);
  if (row.payment_status !== "ready" || row.status !== "confirmed") throw new Error("PAYMENT_NOT_AVAILABLE");
  if (!row.payment_expires_at || row.payment_expires_at <= Date.now()) {
    await expirePaymentHolds();
    throw new Error("PAYMENT_EXPIRED");
  }

  const claimed = await getD1().prepare("UPDATE reservations SET payment_status = 'confirming', payment_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'confirmed' AND payment_status = 'ready' AND payment_expires_at > ?")
    .bind(input.paymentKey, row.id, Date.now()).run();
  if (!claimed.meta.changes) {
    const latest = await rowById(row.id);
    if (latest?.payment_status === "paid") return latest;
    if (latest?.payment_status === "confirming") return recoverConfirming(latest);
    throw new Error("PAYMENT_NOT_AVAILABLE");
  }

  const confirming = { ...row, payment_status: "confirming", payment_key: input.paymentKey };
  try {
    const payment = await confirmTossPayment(input.paymentKey, input.orderId, input.amount, `confirm-${input.orderId}`);
    return finalizePaid(confirming, payment);
  } catch (error) {
    if (error instanceof TossApiError && (error.status >= 500 || error.code === "ALREADY_PROCESSED_PAYMENT")) {
      try { return await recoverConfirming(confirming); }
      catch { throw new Error("PAYMENT_PROCESSING"); }
    }
    if (!(error instanceof TossApiError)) throw error;
    await getD1().prepare("UPDATE reservations SET status = 'cancelled', payment_status = 'failed', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = '결제 승인 실패', payment_failure_code = ?, payment_failure_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = 'confirming'")
      .bind(error.code, error.message.slice(0, 240), row.id).run();
    throw error;
  }
}

export async function getPaymentResult(state: string, orderId: string) {
  let row = await rowByState(state);
  if (!row || row.payment_order_id !== orderId) throw new Error("PAYMENT_RESULT_NOT_FOUND");
  if (["confirming", "review_required"].includes(row.payment_status)) row = await recoverConfirming(row);
  if (["failed", "expired", "refunded"].includes(row.payment_status) || row.status === "cancelled") throw new Error("PAYMENT_NOT_COMPLETED");
  if (row.payment_status === "ready") throw new Error("PAYMENT_RESULT_NOT_READY");
  if (row.payment_status !== "paid") throw new Error("PAYMENT_PROCESSING");
  if (!row.payment_result_expires_at || row.payment_result_expires_at < Date.now()) throw new Error("PAYMENT_RESULT_EXPIRED");
  return paymentSummary(row);
}

export async function reconcileReservationPayment(id: string) {
  const row = await rowById(id);
  if (!row) throw new Error("RESERVATION_NOT_FOUND");
  if (row.payment_status === "paid") return row;
  if (["confirming", "review_required"].includes(row.payment_status)) return recoverConfirming(row);
  if (row.payment_status === "refund_processing") {
    const refunded = await refundReservationPayment(id, "관리자 환불 상태 재확인");
    if (!refunded) throw new Error("PAYMENT_REFUND_UNAVAILABLE");
    return refunded;
  }
  if (["failed", "expired", "refunded"].includes(row.payment_status) || row.status === "cancelled") throw new Error("PAYMENT_NOT_COMPLETED");
  throw new Error("PAYMENT_PROCESSING");
}

async function finalizeRefund(row: PaymentReservationRow, payment: TossPayment, reason: string) {
  if (payment.paymentKey !== row.payment_key || payment.orderId !== row.payment_order_id || Number(payment.totalAmount) !== row.price_total) {
    throw new Error("PAYMENT_REFUND_VERIFICATION_FAILED");
  }
  const db = getD1();
  const refundedAt = payment.cancels?.at(-1)?.canceledAt || new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO reservation_events (reservation_id, event_type, actor_type, actor_id, payload_json) SELECT id, 'payment_refunded', 'payment', '', ? FROM reservations WHERE id = ? AND payment_status = 'refund_processing'")
      .bind(JSON.stringify({ orderId: row.payment_order_id, reason }), row.id),
    db.prepare("INSERT OR IGNORE INTO owner_alerts (reservation_id, type, booking_code, theme_name, service_date, start_minute, party_size, amount, status, payment_status, customer_name_enc, phone_enc) SELECT id, 'reservation.cancelled', booking_code, theme_name_snapshot, service_date, start_minute, party_size, price_total, 'cancelled', 'refunded', customer_name_enc, phone_enc FROM reservations WHERE id = ? AND payment_status = 'refund_processing'")
      .bind(row.id),
    db.prepare("UPDATE reservations SET status = 'cancelled', payment_status = 'refunded', refunded_at = ?, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = 'refund_processing'")
      .bind(refundedAt, reason, row.id),
  ]);
  const finalized = await rowById(row.id);
  if (!finalized || finalized.status !== "cancelled" || finalized.payment_status !== "refunded") {
    throw new Error("PAYMENT_REFUND_FINALIZATION_PENDING");
  }
  return finalized;
}

export async function refundReservationPayment(id: string, reason: string) {
  let row = await rowById(id);
  if (!row) throw new Error("RESERVATION_NOT_FOUND");
  if (row.payment_status === "refunded" && row.status === "cancelled") return row;
  if (row.payment_status === "manual") return null;
  if (!row.payment_key || !row.payment_order_id) throw new Error("PAYMENT_REFUND_UNAVAILABLE");
  if (row.payment_status === "paid") {
    const claimed = await getD1().prepare("UPDATE reservations SET payment_status = 'refund_processing', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'confirmed' AND payment_status = 'paid'").bind(id).run();
    if (!claimed.meta.changes) throw new Error("PAYMENT_STATE_CHANGED");
    row = { ...row, payment_status: "refund_processing" };
  } else if (row.payment_status !== "refund_processing") {
    throw new Error("PAYMENT_REFUND_UNAVAILABLE");
  }

  try {
    const payment = await cancelTossPayment(row.payment_key, reason, `cancel-${row.payment_order_id}`);
    const canceledTotal = (payment.cancels || []).reduce((sum, cancel) => sum + Number(cancel.cancelAmount || 0), 0);
    if (payment.status !== "CANCELED" || (payment.balanceAmount !== undefined && Number(payment.balanceAmount) !== 0) || canceledTotal < row.price_total) {
      throw new Error("PAYMENT_REFUND_NOT_COMPLETED");
    }
    return await finalizeRefund(row, payment, reason);
  } catch (error) {
    if (error instanceof TossApiError) {
      try {
        const authoritative = await getTossPayment(row.payment_order_id);
        const canceledTotal = (authoritative.cancels || []).reduce((sum, cancel) => sum + Number(cancel.cancelAmount || 0), 0);
        if (authoritative.status === "CANCELED" && (authoritative.balanceAmount === undefined || Number(authoritative.balanceAmount) === 0) && canceledTotal >= row.price_total) {
          return await finalizeRefund(row, authoritative, reason);
        }
        if (authoritative.status === "DONE" && Number(authoritative.totalAmount) === row.price_total && Number(authoritative.balanceAmount ?? row.price_total) === row.price_total) {
          await getD1().prepare("UPDATE reservations SET payment_status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = 'refund_processing'").bind(id).run();
        }
      } catch {
        // Keep refund_processing locked until an authoritative retry can decide the outcome.
      }
    }
    throw error;
  }
}

export async function releaseReviewedUnpaidReservation(id: string, actorId: string) {
  const row = await rowById(id);
  if (!row) throw new Error("RESERVATION_NOT_FOUND");
  if (row.payment_status !== "review_required" || !row.payment_order_id) throw new Error("PAYMENT_REVIEW_REQUIRED");
  let providerStatus = "NOT_FOUND";
  try {
    const payment = await getTossPayment(row.payment_order_id);
    providerStatus = payment.status;
    if (payment.status === "DONE") return finalizePaid(row, payment);
    if (!["CANCELED", "ABORTED", "EXPIRED", "READY", "IN_PROGRESS"].includes(payment.status)) throw new Error("PAYMENT_PROCESSING");
    if (["READY", "IN_PROGRESS"].includes(payment.status) && Number(row.payment_expires_at || 0) + 30 * 60_000 > Date.now()) throw new Error("PAYMENT_PROCESSING");
  } catch (error) {
    if (!(error instanceof TossApiError) || error.status !== 404) throw error;
  }
  const db = getD1();
  await db.batch([
    db.prepare("INSERT INTO reservation_events (reservation_id, event_type, actor_type, actor_id, payload_json) SELECT id, 'payment_review_released', 'admin', ?, ? FROM reservations WHERE id = ? AND payment_status = 'review_required'")
      .bind(actorId, JSON.stringify({ providerStatus }), id),
    db.prepare("UPDATE reservations SET status = 'cancelled', payment_status = 'failed', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = '관리자 미결제 확인 후 해제', payment_failure_code = 'REVIEW_RELEASED', payment_failure_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = 'review_required'")
      .bind(`provider:${providerStatus}`.slice(0, 240), id),
  ]);
  const released = await rowById(id);
  if (!released || released.status !== "cancelled" || released.payment_status !== "failed") throw new Error("PAYMENT_STATE_CHANGED");
  return released;
}

export function paymentServiceStatus() {
  try {
    const config = tossConfig();
    return { configured: true, mode: config.mode };
  } catch {
    return { configured: false, mode: "unavailable" };
  }
}

export function paymentUnavailableResponse() {
  return json({ ok: false, error: { code: "PAYMENT_UNAVAILABLE", message: "현재 카드결제를 이용할 수 없습니다. 잠시 후 다시 시도해 주세요." } }, 503);
}

export function isTransientPaymentError(error: unknown) {
  return error instanceof TossApiError ? error.status >= 500 : true;
}

export function ownerAlertId() {
  return createId("alert");
}
