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
import {
  cancelNaverPayment,
  confirmNaverPayment,
  getNaverPayment,
  isAmbiguousNaverPayError,
  isTransientNaverPayError,
  activeNaverPayConfig,
  listNaverPaymentIds,
  naverPayConfig,
  NaverPayApiError,
  type NaverPayment,
} from "@/lib/naver-payments";
import type { BookingSettingsRecord } from "@/lib/models";
import { legalRetentionUntil, merchantComplianceMissing, safePaymentReceiptUrl } from "@/lib/store-policy";

export const PAYMENT_HOLD_MS = 30 * 60_000;
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
  payment_provider: "toss" | "naverpay";
  payment_tax_scope_amount: number;
  payment_tax_ex_scope_amount: number;
  payment_refund_requester: "1" | "2";
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

type ProviderPayment = TossPayment | NaverPayment;

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
    receiptUrl: safePaymentReceiptUrl(row.receipt_url),
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
    "SELECT id, booking_code, request_id, request_fingerprint, slot_id, theme_name_snapshot, service_date, start_minute, duration_min, party_size, price_total, status, payment_status, payment_provider, payment_tax_scope_amount, payment_tax_ex_scope_amount, payment_refund_requester, payment_order_id, payment_state, payment_key, payment_expires_at, payment_result_expires_at, paid_amount, receipt_url, payment_provider_checked_at FROM reservations WHERE payment_state = ? LIMIT 1",
  ).bind(state).first<PaymentReservationRow>();
}

async function rowById(id: string) {
  return getD1().prepare(
    "SELECT id, booking_code, request_id, request_fingerprint, slot_id, theme_name_snapshot, service_date, start_minute, duration_min, party_size, price_total, status, payment_status, payment_provider, payment_tax_scope_amount, payment_tax_ex_scope_amount, payment_refund_requester, payment_order_id, payment_state, payment_key, payment_expires_at, payment_result_expires_at, paid_amount, receipt_url, payment_provider_checked_at FROM reservations WHERE id = ? LIMIT 1",
  ).bind(id).first<PaymentReservationRow>();
}

async function rowByOrderId(orderId: string) {
  return getD1().prepare(
    "SELECT id, booking_code, request_id, request_fingerprint, slot_id, theme_name_snapshot, service_date, start_minute, duration_min, party_size, price_total, status, payment_status, payment_provider, payment_tax_scope_amount, payment_tax_ex_scope_amount, payment_refund_requester, payment_order_id, payment_state, payment_key, payment_expires_at, payment_result_expires_at, paid_amount, receipt_url, payment_provider_checked_at FROM reservations WHERE payment_order_id = ? LIMIT 1",
  ).bind(orderId).first<PaymentReservationRow>();
}

async function rowByPaymentKey(paymentKey: string) {
  return getD1().prepare(
    "SELECT id, booking_code, request_id, request_fingerprint, slot_id, theme_name_snapshot, service_date, start_minute, duration_min, party_size, price_total, status, payment_status, payment_provider, payment_tax_scope_amount, payment_tax_ex_scope_amount, payment_refund_requester, payment_order_id, payment_state, payment_key, payment_expires_at, payment_result_expires_at, paid_amount, receipt_url, payment_provider_checked_at FROM reservations WHERE payment_key = ? LIMIT 1",
  ).bind(paymentKey).first<PaymentReservationRow>();
}

function providerName(row: PaymentReservationRow) {
  return row.payment_provider === "naverpay" ? "네이버페이" : "토스페이먼츠";
}

function providerErrorCode(error: unknown) {
  if (error instanceof TossApiError || error instanceof NaverPayApiError) return error.code;
  return "PAYMENT_PROVIDER_ERROR";
}

function providerErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "결제를 처리하지 못했습니다.";
}

function providerNotFound(error: unknown) {
  return error instanceof TossApiError
    ? error.status === 404
    : error instanceof NaverPayApiError && (error.status === 404 || error.code === "InvalidPaymentId" || error.code === "NAVER_PAY_HISTORY_NOT_FOUND");
}

function providerTransient(error: unknown) {
  return error instanceof TossApiError
    ? error.status >= 500 || error.code === "ALREADY_PROCESSED_PAYMENT"
    : isTransientNaverPayError(error);
}

async function getProviderPayment(row: PaymentReservationRow) {
  if (row.payment_provider === "naverpay") {
    if (!row.payment_key) throw new Error("PAYMENT_RECOVERY_UNAVAILABLE");
    return getNaverPayment(row.payment_key);
  }
  if (!row.payment_order_id) throw new Error("PAYMENT_RECOVERY_UNAVAILABLE");
  return getTossPayment(row.payment_order_id);
}

async function confirmProviderPayment(row: PaymentReservationRow, paymentKey: string) {
  if (!row.payment_order_id) throw new Error("PAYMENT_RECOVERY_UNAVAILABLE");
  return row.payment_provider === "naverpay"
    ? confirmNaverPayment(paymentKey, `confirm-${paymentKey}`)
    : confirmTossPayment(paymentKey, row.payment_order_id, row.price_total, `confirm-${row.payment_order_id}`);
}

