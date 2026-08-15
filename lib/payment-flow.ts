import {
  createId,
  encryptPrivate,
  getD1,
  getSettings,
  json,
  kstDateKey,
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
import type { BookingSettingsRecord } from "@/lib/models";
import { legalRetentionUntil, merchantComplianceMissing, safeTossReceiptUrl } from "@/lib/store-policy";

export const PAYMENT_HOLD_MS = 40 * 60_000;
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
  receipt_url: string;
  payment_provider_checked_at: number;
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
    receiptUrl: safeTossReceiptUrl(row.receipt_url),
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
    "SELECT id, booking_code, request_id, request_fingerprint, slot_id, theme_name_snapshot, service_date, start_minute, duration_min, party_size, price_total, status, payment_status, payment_order_id, payment_state, payment_key, payment_expires_at, payment_result_expires_at, paid_amount, receipt_url, payment_provider_checked_at FROM reservations WHERE payment_state = ? LIMIT 1",
  ).bind(state).first<PaymentReservationRow>();
}

async function rowById(id: string) {
  return getD1().prepare(
    "SELECT id, booking_code, request_id, request_fingerprint, slot_id, theme_name_snapshot, service_date, start_minute, duration_min, party_size, price_total, status, payment_status, payment_order_id, payment_state, payment_key, payment_expires_at, payment_result_expires_at, paid_amount, receipt_url, payment_provider_checked_at FROM reservations WHERE id = ? LIMIT 1",
  ).bind(id).first<PaymentReservationRow>();
}