async function cancelProviderPayment(row: PaymentReservationRow, reason: string) {
  if (!row.payment_key || !row.payment_order_id) throw new Error("PAYMENT_REFUND_UNAVAILABLE");
  return row.payment_provider === "naverpay"
    ? cancelNaverPayment(row.payment_key, row.payment_order_id, row.price_total, row.payment_tax_scope_amount, row.payment_tax_ex_scope_amount, "예약 취소", row.payment_refund_requester, `cancel-${row.payment_order_id}`)
    : cancelTossPayment(row.payment_key, reason, `cancel-${row.payment_order_id}`);
}

function validateProviderResult(row: PaymentReservationRow, payment: ProviderPayment) {
  if (
    payment.orderId !== row.payment_order_id ||
    payment.paymentKey !== row.payment_key ||
    Number(payment.totalAmount) !== row.price_total ||
    payment.status !== "DONE"
  ) {
    throw new Error("PAYMENT_VERIFICATION_FAILED");
  }
  if (row.payment_provider === "naverpay" && (
    !("taxScopeAmount" in payment) ||
    payment.taxScopeAmount !== row.payment_tax_scope_amount ||
    payment.taxExScopeAmount !== row.payment_tax_ex_scope_amount
  )) throw new Error("PAYMENT_VERIFICATION_FAILED");
}

function validateProviderIdentity(row: PaymentReservationRow, payment: ProviderPayment) {
  if (
    payment.orderId !== row.payment_order_id ||
    Number(payment.totalAmount) !== row.price_total ||
    (row.payment_key !== null && row.payment_key !== payment.paymentKey)
  ) {
    throw new Error("PAYMENT_VERIFICATION_FAILED");
  }
  if (row.payment_provider === "naverpay" && "taxScopeAmount" in payment && (
    payment.taxScopeAmount !== row.payment_tax_scope_amount ||
    payment.taxExScopeAmount !== row.payment_tax_ex_scope_amount
  )) throw new Error("PAYMENT_VERIFICATION_FAILED");
}

function fullCancellation(row: PaymentReservationRow, payment: ProviderPayment) {
  const canceledTotal = (payment.cancels || []).reduce((sum, cancel) => sum + Number(cancel.cancelAmount || 0), 0);
  if (row.payment_provider === "naverpay") {
    const cancels = payment.cancels as NaverPayment["cancels"];
    const canceledTaxScope = cancels.reduce((sum, cancel) => sum + Number(cancel.taxScopeAmount), 0);
    const canceledTaxExScope = cancels.reduce((sum, cancel) => sum + Number(cancel.taxExScopeAmount), 0);
    if (canceledTaxScope !== row.payment_tax_scope_amount || canceledTaxExScope !== row.payment_tax_ex_scope_amount) return false;
  }
  return payment.status === "CANCELED" &&
    (payment.balanceAmount === undefined || Number(payment.balanceAmount) === 0) &&
    canceledTotal === row.price_total;
}

async function finalizePaid(row: PaymentReservationRow, payment: ProviderPayment) {
  validateProviderResult(row, payment);
  const db = getD1();
  const receiptUrl = safePaymentReceiptUrl(payment.receipt?.url);
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
  const confirmingBefore = new Date(now - 3 * 60_000).toISOString().replace("T", " ").slice(0, 19);
  const reviewBefore = new Date(now - 30 * 60_000).toISOString().replace("T", " ").slice(0, 19);
  const stale = await db.prepare(
    "SELECT id, booking_code, request_id, request_fingerprint, slot_id, theme_name_snapshot, service_date, start_minute, duration_min, party_size, price_total, status, payment_status, payment_provider, payment_tax_scope_amount, payment_tax_ex_scope_amount, payment_refund_requester, payment_order_id, payment_state, payment_key, payment_expires_at, payment_result_expires_at, paid_amount, receipt_url, payment_provider_checked_at, updated_at FROM reservations WHERE status = 'confirmed' AND payment_status IN ('confirming','review_required') AND ((payment_status = 'confirming' AND updated_at <= ?) OR (payment_status = 'review_required' AND updated_at <= ?)) ORDER BY updated_at LIMIT ?",
  ).bind(confirmingBefore, reviewBefore, Math.max(1, Math.min(3, limit))).all<PaymentReservationRow>();
  await Promise.allSettled(stale.results.map(async (row) => {
    if (!row.payment_order_id || !row.payment_key) return;
    const claimed = await db.prepare("UPDATE reservations SET updated_at = CURRENT_TIMESTAMP, payment_provider_checked_at = ? WHERE id = ? AND payment_status IN ('confirming','review_required') AND updated_at = ? AND payment_provider_checked_at = ?")
      .bind(now, row.id, row.updated_at || "", Number(row.payment_provider_checked_at || 0)).run();
    if (!claimed.meta.changes) return;
    await recoverConfirming(row);
  }));
}

async function recoverConfirming(row: PaymentReservationRow) {
  if (!row.payment_order_id || !row.payment_key) throw new Error("PAYMENT_RECOVERY_UNAVAILABLE");
  if (row.payment_provider === "naverpay" && row.payment_provider_checked_at > Date.now() - 180_000) {
    throw new Error("PAYMENT_PROCESSING");
  }
  let payment: ProviderPayment;
  if (row.payment_provider === "naverpay") {
    try {
      payment = await getNaverPayment(row.payment_key);
    } catch (error) {
      if (!providerNotFound(error)) throw error;
      if (Number(row.payment_expires_at || 0) + 10 * 60_000 <= Date.now()) {
        await getD1().prepare("UPDATE reservations SET payment_status = 'review_required', payment_failure_code = 'PAYMENT_LOOKUP_NOT_FOUND', payment_failure_message = '네이버페이 결제 내역 확인 필요', payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status IN ('confirming','review_required')")
          .bind(Date.now(), row.id).run();
      }
      throw new Error("PAYMENT_PROCESSING");
    }
    if (payment.orderId !== row.payment_order_id) {
      await routeMismatchedNaverPayment(row, payment as NaverPayment, "history_relink");
      throw new Error("PAYMENT_INFORMATION_MISMATCH");
    }
  } else {
    try {
      payment = await getTossPayment(row.payment_order_id);
    } catch (error) {
      if (!(error instanceof TossApiError) || error.status !== 404) throw error;
      if (Number(row.payment_expires_at || 0) + 30 * 60_000 <= Date.now()) {
        await getD1().prepare("UPDATE reservations SET payment_status = 'review_required', payment_failure_code = 'PAYMENT_LOOKUP_NOT_FOUND', payment_failure_message = '토스페이먼츠 결제 내역 확인 필요', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status IN ('confirming','review_required')").bind(row.id).run();
        throw new Error("PAYMENT_PROCESSING");
      }
      try {
        payment = await confirmTossPayment(row.payment_key, row.payment_order_id, row.price_total, `confirm-${row.payment_order_id}`);
      } catch {
        throw new Error("PAYMENT_PROCESSING");
      }
    }
  }
  if (payment.status === "DONE") {
    if (row.payment_provider === "naverpay") {
      const reviewed = await applyNaverPaymentSafely(payment as NaverPayment, "confirming_recovery", row);
      if (!reviewed) throw new Error("PAYMENT_PROCESSING");
      return reviewed;
    }
    return finalizePaid(row, payment);
  }
  if (["CANCELED", "ABORTED", "EXPIRED"].includes(payment.status)) {
    await getD1().prepare("UPDATE reservations SET status = 'cancelled', payment_status = 'failed', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = '결제 미완료', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status IN ('confirming','review_required')").bind(row.id).run();
    throw new Error("PAYMENT_NOT_COMPLETED");
  }
  if (row.payment_provider === "toss" && ["READY", "IN_PROGRESS"].includes(payment.status) && Number(row.payment_expires_at || 0) + 20 * 60_000 > Date.now()) {
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
  if (row.payment_provider === "toss" && ["READY", "IN_PROGRESS"].includes(payment.status) && Number(row.payment_expires_at || 0) + 30 * 60_000 <= Date.now()) {
    await getD1().prepare("UPDATE reservations SET status = 'cancelled', payment_status = 'failed', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = '결제 승인 시간 만료', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status IN ('confirming','review_required')").bind(row.id).run();
    throw new Error("PAYMENT_NOT_COMPLETED");
  }
  throw new Error("PAYMENT_PROCESSING");
}

async function ensureLegalTransactionRecord(row: PaymentReservationRow, payment: ProviderPayment) {
  validateProviderIdentity(row, payment);
  const db = getD1();
  const settings = await getSettings(db);
  const paidAt = payment.approvedAt && Number.isFinite(Date.parse(payment.approvedAt)) ? payment.approvedAt : new Date().toISOString();
  const receiptUrl = safePaymentReceiptUrl(payment.receipt?.url);
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO legal_transaction_records (reservation_id, booking_code, customer_name_enc, phone_enc, payment_order_id, theme_name, service_date, start_minute, party_size, amount, paid_at, retention_until) SELECT id, booking_code, customer_name_enc, phone_enc, payment_order_id, theme_name_snapshot, service_date, start_minute, party_size, ?, ?, ? FROM reservations WHERE id = ?")
      .bind(payment.totalAmount, paidAt, legalRetentionUntil(paidAt, settings.legalRecordRetentionMonths), row.id),
    db.prepare("UPDATE reservations SET receipt_url = CASE WHEN ? <> '' THEN ? ELSE receipt_url END, payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(receiptUrl, receiptUrl, Date.now(), row.id),
  ]);
}