async function rowByOrderId(orderId: string) {
  return getD1().prepare(
    "SELECT id, booking_code, request_id, request_fingerprint, slot_id, theme_name_snapshot, service_date, start_minute, duration_min, party_size, price_total, status, payment_status, payment_order_id, payment_state, payment_key, payment_expires_at, payment_result_expires_at, paid_amount, receipt_url, payment_provider_checked_at FROM reservations WHERE payment_order_id = ? LIMIT 1",
  ).bind(orderId).first<PaymentReservationRow>();
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

function validateProviderIdentity(row: PaymentReservationRow, payment: TossPayment) {
  if (
    payment.orderId !== row.payment_order_id ||
    Number(payment.totalAmount) !== row.price_total ||
    (row.payment_key !== null && row.payment_key !== payment.paymentKey)
  ) {
    throw new Error("PAYMENT_VERIFICATION_FAILED");
  }
}

function fullCancellation(payment: TossPayment, expectedAmount: number) {
  const canceledTotal = (payment.cancels || []).reduce((sum, cancel) => sum + Number(cancel.cancelAmount || 0), 0);
  return payment.status === "CANCELED" &&
    (payment.balanceAmount === undefined || Number(payment.balanceAmount) === 0) &&
    canceledTotal >= expectedAmount;
}

async function finalizePaid(row: PaymentReservationRow, payment: TossPayment) {
  validateTossResult(row, payment);
  const db = getD1();
  const receiptUrl = safeTossReceiptUrl(payment.receipt?.url);
  const paidAt = payment.approvedAt && Number.isFinite(Date.parse(payment.approvedAt)) ? payment.approvedAt : new Date().toISOString();
  const settings = await getSettings(db);
  const retentionUntil = legalRetentionUntil(paidAt, settings.legalRecordRetentionMonths);
  await db.batch([
    db.prepare("INSERT INTO reservation_events (reservation_id, event_type, actor_type, actor_id, payload_json) SELECT id, 'payment_confirmed', 'payment', '', ? FROM reservations WHERE id = ? AND payment_status IN ('confirming','review_required')")
      .bind(JSON.stringify({ orderId: payment.orderId, amount: payment.totalAmount, method: payment.method || "카드" }), row.id),
    db.prepare("INSERT OR IGNORE INTO owner_alerts (reservation_id, type, booking_code, theme_name, service_date, start_minute, party_size, amount, status, payment_status, customer_name_enc, phone_enc) SELECT id, 'reservation.confirmed', booking_code, theme_name_snapshot, service_date, start_minute, party_size, price_total, 'confirmed', 'paid', customer_name_enc, phone_enc FROM reservations WHERE id = ? AND payment_status IN ('confirming','review_required')")
      .bind(row.id),
    db.prepare("INSERT OR IGNORE INTO legal_transaction_records (reservation_id, booking_code, customer_name_enc, phone_enc, payment_order_id, theme_name, service_date, start_minute, party_size, amount, paid_at, retention_until) SELECT id, booking_code, customer_name_enc, phone_enc, payment_order_id, theme_name_snapshot, service_date, start_minute, party_size, ?, ?, ? FROM reservations WHERE id = ? AND payment_status IN ('confirming','review_required')")
      .bind(payment.totalAmount, paidAt, retentionUntil, row.id),
    db.prepare("UPDATE reservations SET status = 'confirmed', payment_status = 'paid', payment_key = ?, payment_method = ?, paid_amount = ?, paid_at = ?, receipt_url = ?, payment_result_expires_at = ?, payment_provider_checked_at = ?, payment_failure_code = '', payment_failure_message = '', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status IN ('confirming','review_required')")
      .bind(payment.paymentKey, payment.method || "카드", payment.totalAmount, paidAt, receiptUrl, Date.now() + PAYMENT_RESULT_MS, Date.now(), row.id),
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
    "SELECT id, booking_code, request_id, request_fingerprint, slot_id, theme_name_snapshot, service_date, start_minute, duration_min, party_size, price_total, status, payment_status, payment_order_id, payment_state, payment_key, payment_expires_at, payment_result_expires_at, paid_amount, receipt_url, payment_provider_checked_at, updated_at FROM reservations WHERE status = 'confirmed' AND payment_status IN ('confirming','review_required') AND payment_expires_at IS NOT NULL AND payment_expires_at <= ? AND ((payment_status = 'confirming' AND updated_at <= datetime('now', '-2 minutes')) OR (payment_status = 'review_required' AND updated_at <= datetime('now', '-30 minutes'))) ORDER BY payment_expires_at LIMIT ?",
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

async function ensureLegalTransactionRecord(row: PaymentReservationRow, payment: TossPayment) {
  validateProviderIdentity(row, payment);
  const db = getD1();
  const settings = await getSettings(db);
  const paidAt = payment.approvedAt && Number.isFinite(Date.parse(payment.approvedAt)) ? payment.approvedAt : new Date().toISOString();
  const receiptUrl = safeTossReceiptUrl(payment.receipt?.url);
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO legal_transaction_records (reservation_id, booking_code, customer_name_enc, phone_enc, payment_order_id, theme_name, service_date, start_minute, party_size, amount, paid_at, retention_until) SELECT id, booking_code, customer_name_enc, phone_enc, payment_order_id, theme_name_snapshot, service_date, start_minute, party_size, ?, ?, ? FROM reservations WHERE id = ?")
      .bind(payment.totalAmount, paidAt, legalRetentionUntil(paidAt, settings.legalRecordRetentionMonths), row.id),
    db.prepare("UPDATE reservations SET receipt_url = CASE WHEN ? <> '' THEN ? ELSE receipt_url END, payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(receiptUrl, receiptUrl, Date.now(), row.id),
  ]);
}

async function markPaymentReview(row: PaymentReservationRow, payment: TossPayment, code: string, source: string) {
  validateProviderIdentity(row, payment);
  const db = getD1();
  const message = `토스 결제 상태 확인 필요 (${payment.status})`.slice(0, 240);
  await db.batch([
    db.prepare("INSERT INTO reservation_events (reservation_id, event_type, actor_type, actor_id, payload_json) SELECT id, 'payment_review_required', 'payment', ?, ? FROM reservations WHERE id = ? AND (payment_status <> 'review_required' OR payment_failure_code <> ?)")
      .bind(source.slice(0, 80), JSON.stringify({ orderId: payment.orderId, providerStatus: payment.status, code }), row.id, code),
    db.prepare("INSERT OR IGNORE INTO owner_alerts (reservation_id, type, booking_code, theme_name, service_date, start_minute, party_size, amount, status, payment_status, customer_name_enc, phone_enc) SELECT id, 'payment.review_required', booking_code, theme_name_snapshot, service_date, start_minute, party_size, price_total, status, 'review_required', customer_name_enc, phone_enc FROM reservations WHERE id = ?")
      .bind(row.id),
    db.prepare("UPDATE reservations SET payment_status = 'review_required', payment_key = COALESCE(payment_key, ?), payment_failure_code = ?, payment_failure_message = ?, payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(payment.paymentKey, code.slice(0, 80), message, Date.now(), row.id),
  ]);
  const latest = await rowById(row.id);
  if (!latest) throw new Error("RESERVATION_NOT_FOUND");
  return latest;
}

async function applyAuthoritativePayment(row: PaymentReservationRow, payment: TossPayment, source: string) {
  validateProviderIdentity(row, payment);
  const db = getD1();

  if (payment.status === "DONE") {
    if (row.payment_status === "paid") {
      if (row.paid_amount !== payment.totalAmount || row.status === "cancelled") {
        return markPaymentReview(row, payment, "PAID_STATE_MISMATCH", source);
      }
      await ensureLegalTransactionRecord(row, payment);
      const latest = await rowById(row.id);
      if (!latest) throw new Error("RESERVATION_NOT_FOUND");
      return latest;
    }
    if (row.status === "confirmed" && ["ready", "confirming", "review_required"].includes(row.payment_status)) {
      await db.prepare("UPDATE reservations SET payment_status = 'confirming', payment_key = ?, payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'confirmed' AND payment_status IN ('ready','confirming','review_required') AND (payment_key IS NULL OR payment_key = ?)")
        .bind(payment.paymentKey, Date.now(), row.id, payment.paymentKey).run();
      const confirming = await rowById(row.id);
      if (!confirming) throw new Error("RESERVATION_NOT_FOUND");
      if (confirming.payment_status === "paid") return confirming;
      if (confirming.payment_status !== "confirming") throw new Error("PAYMENT_STATE_CHANGED");
      return finalizePaid(confirming, payment);
    }
    if (row.payment_status === "refund_processing") {
      const refunded = await refundReservationPayment(row.id, "환불 상태 자동 재확인");
      if (!refunded) throw new Error("PAYMENT_REFUND_UNAVAILABLE");
      return refunded;
    }
    if (row.payment_status === "refunded") {
      return markPaymentReview(row, payment, "REFUND_PROVIDER_MISMATCH", source);
    }

    await ensureLegalTransactionRecord(row, payment);
    const claimed = await db.prepare("UPDATE reservations SET payment_status = 'refund_processing', payment_key = ?, payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status IN ('failed','expired','ready')")
      .bind(payment.paymentKey, Date.now(), row.id).run();
    if (!claimed.meta.changes) return markPaymentReview(row, payment, "ORPHAN_PAYMENT_REVIEW", source);
    const orphan = await rowById(row.id);
    if (!orphan) throw new Error("RESERVATION_NOT_FOUND");
    const refunded = await refundReservationPayment(orphan.id, "예약 미확정 결제 자동 환불");
    if (!refunded) throw new Error("PAYMENT_REFUND_UNAVAILABLE");
    return refunded;
  }

  if (fullCancellation(payment, row.price_total)) {
    if (row.payment_status === "refunded" && row.status === "cancelled") return row;
    await ensureLegalTransactionRecord(row, payment);
    await db.prepare("UPDATE reservations SET payment_status = 'refund_processing', payment_key = COALESCE(payment_key, ?), payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status <> 'refunded'")
      .bind(payment.paymentKey, Date.now(), row.id).run();
    const refunding = await rowById(row.id);
    if (!refunding) throw new Error("RESERVATION_NOT_FOUND");
    if (refunding.payment_status === "refunded") return refunding;
    if (refunding.payment_status !== "refund_processing") throw new Error("PAYMENT_STATE_CHANGED");
    return finalizeRefund(refunding, payment, source === "webhook" ? "토스 결제 취소 동기화" : "결제 취소 상태 동기화");
  }

  if (payment.status === "PARTIAL_CANCELED" || payment.status === "CANCELED") {
    return markPaymentReview(row, payment, "PARTIAL_REFUND_REVIEW", source);
  }
  if (["ABORTED", "EXPIRED"].includes(payment.status) && row.payment_status !== "paid") {
    await db.prepare("UPDATE reservations SET status = 'cancelled', payment_status = 'failed', payment_key = COALESCE(payment_key, ?), cancelled_at = COALESCE(cancelled_at, CURRENT_TIMESTAMP), cancel_reason = '결제 미완료', payment_failure_code = ?, payment_failure_message = ?, payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status NOT IN ('paid','refunded')")
      .bind(payment.paymentKey, `PROVIDER_${payment.status}`.slice(0, 80), "결제가 완료되지 않았습니다.", Date.now(), row.id).run();
    const latest = await rowById(row.id);
    if (!latest) throw new Error("RESERVATION_NOT_FOUND");
    return latest;
  }
  if (["READY", "IN_PROGRESS", "WAITING_FOR_DEPOSIT"].includes(payment.status) && ["ready", "confirming"].includes(row.payment_status)) {
    await db.prepare("UPDATE reservations SET payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(Date.now(), row.id).run();
    const latest = await rowById(row.id);
    if (!latest) throw new Error("RESERVATION_NOT_FOUND");
    return latest;
  }
  return markPaymentReview(row, payment, "PROVIDER_STATUS_REVIEW", source);
}

export async function syncTossPaymentByOrderId(orderId: string, source = "reconcile") {
  const row = await rowByOrderId(orderId);
  if (!row) return null;
  const payment = await getTossPayment(orderId);
  return applyAuthoritativePayment(row, payment, source);
}

export async function reconcileRecentProviderPayments(now = Date.now(), limit = 10) {
  const db = getD1();
  const paidBefore = now - 15 * 60_000;
  const urgentBefore = now - 60_000;
  const failedBefore = now - 60 * 60_000;
  const recent = await db.prepare(
    "SELECT id, payment_order_id, payment_provider_checked_at FROM reservations WHERE payment_order_id IS NOT NULL AND created_at >= datetime('now', '-180 days') AND ((payment_status = 'paid' AND payment_provider_checked_at <= ?) OR (payment_status IN ('confirming','review_required','refund_processing') AND payment_provider_checked_at <= ?) OR (payment_status IN ('failed','expired') AND created_at >= datetime('now', '-2 days') AND payment_provider_checked_at <= ?)) ORDER BY payment_provider_checked_at, created_at LIMIT ?",
  ).bind(paidBefore, urgentBefore, failedBefore, Math.max(1, Math.min(25, limit))).all<{ id: string; payment_order_id: string; payment_provider_checked_at: number }>();
  await Promise.allSettled(recent.results.map(async (candidate) => {
    const claimed = await db.prepare("UPDATE reservations SET payment_provider_checked_at = ? WHERE id = ? AND payment_provider_checked_at = ?")
      .bind(now, candidate.id, Number(candidate.payment_provider_checked_at || 0)).run();
    if (!claimed.meta.changes) return;
    await syncTossPaymentByOrderId(candidate.payment_order_id, "scheduled");
  }));
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
  if (!row.payment_order_id) throw new Error("PAYMENT_NOT_COMPLETED");
  const reconciled = await syncTossPaymentByOrderId(row.payment_order_id, "admin");
  if (!reconciled) throw new Error("PAYMENT_NOT_COMPLETED");
  return reconciled;
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
    db.prepare("UPDATE legal_transaction_records SET refunded_at = ?, updated_at = CURRENT_TIMESTAMP WHERE reservation_id = ?")
      .bind(refundedAt, row.id),
    db.prepare("UPDATE reservations SET status = 'cancelled', payment_status = 'refunded', refunded_at = ?, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = ?, payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = 'refund_processing'")
      .bind(refundedAt, reason, Date.now(), row.id),
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
          if (row.status === "cancelled") {
            await getD1().prepare("UPDATE reservations SET payment_failure_code = 'AUTO_REFUND_RETRY', payment_failure_message = '미확정 결제 자동 환불 재시도 필요', payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = 'refund_processing'")
              .bind(Date.now(), id).run();
          } else {
            await getD1().prepare("UPDATE reservations SET payment_status = 'paid', payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = 'refund_processing'")
              .bind(Date.now(), id).run();
          }
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

export async function cleanupRetainedData(now = Date.now(), limit = 25) {
  const db = getD1();
  const settings = await getSettings(db);
  const operationalDays = Math.max(30, Math.min(365, settings.operationalPiiRetentionDays));
  const serviceCutoff = kstDateKey(now - operationalDays * 86_400_000);
  const cancelledCutoff = new Date(now - operationalDays * 86_400_000).toISOString().replace("T", " ").slice(0, 19);
  const candidates = await db.prepare(
    "SELECT id FROM reservations WHERE pii_purged_at IS NULL AND ((service_date < ?) OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_at < ?)) ORDER BY service_date, created_at LIMIT ?",
  ).bind(serviceCutoff, cancelledCutoff, Math.max(1, Math.min(100, limit))).all<{ id: string }>();
  const [purgedName, purgedPhone] = candidates.results.length
    ? await Promise.all([encryptPrivate("보유기간 만료"), encryptPrivate("보유기간 만료")])
    : ["", ""];

  for (const candidate of candidates.results) {
    await db.batch([
      db.prepare("DELETE FROM owner_push_deliveries WHERE alert_id IN (SELECT id FROM owner_alerts WHERE reservation_id = ?)").bind(candidate.id),
      db.prepare("DELETE FROM owner_alerts WHERE reservation_id = ?").bind(candidate.id),
      db.prepare("UPDATE reservation_events SET actor_id = CASE WHEN actor_type = 'customer' THEN '' ELSE actor_id END, payload_json = '{}' WHERE reservation_id = ?").bind(candidate.id),
      db.prepare("DELETE FROM admin_audit_logs WHERE entity_type IN ('reservation','reservation_payment') AND entity_id = ?").bind(candidate.id),
      db.prepare("UPDATE reservations SET customer_name_enc = ?, phone_enc = ?, phone_hash = '', phone_last4 = '', request_fingerprint = '', admin_memo = '', pii_purged_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND pii_purged_at IS NULL")
        .bind(purgedName, purgedPhone, candidate.id),
    ]);
  }

  const webhookCutoff = new Date(now - 180 * 86_400_000).toISOString().replace("T", " ").slice(0, 19);
  const deliveryCutoff = new Date(now - 30 * 86_400_000).toISOString().replace("T", " ").slice(0, 19);
  await db.batch([
    db.prepare("DELETE FROM legal_transaction_records WHERE retention_until <= ?").bind(now),
    db.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(Math.floor(now / 1000) - 2 * 86_400),
    db.prepare("DELETE FROM payment_webhook_events WHERE status IN ('processed','ignored') AND created_at < ?").bind(webhookCutoff),
    db.prepare("DELETE FROM owner_push_deliveries WHERE status IN ('sent','dead') AND updated_at < ?").bind(deliveryCutoff),
  ]);
  return { operationalPiiPurged: candidates.results.length };
}

export function paymentServiceStatus(settings?: BookingSettingsRecord) {
  try {
    const config = tossConfig();
    const publicTestEnabled = runtimeEnv().ALLOW_PUBLIC_TEST_PAYMENTS === "1";
    const missing = settings ? merchantComplianceMissing(settings) : [];
    const complianceReady = missing.length === 0;
    const enabled = config.mode === "live" ? complianceReady : publicTestEnabled;
    return { configured: enabled, mode: config.mode, complianceReady };
  } catch {
    return { configured: false, mode: "unavailable", complianceReady: false };
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