async function markPaymentReview(row: PaymentReservationRow, payment: ProviderPayment, code: string, source: string) {
  validateProviderIdentity(row, payment);
  const db = getD1();
  const message = `${providerName(row)} 결제 상태 확인 필요 (${payment.status})`.slice(0, 240);
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

async function markPaymentVerificationReview(row: PaymentReservationRow, payment: ProviderPayment, source: string) {
  const db = getD1();
  const code = "PAYMENT_VERIFICATION_FAILED";
  const message = `${providerName(row)} 결제 금액 또는 과세 정보 확인 필요`.slice(0, 240);
  await db.batch([
    db.prepare("INSERT INTO reservation_events (reservation_id, event_type, actor_type, actor_id, payload_json) SELECT id, 'payment_review_required', 'payment', ?, ? FROM reservations WHERE id = ? AND (payment_status <> 'review_required' OR payment_failure_code <> ?)")
      .bind(source.slice(0, 80), JSON.stringify({
        expectedOrderId: row.payment_order_id,
        providerOrderId: payment.orderId,
        expectedAmount: row.price_total,
        providerAmount: payment.totalAmount,
        expectedTaxScopeAmount: row.payment_tax_scope_amount,
        providerTaxScopeAmount: "taxScopeAmount" in payment ? payment.taxScopeAmount : null,
        expectedTaxExScopeAmount: row.payment_tax_ex_scope_amount,
        providerTaxExScopeAmount: "taxExScopeAmount" in payment ? payment.taxExScopeAmount : null,
        code,
      }), row.id, code),
    db.prepare("INSERT OR IGNORE INTO owner_alerts (reservation_id, type, booking_code, theme_name, service_date, start_minute, party_size, amount, status, payment_status, customer_name_enc, phone_enc) SELECT id, 'payment.review_required', booking_code, theme_name_snapshot, service_date, start_minute, party_size, price_total, status, 'review_required', customer_name_enc, phone_enc FROM reservations WHERE id = ?")
      .bind(row.id),
    db.prepare("UPDATE reservations SET payment_status = 'review_required', payment_key = COALESCE(payment_key, ?), payment_failure_code = ?, payment_failure_message = ?, payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(payment.paymentKey, code, message, Date.now(), row.id),
  ]);
  const latest = await rowById(row.id);
  if (!latest) throw new Error("RESERVATION_NOT_FOUND");
  return latest;
}

async function applyAuthoritativePayment(row: PaymentReservationRow, payment: ProviderPayment, source: string) {
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

  if (fullCancellation(row, payment)) {
    if (row.payment_status === "refunded" && row.status === "cancelled") {
      const providerRefundedAt = payment.cancels?.at(-1)?.canceledAt;
      if (providerRefundedAt && Number.isFinite(Date.parse(providerRefundedAt))) {
        await db.batch([
          db.prepare("UPDATE legal_transaction_records SET refunded_at = ?, updated_at = CURRENT_TIMESTAMP WHERE reservation_id = ?").bind(providerRefundedAt, row.id),
          db.prepare("UPDATE reservations SET refunded_at = ?, payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = 'refunded'").bind(providerRefundedAt, Date.now(), row.id),
        ]);
        return (await rowById(row.id)) || row;
      }
      return row;
    }
    await ensureLegalTransactionRecord(row, payment);
    await db.prepare("UPDATE reservations SET payment_status = 'refund_processing', payment_key = COALESCE(payment_key, ?), payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status <> 'refunded'")
      .bind(payment.paymentKey, Date.now(), row.id).run();
    const refunding = await rowById(row.id);
    if (!refunding) throw new Error("RESERVATION_NOT_FOUND");
    if (refunding.payment_status === "refunded") return refunding;
    if (refunding.payment_status !== "refund_processing") throw new Error("PAYMENT_STATE_CHANGED");
    return finalizeRefund(refunding, payment, source === "webhook" ? "결제사 취소 동기화" : "결제 취소 상태 동기화");
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
  if (!row || row.payment_provider !== "toss") return null;
  const payment = await getTossPayment(orderId);
  return applyAuthoritativePayment(row, payment, source);
}

async function syncProviderPayment(row: PaymentReservationRow, source = "reconcile") {
  const payment = await getProviderPayment(row);
  if (row.payment_provider === "naverpay") return applyNaverPaymentSafely(payment as NaverPayment, source, row);
  return applyAuthoritativePayment(row, payment, source);
}

export async function reconcileRecentProviderPayments(now = Date.now(), limit = 10) {
  const db = getD1();
  const paidBefore = now - 15 * 60_000;
  const tossUrgentBefore = now - 60_000;
  const naverUrgentBefore = now - 180_000;
  const failedBefore = now - 60 * 60_000;
  const recent = await db.prepare(
    "SELECT id, payment_provider_checked_at FROM reservations WHERE payment_order_id IS NOT NULL AND (payment_provider = 'toss' OR payment_key IS NOT NULL) AND created_at >= datetime('now', '-180 days') AND ((payment_status = 'paid' AND payment_provider_checked_at <= ?) OR (payment_status IN ('confirming','review_required','refund_processing') AND ((payment_provider = 'toss' AND payment_provider_checked_at <= ?) OR (payment_provider = 'naverpay' AND payment_provider_checked_at <= ?))) OR (payment_status IN ('failed','expired') AND created_at >= datetime('now', '-2 days') AND payment_provider_checked_at <= ?)) ORDER BY payment_provider_checked_at, created_at LIMIT ?",
  ).bind(paidBefore, tossUrgentBefore, naverUrgentBefore, failedBefore, Math.max(1, Math.min(25, limit))).all<{ id: string; payment_provider_checked_at: number }>();
  await Promise.allSettled(recent.results.map(async (candidate) => {
    const claimed = await db.prepare("UPDATE reservations SET payment_provider_checked_at = ? WHERE id = ? AND payment_provider_checked_at = ?")
      .bind(now, candidate.id, Number(candidate.payment_provider_checked_at || 0)).run();
    if (!claimed.meta.changes) return;
    const row = await rowById(candidate.id);
    if (row) await syncProviderPayment(row, "scheduled");
  }));
}

async function refundOrAuditUnmatchedNaverPayment(payment: NaverPayment, source: string, kind: "orphan" | "duplicate" = "orphan") {
  const db = getD1();
  let outcome = payment.status === "CANCELED" ? "already_refunded" : "review_required";
  if (payment.status === "DONE") {
    try {
      await cancelNaverPayment(
        payment.paymentKey,
        payment.orderId,
        payment.totalAmount,
        payment.taxScopeAmount,
        payment.taxExScopeAmount,
        "예약 정보 없는 결제 자동 취소",
        "2",
        `orphan-${payment.paymentKey}`,
      );
      outcome = "refunded";
    } catch (error) {
      await db.prepare("INSERT INTO admin_audit_logs (admin_email, action, entity_type, entity_id, after_json) VALUES ('system', 'naver_payment_refund_pending', 'payment', ?, ?)")
        .bind(payment.paymentKey, JSON.stringify({
          orderId: payment.orderId,
          source,
          kind,
          status: payment.status,
          amount: payment.totalAmount,
          taxScopeAmount: payment.taxScopeAmount,
          taxExScopeAmount: payment.taxExScopeAmount,
          errorCode: providerErrorCode(error),
          errorMessage: providerErrorMessage(error).slice(0, 240),
        })).run();
      throw new Error("NAVER_UNMATCHED_REFUND_PENDING");
    }
  }
  await db.prepare("INSERT INTO admin_audit_logs (admin_email, action, entity_type, entity_id, after_json) VALUES ('system', ?, 'payment', ?, ?)")
    .bind(kind === "duplicate" ? "naver_payment_duplicate" : "naver_payment_orphan", payment.paymentKey, JSON.stringify({ orderId: payment.orderId, source, status: payment.status, outcome })).run();
  if (outcome === "refunded" || outcome === "already_refunded") {
    await db.prepare("INSERT INTO admin_audit_logs (admin_email, action, entity_type, entity_id, after_json) VALUES ('system', 'naver_payment_refund_resolved', 'payment', ?, ?)")
      .bind(payment.paymentKey, JSON.stringify({ orderId: payment.orderId, source, kind, outcome })).run();
  }
}

export async function reconcileDailyNaverPayments(now = Date.now(), maxPages = 5) {
  try { naverPayConfig(); }
  catch { return { scanned: 0, skipped: true }; }
  const db = getD1();
  const kstDay = new Date(now + 9 * 60 * 60_000).toISOString().slice(0, 10);
  const lockKey = `system:naverpay:daily:${kstDay}`;
  const claimed = await db.prepare("INSERT OR IGNORE INTO rate_limits (bucket_key, window_start, request_count) VALUES (?, ?, 1)")
    .bind(lockKey, Math.floor(now / 1000)).run();
  if (!claimed.meta.changes) return { scanned: 0, skipped: true };

  try {
    const reconciliationEnd = now - 180_000;
    const [recentPaymentIds, pendingRefunds] = await Promise.all([
      listNaverPaymentIds(reconciliationEnd - 48 * 60 * 60_000, reconciliationEnd, maxPages),
      db.prepare("SELECT DISTINCT pending.entity_id FROM admin_audit_logs pending WHERE pending.action = 'naver_payment_refund_pending' AND NOT EXISTS (SELECT 1 FROM admin_audit_logs resolved WHERE resolved.entity_id = pending.entity_id AND resolved.action = 'naver_payment_refund_resolved' AND resolved.id > pending.id) ORDER BY pending.id LIMIT 100").all<{ entity_id: string }>(),
    ]);
    const paymentIds = [...new Set([...recentPaymentIds, ...pendingRefunds.results.map((row) => row.entity_id)])];
    let failed = 0;
    for (let offset = 0; offset < paymentIds.length; offset += 5) {
      const batch = await Promise.allSettled(paymentIds.slice(offset, offset + 5).map(async (paymentId) => {
        const payment = await getNaverPayment(paymentId);
        return applyNaverPaymentSafely(payment, "daily_reconciliation");
      }));
      failed += batch.filter((result) => result.status === "rejected").length;
    }
    if (failed > 0) {
      await db.prepare("INSERT INTO admin_audit_logs (admin_email, action, entity_type, entity_id, after_json) VALUES ('system', 'naver_reconciliation_partial', 'payment_reconciliation', ?, ?)")
        .bind(kstDay, JSON.stringify({ scanned: paymentIds.length, failed })).run();
      await db.prepare("DELETE FROM rate_limits WHERE bucket_key = ?").bind(lockKey).run();
    }
    return { scanned: paymentIds.length, failed, skipped: false };
  } catch (error) {
    await db.prepare("DELETE FROM rate_limits WHERE bucket_key = ?").bind(lockKey).run().catch(() => undefined);
    throw error;
  }
}

async function routeMismatchedNaverPayment(claimed: PaymentReservationRow, payment: NaverPayment, source = "return_order_mismatch") {
  const db = getD1();
  const canRetry = Number(claimed.payment_expires_at || 0) > Date.now();
  await db.prepare("UPDATE reservations SET status = CASE WHEN ? = 1 THEN status ELSE 'cancelled' END, payment_status = CASE WHEN ? = 1 THEN 'ready' ELSE 'failed' END, payment_key = NULL, cancelled_at = CASE WHEN ? = 1 THEN cancelled_at ELSE CURRENT_TIMESTAMP END, cancel_reason = CASE WHEN ? = 1 THEN cancel_reason ELSE '결제 정보 불일치' END, payment_failure_code = 'PAYMENT_ORDER_MISMATCH', payment_failure_message = '결제 주문번호가 일치하지 않습니다.', payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_provider = 'naverpay' AND payment_status IN ('confirming','review_required') AND payment_key = ?")
    .bind(canRetry ? 1 : 0, canRetry ? 1 : 0, canRetry ? 1 : 0, canRetry ? 1 : 0, Date.now(), claimed.id, payment.paymentKey).run();

  const actual = await rowByOrderId(payment.orderId);
  if (actual?.payment_provider === "naverpay") {
    if (actual.payment_key && actual.payment_key !== payment.paymentKey) {
      await refundOrAuditUnmatchedNaverPayment(payment, source, "duplicate");
      return;
    }
    try {
      await applyAuthoritativePayment(actual, payment, source === "return_order_mismatch" ? "naver_return_relinked" : source);
    } catch (error) {
      if (error instanceof Error && error.message === "PAYMENT_VERIFICATION_FAILED") {
        await markPaymentVerificationReview(actual, payment, source);
        return;
      }
      await db.prepare("UPDATE reservations SET payment_status = 'review_required', payment_key = COALESCE(payment_key, ?), payment_failure_code = 'PAYMENT_RELINK_REVIEW', payment_failure_message = ?, payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status NOT IN ('paid','refunded','refund_processing')")
        .bind(payment.paymentKey, providerErrorMessage(error).slice(0, 240), Date.now(), actual.id).run();
    }
    return;
  }

  await refundOrAuditUnmatchedNaverPayment(payment, source);
}

async function applyNaverPaymentSafely(payment: NaverPayment, source: string, hintedRow?: PaymentReservationRow) {
  const [owner, actual] = await Promise.all([rowByPaymentKey(payment.paymentKey), rowByOrderId(payment.orderId)]);
  const mismatchedOwner = owner?.payment_provider === "naverpay" && owner.payment_order_id !== payment.orderId ? owner : null;
  const mismatchedHint = hintedRow?.payment_provider === "naverpay" && hintedRow.payment_key === payment.paymentKey && hintedRow.payment_order_id !== payment.orderId ? hintedRow : null;
  if (mismatchedOwner || mismatchedHint) {
    await routeMismatchedNaverPayment(mismatchedOwner || mismatchedHint!, payment, source);
    return actual ? rowById(actual.id) : null;
  }
  if (!actual || actual.payment_provider !== "naverpay") {
    await refundOrAuditUnmatchedNaverPayment(payment, source);
    return null;
  }
  if (actual.payment_key && actual.payment_key !== payment.paymentKey) {
    await refundOrAuditUnmatchedNaverPayment(payment, source, "duplicate");
    return actual;
  }
  try {
    return await applyAuthoritativePayment(actual, payment, source);
  } catch (error) {
    if (error instanceof Error && error.message === "PAYMENT_VERIFICATION_FAILED") {
      return markPaymentVerificationReview(actual, payment, source);
    }
    throw error;
  }
}

export async function confirmReservationPayment(input: { state: string; paymentKey: string; orderId?: string; amount?: number }) {
  const row = await rowByState(input.state);
  if (!row || !row.payment_order_id || (row.payment_provider === "toss" && (row.payment_order_id !== input.orderId || row.price_total !== input.amount))) {
    throw new Error("PAYMENT_INFORMATION_MISMATCH");
  }
  if (row.payment_status === "paid") return row;
  const existingPaymentOwner = await rowByPaymentKey(input.paymentKey);
  if (existingPaymentOwner && existingPaymentOwner.id !== row.id) {
    if (row.payment_provider !== "naverpay") throw new Error("PAYMENT_INFORMATION_MISMATCH");
    if (existingPaymentOwner.payment_provider_checked_at > Date.now() - 180_000) throw new Error("PAYMENT_PROCESSING");
    const payment = await getNaverPayment(input.paymentKey);
    await applyNaverPaymentSafely(payment, "conflicting_payment_owner", existingPaymentOwner);
    const repaired = await rowById(row.id);
    if (repaired?.payment_status === "paid") return repaired;
    throw new Error("PAYMENT_PROCESSING");
  }
  if (["confirming", "review_required"].includes(row.payment_status)) return recoverConfirming(row);
  if (row.payment_status !== "ready" || row.status !== "confirmed") throw new Error("PAYMENT_NOT_AVAILABLE");
  if (!row.payment_expires_at || row.payment_expires_at <= Date.now()) {
    await expirePaymentHolds();
    throw new Error("PAYMENT_EXPIRED");
  }

  const checkedAt = Date.now();
  const claimed = await getD1().prepare("UPDATE reservations SET payment_status = 'confirming', payment_key = ?, payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'confirmed' AND payment_status = 'ready' AND payment_expires_at > ?")
    .bind(input.paymentKey, checkedAt, row.id, checkedAt).run();
  if (!claimed.meta.changes) {
    const latest = await rowById(row.id);
    if (latest?.payment_status === "paid") return latest;
    if (latest?.payment_status === "confirming") return recoverConfirming(latest);
    throw new Error("PAYMENT_NOT_AVAILABLE");
  }

  const confirming = { ...row, payment_status: "confirming", payment_key: input.paymentKey, payment_provider_checked_at: checkedAt };
  try {
    const payment = await confirmProviderPayment(confirming, input.paymentKey);
    if (row.payment_provider === "naverpay" && payment.orderId !== confirming.payment_order_id) {
      await routeMismatchedNaverPayment(confirming, payment as NaverPayment);
      throw new Error("PAYMENT_INFORMATION_MISMATCH");
    }
    return await finalizePaid(confirming, payment);
  } catch (error) {
    if (error instanceof Error && error.message === "PAYMENT_INFORMATION_MISMATCH") throw error;
    if (error instanceof Error && error.message === "PAYMENT_VERIFICATION_FAILED") {
      await getD1().prepare("UPDATE reservations SET payment_status = 'review_required', payment_failure_code = 'PAYMENT_VERIFICATION_FAILED', payment_failure_message = ?, payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = 'confirming'")
        .bind(error.message, Date.now(), row.id).run();
      throw error;
    }
    if (providerTransient(error)) {
      if (row.payment_provider === "toss") {
        try { return await recoverConfirming(confirming); }
        catch { throw new Error("PAYMENT_PROCESSING"); }
      }
      throw new Error("PAYMENT_PROCESSING");
    }
    if (row.payment_provider === "naverpay" && isAmbiguousNaverPayError(error)) {
      await getD1().prepare("UPDATE reservations SET payment_status = 'review_required', payment_failure_code = ?, payment_failure_message = ?, payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = 'confirming'")
        .bind(providerErrorCode(error).slice(0, 80), providerErrorMessage(error).slice(0, 240), Date.now(), row.id).run();
      throw new Error("PAYMENT_PROCESSING");
    }
    if (!(error instanceof TossApiError) && !(error instanceof NaverPayApiError)) {
      await getD1().prepare("UPDATE reservations SET payment_status = 'review_required', payment_failure_code = 'PAYMENT_VERIFICATION_FAILED', payment_failure_message = ?, payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = 'confirming'")
        .bind(providerErrorMessage(error).slice(0, 240), Date.now(), row.id).run();
      throw error;
    }
    await getD1().prepare("UPDATE reservations SET status = 'cancelled', payment_status = 'failed', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = '결제 승인 실패', payment_failure_code = ?, payment_failure_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = 'confirming'")
      .bind(providerErrorCode(error), providerErrorMessage(error).slice(0, 240), row.id).run();
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
  if (!row.payment_order_id || (row.payment_provider === "naverpay" && !row.payment_key)) throw new Error("PAYMENT_NOT_COMPLETED");
  if (row.payment_provider === "naverpay" && row.payment_provider_checked_at > Date.now() - 180_000) throw new Error("PAYMENT_PROCESSING");
  const reconciled = await syncProviderPayment(row, "admin");
  if (!reconciled) throw new Error("PAYMENT_NOT_COMPLETED");
  return reconciled;
}

async function finalizeRefund(row: PaymentReservationRow, payment: ProviderPayment, reason: string) {
  try { validateProviderIdentity(row, payment); }
  catch { throw new Error("PAYMENT_REFUND_VERIFICATION_FAILED"); }
  if (!fullCancellation(row, payment)) throw new Error("PAYMENT_REFUND_VERIFICATION_FAILED");
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

export async function refundReservationPayment(id: string, reason: string, requester: "1" | "2" = "2") {
  let row = await rowById(id);
  if (!row) throw new Error("RESERVATION_NOT_FOUND");
  if (row.payment_status === "refunded" && row.status === "cancelled") return row;
  if (row.payment_status === "manual") return null;
  if (!row.payment_key || !row.payment_order_id) throw new Error("PAYMENT_REFUND_UNAVAILABLE");
  if (row.payment_status === "paid") {
    const checkedAt = Date.now();
    const claimed = await getD1().prepare("UPDATE reservations SET payment_status = 'refund_processing', payment_refund_requester = ?, payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'confirmed' AND payment_status = 'paid'").bind(requester, checkedAt, id).run();
    if (!claimed.meta.changes) throw new Error("PAYMENT_STATE_CHANGED");
    row = { ...row, payment_status: "refund_processing", payment_refund_requester: requester, payment_provider_checked_at: checkedAt };
  } else if (row.payment_status !== "refund_processing") {
    throw new Error("PAYMENT_REFUND_UNAVAILABLE");
  }

  try {
    const payment = await cancelProviderPayment(row, reason);
    const canceledTotal = (payment.cancels || []).reduce((sum, cancel) => sum + Number(cancel.cancelAmount || 0), 0);
    if (payment.status !== "CANCELED" || (payment.balanceAmount !== undefined && Number(payment.balanceAmount) !== 0) || canceledTotal !== row.price_total) {
      throw new Error("PAYMENT_REFUND_NOT_COMPLETED");
    }
    return await finalizeRefund(row, payment, reason);
  } catch (error) {
    const uncertainNaverRefund = row.payment_provider === "naverpay" && (
      providerTransient(error) ||
      isAmbiguousNaverPayError(error) ||
      (!(error instanceof NaverPayApiError) && !(error instanceof TossApiError))
    );
    if (uncertainNaverRefund) {
      await getD1().prepare("UPDATE reservations SET payment_failure_code = ?, payment_failure_message = ?, payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = 'refund_processing'")
        .bind(providerErrorCode(error).slice(0, 80), providerErrorMessage(error).slice(0, 240), Date.now(), id).run();
      throw error;
    }
    if (row.payment_provider === "toss" && error instanceof TossApiError) {
      try {
        const authoritative = await getProviderPayment(row);
        const canceledTotal = (authoritative.cancels || []).reduce((sum, cancel) => sum + Number(cancel.cancelAmount || 0), 0);
        if (authoritative.status === "CANCELED" && (authoritative.balanceAmount === undefined || Number(authoritative.balanceAmount) === 0) && canceledTotal === row.price_total) {
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
    if (row.payment_provider === "naverpay" && !providerTransient(error) && row.status !== "cancelled") {
      const code = providerErrorCode(error).slice(0, 80);
      const message = providerErrorMessage(error).slice(0, 240);
      const db = getD1();
      await db.prepare("UPDATE reservations SET payment_status = 'paid', payment_failure_code = ?, payment_failure_message = ?, payment_provider_checked_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = 'refund_processing'")
        .bind(code, message, Date.now(), id).run();
      if (error instanceof NaverPayApiError && error.code === "CancelDeadlineExpired") {
        await db.batch([
          db.prepare("INSERT INTO reservation_events (reservation_id, event_type, actor_type, actor_id, payload_json) VALUES (?, 'payment_review_required', 'payment', 'refund_deadline', ?)")
            .bind(id, JSON.stringify({ code, message })),
          db.prepare("INSERT OR IGNORE INTO owner_alerts (reservation_id, type, booking_code, theme_name, service_date, start_minute, party_size, amount, status, payment_status, customer_name_enc, phone_enc) SELECT id, 'payment.review_required', booking_code, theme_name_snapshot, service_date, start_minute, party_size, price_total, status, payment_status, customer_name_enc, phone_enc FROM reservations WHERE id = ?")
            .bind(id),
        ]);
      }
    }
    throw error;
  }
}

export async function releaseReviewedUnpaidReservation(id: string, actorId: string) {
  const row = await rowById(id);
  if (!row) throw new Error("RESERVATION_NOT_FOUND");
  if (row.payment_status !== "review_required" || !row.payment_order_id || (row.payment_provider === "naverpay" && !row.payment_key)) throw new Error("PAYMENT_REVIEW_REQUIRED");
  if (row.payment_provider === "naverpay" && row.payment_provider_checked_at > Date.now() - 180_000) throw new Error("PAYMENT_PROCESSING");
  let providerStatus = "NOT_FOUND";
  try {
    const payment = await getProviderPayment(row);
    if (row.payment_provider === "naverpay" && payment.orderId !== row.payment_order_id) {
      await routeMismatchedNaverPayment(row, payment as NaverPayment, "review_relink");
      throw new Error("PAYMENT_INFORMATION_MISMATCH");
    }
    providerStatus = payment.status;
    if (payment.status === "DONE") return finalizePaid(row, payment);
    if (!["CANCELED", "ABORTED", "EXPIRED", "READY", "IN_PROGRESS"].includes(payment.status)) throw new Error("PAYMENT_PROCESSING");
    if (["READY", "IN_PROGRESS"].includes(payment.status) && Number(row.payment_expires_at || 0) + 30 * 60_000 > Date.now()) throw new Error("PAYMENT_PROCESSING");
  } catch (error) {
    if (!providerNotFound(error)) throw error;
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
  const provider = runtimeEnv().PAYMENT_PROVIDER || "toss";
  try {
    const publicTestEnabled = runtimeEnv().ALLOW_PUBLIC_TEST_PAYMENTS === "1";
    const missing = settings ? merchantComplianceMissing(settings) : [];
    const complianceReady = missing.length === 0;
    if (provider === "toss") {
      const config = tossConfig();
      const mode = config.mode === "live" ? "live" : "test";
      const enabled = mode === "live" ? complianceReady : publicTestEnabled;
      return { configured: enabled, provider, mode, complianceReady };
    }
    if (provider !== "naverpay") throw new Error("PAYMENT_PROVIDER_DISABLED");
    const config = activeNaverPayConfig();
    const mode = config.mode === "production" ? "live" : "test";
    const enabled = mode === "live" ? complianceReady : publicTestEnabled;
    return { configured: enabled, provider, mode, complianceReady };
  } catch {
    return { configured: false, provider, mode: "unavailable", complianceReady: false };
  }
}

export function paymentUnavailableResponse() {
  return json({ ok: false, error: { code: "PAYMENT_UNAVAILABLE", message: "현재 온라인 결제를 이용할 수 없습니다. 잠시 후 다시 시도해 주세요." } }, 503);
}

export function isTransientPaymentError(error: unknown) {
  return providerTransient(error);
}

export function ownerAlertId() {
  return createId("alert");
}
