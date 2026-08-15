import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { cleanupRetainedData, getPaymentResult, confirmReservationPayment, paymentServiceStatus, reconcileDailyNaverPayments, reconcileRecentProviderPayments, refundReservationPayment, releaseReviewedUnpaidReservation } from "../lib/payment-flow";
import { addDays, encryptPrivate, kstDateKey, readJsonBody, sha256, weekdayKst } from "../lib/booking";
import { buildAvailability } from "../lib/availability";
import { isPublicWebOriginAllowed } from "../lib/request-origin";
import { dispatchOwnerPushes } from "../lib/owner-push";
import { DELETE as revokeDevice, PATCH as registerPushDevice } from "../app/api/owner-app/device/route";
import { POST as checkoutPayment } from "../app/api/public/payments/checkout/route";
import { POST as tossWebhook } from "../app/api/public/payments/toss/webhook/route";
import { PUT as updateSettings } from "../app/api/admin/settings/route";
import { ADMIN_SESSION_COOKIE, createAdminSession } from "../lib/admin";
import { getNaverPayment } from "../lib/naver-payments";

class SqliteStatement {
  private values: unknown[] = [];

  constructor(private readonly database: DatabaseSync, private readonly sql: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }

  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.values) as T[], meta: {} };
  }
}

class SqliteD1 {
  beforeBatch?: () => void;

  constructor(readonly database: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteStatement(this.database, sql);
  }

  async batch(statements: SqliteStatement[]) {
    const beforeBatch = this.beforeBatch;
    this.beforeBatch = undefined;
    beforeBatch?.();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function applyMigrations(database: DatabaseSync) {
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of ["drizzle/0000_funny_shiva.sql", "drizzle/0001_fixed_groot.sql", "drizzle/0002_sticky_mathemanic.sql", "drizzle/0003_wonderful_dazzler.sql", "drizzle/0004_fair_terrax.sql", "drizzle/0005_naver_payment_provider.sql", "drizzle/0006_persist_refund_requester.sql"]) {
    const migration = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) database.exec(statement);
  }
}

function naverCheckoutEnv(DB: SqliteD1) {
  return {
    DB,
    PAYMENT_PROVIDER: "naverpay",
    NAVER_PAY_MODE: "development",
    NAVER_PAY_CLIENT_ID: "unit-client-id",
    NAVER_PAY_CLIENT_SECRET: "unit-client-secret",
    NAVER_PAY_CHAIN_ID: "unit-chain-id",
    NAVER_PAY_TAX_SCOPE: "taxable",
    BOOKING_DATA_KEY: "unit-test-booking-data-key-32-bytes-minimum",
    BOOKING_LOOKUP_PEPPER: "unit-test-booking-lookup-pepper-32-bytes-minimum",
    ALLOW_PUBLIC_TEST_PAYMENTS: "1",
  };
}

function pemPrivateKey(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  const base64 = btoa(binary).match(/.{1,64}/g)?.join("\n") || "";
  return `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`;
}

function payment(id: string, status = "DONE") {
  return {
    paymentKey: `payment_key_${id}`,
    orderId: `CTP_${id}`,
    status,
    method: "카드",
    totalAmount: 44_000,
    balanceAmount: status === "CANCELED" ? 0 : 44_000,
    approvedAt: "2026-08-15T05:00:00Z",
    receipt: { url: "https://dashboard.tosspayments.com/sales-slip?transactionId=unit" },
    cancels: status === "CANCELED" ? [{ cancelAmount: 44_000, canceledAt: "2026-08-15T05:10:00Z" }] : [],
  };
}

function seedReservation(database: DatabaseSync, id: string, slotId: string, status = "ready", startMinute = 630) {
  database.prepare("INSERT OR IGNORE INTO themes (id, slug, name, short_name, genre, synopsis) VALUES ('life', 'life', '인생테마', '인생', '드라마', '테스트')").run();
  database.prepare("INSERT INTO booking_slots (id, theme_id, service_date, start_minute, start_at_utc, duration_min, source) VALUES (?, 'life', '2026-08-20', ?, 1787193000000, 60, 'rule')").run(slotId, startMinute);
  database.prepare("INSERT INTO reservations (id, booking_code, request_id, request_fingerprint, slot_id, theme_id, status, party_size, customer_name_enc, phone_enc, phone_hash, phone_last4, theme_name_snapshot, service_date, start_minute, duration_min, price_total, consent_version, source, payment_status, payment_order_id, payment_state, payment_key, payment_expires_at) VALUES (?, ?, ?, 'fingerprint', ?, 'life', 'confirmed', 2, 'name-enc', 'phone-enc', 'phone-hash', '1234', '인생테마', '2026-08-20', ?, 60, 44000, '2026-08-13', 'web', ?, ?, ?, ?, ?)")
    .run(id, `CT-${id.slice(-6).toUpperCase().padStart(6, "2")}`, `request-${id}`, slotId, startMinute, status, `CTP_${id}`, id.repeat(64).slice(0, 64), status === "ready" ? null : `payment_key_${id}`, Date.now() + 600_000);
}

test("payment confirmation, idempotent recovery, refund, and device revocation stay consistent", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = {
    DB: d1,
    TOSS_CLIENT_KEY: ["test", "gck", "unit"].join("_"),
    TOSS_SECRET_KEY: ["test", "gsk", "unit"].join("_"),
  };

  seedReservation(database, "alpha1", "slot-alpha");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/payments/confirm") && init?.method === "POST") return Response.json(payment("alpha1"));
    if (url.endsWith("/payments/payment_key_alpha1/cancel")) return Response.json(payment("alpha1", "CANCELED"));
    if (url.endsWith("/payments/orders/CTP_alpha1")) return Response.json(payment("alpha1"));
    return Response.json({ code: "NOT_FOUND", message: "not found" }, { status: 404 });
  };

  try {
    const state = "alpha1".repeat(64).slice(0, 64);
    const confirmed = await confirmReservationPayment({ state, orderId: "CTP_alpha1", paymentKey: "payment_key_alpha1", amount: 44_000 });
    assert.equal(confirmed.payment_status, "paid");
    assert.equal((await confirmReservationPayment({ state, orderId: "CTP_alpha1", paymentKey: "payment_key_alpha1", amount: 44_000 })).payment_status, "paid");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM owner_alerts WHERE reservation_id = 'alpha1' AND type = 'reservation.confirmed'").get().count, 1);
    assert.match(String(database.prepare("SELECT receipt_url FROM reservations WHERE id = 'alpha1'").get()?.receipt_url || ""), /^https:\/\/dashboard\.tosspayments\.com\//);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM legal_transaction_records WHERE reservation_id = 'alpha1'").get().count, 1);

    await refundReservationPayment("alpha1", "테스트 환불");
    const refunded = database.prepare("SELECT status, payment_status FROM reservations WHERE id = 'alpha1'").get() as { status: string; payment_status: string };
    assert.equal(refunded.status, "cancelled");
    assert.equal(refunded.payment_status, "refunded");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM owner_alerts WHERE reservation_id = 'alpha1'").get().count, 2);

    await assert.rejects(() => getPaymentResult(state, "CTP_alpha1"), /PAYMENT_NOT_COMPLETED/);

    const token = "A".repeat(43);
    database.prepare("INSERT INTO owner_devices (id, device_name, token_hash, token_last8) VALUES ('device-1', '테스트 기기', ?, 'AAAAAAAA')").run(await sha256(token));
    const revoked = await revokeDevice(new Request("https://example.invalid/api/owner-app/device", { method: "DELETE", headers: { authorization: `Bearer ${token}` } }));
    assert.equal(revoked.status, 200);
    assert.equal((database.prepare("SELECT active FROM owner_devices WHERE id = 'device-1'").get() as { active: number }).active, 0);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("provider 5xx recovers from the authoritative payment and slot uniqueness blocks duplicates", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = {
    DB: d1,
    TOSS_CLIENT_KEY: ["test", "gck", "unit"].join("_"),
    TOSS_SECRET_KEY: ["test", "gsk", "unit"].join("_"),
  };
  seedReservation(database, "bravo2", "slot-bravo");
  let confirmCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/payments/confirm")) {
      confirmCalls += 1;
      return Response.json({ code: "PROVIDER_TIMEOUT", message: "timeout" }, { status: 500 });
    }
    if (url.endsWith("/payments/orders/CTP_bravo2")) return Response.json(payment("bravo2"));
    return Response.json({}, { status: 404 });
  };
  try {
    const state = "bravo2".repeat(64).slice(0, 64);
    assert.equal((await confirmReservationPayment({ state, orderId: "CTP_bravo2", paymentKey: "payment_key_bravo2", amount: 44_000 })).payment_status, "paid");
    assert.equal(confirmCalls, 1);
    assert.throws(() => database.prepare("INSERT INTO reservations (id, booking_code, request_id, request_fingerprint, slot_id, theme_id, status, party_size, customer_name_enc, phone_enc, phone_hash, phone_last4, theme_name_snapshot, service_date, start_minute, duration_min, price_total, consent_version, source) SELECT 'duplicate', 'CT-222222', 'request-duplicate', 'fingerprint', slot_id, theme_id, 'confirmed', 2, 'x', 'x', 'x', '2222', theme_name_snapshot, service_date, start_minute, duration_min, price_total, consent_version, 'web' FROM reservations WHERE id = 'bravo2'").run(), /UNIQUE constraint failed/);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("legacy Toss reconciliation still finds a provider payment when the callback never stored a payment key", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = {
    DB: d1,
    TOSS_CLIENT_KEY: ["test", "gck", "unit"].join("_"),
    TOSS_SECRET_KEY: ["test", "gsk", "unit"].join("_"),
  };
  seedReservation(database, "legacy0", "slot-legacy");
  database.prepare("UPDATE reservations SET payment_status='failed', payment_key=NULL, payment_provider_checked_at=0 WHERE id='legacy0'").run();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/payments/orders/CTP_legacy0")) return Response.json(payment("legacy0"));
    if (url.endsWith("/payments/payment_key_legacy0/cancel")) return Response.json(payment("legacy0", "CANCELED"));
    return Response.json({}, { status: 404 });
  };
  try {
    await reconcileRecentProviderPayments(Date.now(), 10);
    const row = database.prepare("SELECT status,payment_status,payment_key FROM reservations WHERE id='legacy0'").get() as Record<string, unknown>;
    assert.equal(row.status, "cancelled");
    assert.equal(row.payment_status, "refunded");
    assert.equal(row.payment_key, "payment_key_legacy0");
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("Naver Pay approval validates the merchant order and customer cancellation keeps tax and requester data", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = naverCheckoutEnv(d1);
  seedReservation(database, "naver8", "slot-naver");
  database.prepare("UPDATE reservations SET payment_provider = 'naverpay', payment_tax_scope_amount = 44000, payment_tax_ex_scope_amount = 0 WHERE id = 'naver8'").run();

  const requests: Array<{ url: string; headers: Headers; body: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, headers: new Headers(init?.headers), body: String(init?.body || "") });
    if (url.endsWith("/v2.2/apply/payment")) {
      return Response.json({
        code: "Success",
        body: {
          paymentId: "npay_naver8",
          detail: {
            paymentId: "npay_naver8",
            merchantPayKey: "CTP_naver8",
            admissionTypeCode: "01",
            admissionState: "SUCCESS",
            admissionYmdt: "20260815140000",
            totalPayAmount: 44_000,
            taxScopeAmount: 44_000,
            taxExScopeAmount: 0,
            primaryPayMeans: "CARD",
            npointPayAmount: 0,
          },
        },
      });
    }
    if (url.endsWith("/v1/cancel")) {
      return Response.json({
        code: "Success",
        body: {
          paymentId: "npay_naver8",
          primaryPayMeans: "CARD",
          primaryPayCancelAmount: 44_000,
          npointCancelAmount: 0,
          giftCardCancelAmount: 0,
          discountCancelAmount: 0,
          taxScopeAmount: 44_000,
          taxExScopeAmount: 0,
          totalRestAmount: 0,
          cancelYmdt: "20260815141000",
        },
      });
    }
    return Response.json({ code: "NotFound", message: "not found" }, { status: 404 });
  };

  try {
    const state = "naver8".repeat(64).slice(0, 64);
    const confirmed = await confirmReservationPayment({ state, paymentKey: "npay_naver8" });
    assert.equal(confirmed.payment_status, "paid");
    assert.equal(database.prepare("SELECT payment_provider, payment_method FROM reservations WHERE id = 'naver8'").get()?.payment_provider, "naverpay");
    assert.equal(database.prepare("SELECT payment_method FROM reservations WHERE id = 'naver8'").get()?.payment_method, "네이버페이 카드");

    await refundReservationPayment("naver8", "고객 요청 취소", "1");
    assert.equal(database.prepare("SELECT payment_status FROM reservations WHERE id = 'naver8'").get()?.payment_status, "refunded");
    assert.equal(database.prepare("SELECT payment_refund_requester FROM reservations WHERE id = 'naver8'").get()?.payment_refund_requester, "1");

    const approve = requests.find((entry) => entry.url.endsWith("/v2.2/apply/payment"));
    assert.ok(approve);
    assert.equal(new URLSearchParams(approve.body).get("paymentId"), "npay_naver8");
    assert.equal(approve.headers.get("X-Naver-Client-Secret"), "unit-client-secret");
    assert.equal(approve.headers.get("X-NaverPay-Idempotency-Key"), "confirm-npay_naver8");

    const cancel = requests.find((entry) => entry.url.endsWith("/v1/cancel"));
    assert.ok(cancel);
    const cancelBody = new URLSearchParams(cancel.body);
    assert.equal(cancelBody.get("cancelRequester"), "1");
    assert.equal(cancelBody.get("taxScopeAmount"), "44000");
    assert.equal(cancelBody.get("taxExScopeAmount"), "0");
    assert.equal(cancelBody.get("doCompareRest"), "1");
    assert.equal(cancelBody.get("expectedRestAmount"), "0");
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("historical Naver refunds work while inactive and CancelNotComplete is later corrected to the provider timestamp", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = {
    DB: d1,
    PAYMENT_PROVIDER: "disabled",
    NAVER_PAY_MODE: "development",
    NAVER_PAY_CLIENT_ID: "unit-client-id",
    NAVER_PAY_CLIENT_SECRET: "unit-client-secret",
    NAVER_PAY_CHAIN_ID: "unit-chain-id",
  };
  seedReservation(database, "cancel7", "slot-cancel-pending", "paid");
  database.prepare("UPDATE reservations SET payment_provider='naverpay', payment_tax_scope_amount=44000, payment_key='npay_cancel7' WHERE id='cancel7'").run();

  let phase: "cancel" | "history" = "cancel";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (phase === "cancel" && url.endsWith("/v1/cancel")) {
      return Response.json({ code: "CancelNotComplete", message: "automatic retry scheduled" });
    }
    if (phase === "history" && url.endsWith("/v2.3/list/history")) {
      return Response.json({ code: "Success", body: { list: [{ paymentId: "npay_cancel7" }], totalPageCount: 1 } });
    }
    if (phase === "history" && url.endsWith("/v2.3/list/history/npay_cancel7")) {
      return Response.json({ code: "Success", body: { list: [
        {
          paymentId: "npay_cancel7",
          merchantPayKey: "CTP_cancel7",
          admissionTypeCode: "01",
          admissionState: "SUCCESS",
          admissionYmdt: "20260815140000",
          totalPayAmount: 44_000,
          taxScopeAmount: 44_000,
          taxExScopeAmount: 0,
          primaryPayMeans: "CARD",
          npointPayAmount: 0,
        },
        {
          paymentId: "npay_cancel7",
          merchantPayKey: "CTP_cancel7",
          admissionTypeCode: "03",
          admissionState: "SUCCESS",
          admissionYmdt: "20260815150000",
          totalPayAmount: 44_000,
          taxScopeAmount: 44_000,
          taxExScopeAmount: 0,
          primaryPayMeans: "CARD",
        },
      ] } });
    }
    return Response.json({ code: "NotFound" }, { status: 404 });
  };
  try {
    assert.equal((await refundReservationPayment("cancel7", "고객 온라인 취소", "1"))?.payment_status, "refunded");
    phase = "history";
    assert.deepEqual(await reconcileDailyNaverPayments(Date.UTC(2026, 7, 16, 6, 0, 0), 1), { scanned: 1, failed: 0, skipped: false });
    assert.equal(database.prepare("SELECT refunded_at FROM reservations WHERE id='cancel7'").get()?.refunded_at, "2026-08-15T15:00:00+09:00");
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("Naver Pay approval response loss is not retried before the 180-second reconciliation window", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = naverCheckoutEnv(d1);
  seedReservation(database, "naver9", "slot-naver-timeout");
  database.prepare("UPDATE reservations SET payment_provider = 'naverpay', payment_tax_scope_amount = 44000, payment_tax_ex_scope_amount = 0 WHERE id = 'naver9'").run();

  let providerCalls = 0;
  let historyAvailable = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    providerCalls += 1;
    if (historyAvailable && String(input).includes("/v2.3/list/history/npay_naver9")) {
      return Response.json({
        code: "Success",
        body: {
          list: [{
            paymentId: "npay_naver9",
            merchantPayKey: "CTP_naver9",
            admissionTypeCode: "01",
            admissionState: "SUCCESS",
            admissionYmdt: "20260815140000",
            totalPayAmount: 44_000,
            taxScopeAmount: 44_000,
            taxExScopeAmount: 0,
            primaryPayMeans: "CARD",
            npointPayAmount: 0,
          }],
        },
      });
    }
    throw new Error("network response lost");
  };
  try {
    const state = "naver9".repeat(64).slice(0, 64);
    await assert.rejects(() => confirmReservationPayment({ state, paymentKey: "npay_naver9" }), /PAYMENT_PROCESSING/);
    const firstAttemptAt = Number(database.prepare("SELECT payment_provider_checked_at FROM reservations WHERE id = 'naver9'").get()?.payment_provider_checked_at);
    await assert.rejects(() => confirmReservationPayment({ state, paymentKey: "npay_naver9" }), /PAYMENT_PROCESSING/);
    assert.equal(providerCalls, 1);
    assert.equal(database.prepare("SELECT payment_status FROM reservations WHERE id = 'naver9'").get()?.payment_status, "confirming");
    await reconcileRecentProviderPayments(firstAttemptAt + 61_000, 10);
    assert.equal(providerCalls, 1);
    historyAvailable = true;
    await reconcileRecentProviderPayments(firstAttemptAt + 181_000, 10);
    assert.equal(providerCalls, 2);
    assert.equal(database.prepare("SELECT payment_status FROM reservations WHERE id = 'naver9'").get()?.payment_status, "paid");
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("a Naver paymentId submitted with the wrong state is relinked to its verified merchant order without poisoning either reservation", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = naverCheckoutEnv(d1);
  seedReservation(database, "wrong1", "slot-wrong", "ready", 630);
  seedReservation(database, "right2", "slot-right", "ready", 750);
  database.prepare("UPDATE reservations SET payment_provider='naverpay', payment_tax_scope_amount=44000 WHERE id IN ('wrong1','right2')").run();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/v2.2/apply/payment")) {
      return Response.json({
        code: "Success",
        body: {
          paymentId: "npay_right2",
          detail: {
            paymentId: "npay_right2",
            merchantPayKey: "CTP_right2",
            admissionTypeCode: "01",
            admissionState: "SUCCESS",
            admissionYmdt: "20260815140000",
            totalPayAmount: 44_000,
            taxScopeAmount: 44_000,
            taxExScopeAmount: 0,
            primaryPayMeans: "CARD",
            npointPayAmount: 0,
          },
        },
      });
    }
    return Response.json({ code: "NotFound" }, { status: 404 });
  };
  try {
    const wrongState = "wrong1".repeat(64).slice(0, 64);
    await assert.rejects(() => confirmReservationPayment({ state: wrongState, paymentKey: "npay_right2" }), /PAYMENT_INFORMATION_MISMATCH/);
    const wrong = database.prepare("SELECT payment_status,payment_key FROM reservations WHERE id='wrong1'").get() as Record<string, unknown>;
    const right = database.prepare("SELECT payment_status,payment_key FROM reservations WHERE id='right2'").get() as Record<string, unknown>;
    assert.equal(wrong.payment_status, "ready");
    assert.equal(wrong.payment_key, null);
    assert.equal(right.payment_status, "paid");
    assert.equal(right.payment_key, "npay_right2");
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("scheduled history reconciliation repairs a wrong paymentId claim left behind by an interrupted return handler", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = naverCheckoutEnv(d1);
  seedReservation(database, "crash1", "slot-crash-wrong", "ready", 630);
  seedReservation(database, "crash2", "slot-crash-right", "ready", 750);
  database.prepare("UPDATE reservations SET payment_provider='naverpay', payment_tax_scope_amount=44000 WHERE id IN ('crash1','crash2')").run();
  database.prepare("UPDATE reservations SET payment_status='confirming', payment_key='npay_crash2', payment_provider_checked_at=0, updated_at='2026-08-15 00:00:00' WHERE id='crash1'").run();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/v2.3/list/history/npay_crash2")) {
      return Response.json({
        code: "Success",
        body: { list: [{
          paymentId: "npay_crash2",
          merchantPayKey: "CTP_crash2",
          admissionTypeCode: "01",
          admissionState: "SUCCESS",
          admissionYmdt: "20260815140000",
          totalPayAmount: 44_000,
          taxScopeAmount: 44_000,
          taxExScopeAmount: 0,
          primaryPayMeans: "CARD",
          npointPayAmount: 0,
        }] },
      });
    }
    return Response.json({ code: "NotFound" }, { status: 404 });
  };
  try {
    await reconcileRecentProviderPayments(Date.now(), 10);
    const wrong = database.prepare("SELECT payment_status,payment_key FROM reservations WHERE id='crash1'").get() as Record<string, unknown>;
    const right = database.prepare("SELECT payment_status,payment_key FROM reservations WHERE id='crash2'").get() as Record<string, unknown>;
    assert.equal(wrong.payment_status, "ready");
    assert.equal(wrong.payment_key, null);
    assert.equal(right.payment_status, "paid");
    assert.equal(right.payment_key, "npay_crash2");
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("scheduled Naver reconciliation sends an approved amount mismatch to owner review", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = naverCheckoutEnv(d1);
  seedReservation(database, "crashm1", "slot-crash-amount", "ready", 630);
  database.prepare("UPDATE reservations SET payment_provider='naverpay', payment_tax_scope_amount=44000, payment_status='confirming', payment_key='npay_crashm1', payment_provider_checked_at=0, updated_at='2026-08-15 00:00:00' WHERE id='crashm1'").run();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: "Success", body: { list: [{
    paymentId: "npay_crashm1",
    merchantPayKey: "CTP_crashm1",
    admissionTypeCode: "01",
    admissionState: "SUCCESS",
    admissionYmdt: "20260815140000",
    totalPayAmount: 43_000,
    taxScopeAmount: 43_000,
    taxExScopeAmount: 0,
    primaryPayMeans: "CARD",
    npointPayAmount: 0,
  }] } });
  try {
    await reconcileRecentProviderPayments(Date.now(), 10);
    const row = database.prepare("SELECT status,payment_status,payment_failure_code FROM reservations WHERE id='crashm1'").get() as Record<string, unknown>;
    assert.equal(row.status, "confirmed");
    assert.equal(row.payment_status, "review_required");
    assert.equal(row.payment_failure_code, "PAYMENT_VERIFICATION_FAILED");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM owner_alerts WHERE reservation_id='crashm1' AND type='payment.review_required'").get()?.count, 1);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("a Naver 200 response without a success code remains reviewable instead of becoming a false failed booking", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = naverCheckoutEnv(d1);
  seedReservation(database, "badjson", "slot-bad-json");
  database.prepare("UPDATE reservations SET payment_provider='naverpay', payment_tax_scope_amount=44000 WHERE id='badjson'").run();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({});
  try {
    const state = "badjson".repeat(64).slice(0, 64);
    await assert.rejects(() => confirmReservationPayment({ state, paymentKey: "npay_badjson" }), /PAYMENT_PROCESSING/);
    const row = database.prepare("SELECT status,payment_status,payment_failure_code FROM reservations WHERE id='badjson'").get() as Record<string, unknown>;
    assert.equal(row.status, "confirmed");
    assert.equal(row.payment_status, "review_required");
    assert.equal(row.payment_failure_code, "NAVER_PAY_API_ERROR");
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("a Naver approval with a mismatched amount remains reviewable instead of becoming paid or failed", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = naverCheckoutEnv(d1);
  seedReservation(database, "amount1", "slot-amount-mismatch");
  database.prepare("UPDATE reservations SET payment_provider='naverpay', payment_tax_scope_amount=44000 WHERE id='amount1'").run();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    code: "Success",
    body: {
      paymentId: "npay_amount1",
      detail: {
        paymentId: "npay_amount1",
        merchantPayKey: "CTP_amount1",
        admissionTypeCode: "01",
        admissionState: "SUCCESS",
        admissionYmdt: "20260815140000",
        totalPayAmount: 43_000,
        taxScopeAmount: 43_000,
        taxExScopeAmount: 0,
        primaryPayMeans: "CARD",
        npointPayAmount: 0,
      },
    },
  });
  try {
    const state = "amount1".repeat(64).slice(0, 64);
    await assert.rejects(() => confirmReservationPayment({ state, paymentKey: "npay_amount1" }), /PAYMENT_VERIFICATION_FAILED/);
    const row = database.prepare("SELECT status,payment_status,paid_amount,payment_failure_code FROM reservations WHERE id='amount1'").get() as Record<string, unknown>;
    assert.equal(row.status, "confirmed");
    assert.equal(row.payment_status, "review_required");
    assert.equal(row.paid_amount, 0);
    assert.equal(row.payment_failure_code, "PAYMENT_VERIFICATION_FAILED");
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("Naver history rejects mixed payment identities", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = naverCheckoutEnv(d1);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: "Success", body: { list: [{
    paymentId: "another_payment",
    merchantPayKey: "CTP_history1",
    admissionTypeCode: "01",
    admissionState: "SUCCESS",
    admissionYmdt: "20260815140000",
    totalPayAmount: 44_000,
    taxScopeAmount: 44_000,
    taxExScopeAmount: 0,
    primaryPayMeans: "CARD",
    npointPayAmount: 0,
  }] } });
  try {
    await assert.rejects(() => getNaverPayment("npay_history1"), (error: unknown) => Boolean(
      error && typeof error === "object" && "code" in error && error.code === "NAVER_PAY_INVALID_RESPONSE",
    ));
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("a Naver cancellation history tax mismatch stays locked for review", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = naverCheckoutEnv(d1);
  seedReservation(database, "taxcan1", "slot-tax-cancel", "paid");
  database.prepare("UPDATE reservations SET payment_provider='naverpay', payment_tax_scope_amount=44000, payment_tax_ex_scope_amount=0, payment_key='npay_taxcan1' WHERE id='taxcan1'").run();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/cancel")) return Response.json({ code: "AlreadyCanceled", message: "already canceled" });
    if (url.endsWith("/v2.3/list/history/npay_taxcan1")) return Response.json({ code: "Success", body: { list: [
      {
        paymentId: "npay_taxcan1",
        merchantPayKey: "CTP_taxcan1",
        admissionTypeCode: "01",
        admissionState: "SUCCESS",
        admissionYmdt: "20260815140000",
        totalPayAmount: 44_000,
        taxScopeAmount: 44_000,
        taxExScopeAmount: 0,
        primaryPayMeans: "CARD",
        npointPayAmount: 0,
      },
      {
        paymentId: "npay_taxcan1",
        merchantPayKey: "CTP_taxcan1",
        admissionTypeCode: "03",
        admissionState: "SUCCESS",
        admissionYmdt: "20260815150000",
        totalPayAmount: 44_000,
        taxScopeAmount: 0,
        taxExScopeAmount: 44_000,
        primaryPayMeans: "CARD",
      },
    ] } });
    return Response.json({ code: "NotFound" }, { status: 404 });
  };
  try {
    await assert.rejects(() => refundReservationPayment("taxcan1", "과세 검증", "1"), /PAYMENT_REFUND_VERIFICATION_FAILED/);
    const row = database.prepare("SELECT status,payment_status,payment_failure_code FROM reservations WHERE id='taxcan1'").get() as Record<string, unknown>;
    assert.equal(row.status, "confirmed");
    assert.equal(row.payment_status, "refund_processing");
    assert.equal(row.payment_failure_code, "PAYMENT_PROVIDER_ERROR");
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("daily Naver history reconciliation discovers payments by period and runs once per KST day", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = naverCheckoutEnv(d1);
  seedReservation(database, "daily1", "slot-daily");
  database.prepare("UPDATE reservations SET payment_provider='naverpay', payment_tax_scope_amount=44000 WHERE id='daily1'").run();

  let providerCalls = 0;
  let periodBody = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    providerCalls += 1;
    const url = String(input);
    if (url.endsWith("/v2.3/list/history")) {
      periodBody = String(init?.body || "");
      return Response.json({ code: "Success", body: { list: [{ paymentId: "npay_daily1" }], totalPageCount: 1 } });
    }
    if (url.endsWith("/v2.3/list/history/npay_daily1")) {
      return Response.json({
        code: "Success",
        body: {
          list: [{
            paymentId: "npay_daily1",
            merchantPayKey: "CTP_daily1",
            admissionTypeCode: "01",
            admissionState: "SUCCESS",
            admissionYmdt: "20260815140000",
            totalPayAmount: 44_000,
            taxScopeAmount: 44_000,
            taxExScopeAmount: 0,
            primaryPayMeans: "CARD",
            npointPayAmount: 0,
          }],
        },
      });
    }
    return Response.json({ code: "NotFound" }, { status: 404 });
  };
  try {
    const now = Date.UTC(2026, 7, 15, 6, 0, 0);
    assert.deepEqual(await reconcileDailyNaverPayments(now, 2), { scanned: 1, failed: 0, skipped: false });
    assert.equal(JSON.parse(periodBody).endTime, "20260815145700");
    assert.equal(database.prepare("SELECT payment_status,payment_key FROM reservations WHERE id='daily1'").get()?.payment_status, "paid");
    assert.deepEqual(await reconcileDailyNaverPayments(now + 60_000, 2), { scanned: 0, skipped: true });
    assert.equal(providerCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("a failed daily Naver history request releases its lock for a same-day retry", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = naverCheckoutEnv(d1);
  let fail = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    if (fail) throw new Error("temporary history failure");
    return Response.json({ code: "Success", body: { list: [], totalPageCount: 1 } });
  };
  try {
    const now = Date.UTC(2026, 7, 17, 6, 0, 0);
    await assert.rejects(() => reconcileDailyNaverPayments(now, 1), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "NAVER_PAY_NETWORK_ERROR"));
    assert.equal(database.prepare("SELECT COUNT(*) count FROM rate_limits WHERE bucket_key LIKE 'system:naverpay:daily:%'").get()?.count, 0);
    fail = false;
    assert.deepEqual(await reconcileDailyNaverPayments(now + 60_000, 1), { scanned: 0, failed: 0, skipped: false });
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("daily reconciliation durably retries a failed refund for a second Naver paymentId", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = naverCheckoutEnv(d1);
  seedReservation(database, "dupe01", "slot-dupe", "paid");
  database.prepare("UPDATE reservations SET payment_provider='naverpay', payment_tax_scope_amount=44000, payment_key='npay_primary' WHERE id='dupe01'").run();

  let cancelPaymentId = "";
  let periodCalls = 0;
  let cancelCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v2.3/list/history")) {
      periodCalls += 1;
      return Response.json({ code: "Success", body: { list: periodCalls === 1 ? [{ paymentId: "npay_duplicate" }] : [], totalPageCount: 1 } });
    }
    if (url.endsWith("/v2.3/list/history/npay_duplicate")) {
      return Response.json({ code: "Success", body: { list: [{
        paymentId: "npay_duplicate",
        merchantPayKey: "CTP_dupe01",
        admissionTypeCode: "01",
        admissionState: "SUCCESS",
        admissionYmdt: "20260815140000",
        totalPayAmount: 44_000,
        taxScopeAmount: 44_000,
        taxExScopeAmount: 0,
        primaryPayMeans: "CARD",
        npointPayAmount: 0,
      }] } });
    }
    if (url.endsWith("/v1/cancel")) {
      cancelCalls += 1;
      cancelPaymentId = new URLSearchParams(String(init?.body || "")).get("paymentId") || "";
      if (cancelCalls === 1) throw new Error("temporary cancel failure");
      return Response.json({ code: "Success", body: {
        paymentId: "npay_duplicate",
        primaryPayMeans: "CARD",
        primaryPayCancelAmount: 44_000,
        npointCancelAmount: 0,
        giftCardCancelAmount: 0,
        discountCancelAmount: 0,
        taxScopeAmount: 44_000,
        taxExScopeAmount: 0,
        totalRestAmount: 0,
        cancelYmdt: "20260815141000",
      } });
    }
    return Response.json({ code: "NotFound" }, { status: 404 });
  };
  try {
    const now = Date.UTC(2026, 7, 16, 6, 0, 0);
    assert.deepEqual(await reconcileDailyNaverPayments(now, 1), { scanned: 1, failed: 1, skipped: false });
    assert.equal(database.prepare("SELECT action FROM admin_audit_logs WHERE entity_id='npay_duplicate' ORDER BY id DESC LIMIT 1").get()?.action, "naver_payment_refund_pending");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM rate_limits WHERE bucket_key LIKE 'system:naverpay:daily:%'").get()?.count, 0);
    assert.deepEqual(await reconcileDailyNaverPayments(now + 60_000, 1), { scanned: 1, failed: 0, skipped: false });
    assert.equal(cancelPaymentId, "npay_duplicate");
    assert.equal(cancelCalls, 2);
    assert.equal(database.prepare("SELECT payment_key,payment_status FROM reservations WHERE id='dupe01'").get()?.payment_key, "npay_primary");
    assert.equal(database.prepare("SELECT action FROM admin_audit_logs WHERE entity_id='npay_duplicate' ORDER BY id DESC LIMIT 1").get()?.action, "naver_payment_refund_resolved");
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("Origin null is rejected and streamed JSON bodies stop at the byte limit", async () => {
  assert.equal(isPublicWebOriginAllowed(new Request("https://example.com/api", { headers: { origin: "null" } })), false);
  assert.equal(isPublicWebOriginAllowed(new Request("https://example.com/api")), true);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"value":"'));
      controller.enqueue(new TextEncoder().encode("x".repeat(100)));
      controller.enqueue(new TextEncoder().encode('"}'));
      controller.close();
    },
  });
  await assert.rejects(() => readJsonBody(new Request("https://example.com", { method: "POST", body, duplex: "half" } as RequestInit), 32), /PAYLOAD_TOO_LARGE/);
});

test("refund timeout reconciliation and reviewed unpaid release never leave occupied ghost bookings", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = {
    DB: d1,
    TOSS_CLIENT_KEY: ["test", "gck", "unit"].join("_"),
    TOSS_SECRET_KEY: ["test", "gsk", "unit"].join("_"),
  };
  seedReservation(database, "refund3", "slot-refund", "paid");
  seedReservation(database, "review4", "slot-review", "review_required", 720);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/payments/payment_key_refund3/cancel")) return Response.json({ code: "PROVIDER_TIMEOUT", message: "timeout" }, { status: 500 });
    if (url.endsWith("/payments/orders/CTP_refund3")) return Response.json(payment("refund3", "CANCELED"));
    if (url.endsWith("/payments/orders/CTP_review4")) return Response.json({ code: "NOT_FOUND", message: "not found" }, { status: 404 });
    return Response.json({}, { status: 404 });
  };
  try {
    assert.equal((await refundReservationPayment("refund3", "재시도 환불"))?.payment_status, "refunded");
    assert.equal((await releaseReviewedUnpaidReservation("review4", "shared-access-key")).payment_status, "failed");
    const rows = database.prepare("SELECT id, status FROM reservations WHERE id IN ('refund3','review4') ORDER BY id").all() as Array<{ id: string; status: string }>;
    assert.equal(rows.every((row) => row.status === "cancelled"), true);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM reservation_events WHERE reservation_id = 'review4' AND event_type = 'payment_review_released'").get().count, 1);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("overlapping manual reservations close public slots and a concurrent closure wins at checkout write time", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = naverCheckoutEnv(d1);
  const date = addDays(kstDateKey(), 2);
  const weekday = weekdayKst(date);
  database.prepare("INSERT INTO themes (id, slug, name, short_name, genre, synopsis, duration_min, turnover_min, prices_json) VALUES ('race', 'race', '레이스', '레이스', '테스트', '테스트', 60, 30, '{\"2\":44000}')").run();
  database.prepare("INSERT INTO schedule_rules (theme_id, weekday, start_minute) VALUES ('race', ?, 630)").run(weekday);
  database.prepare("INSERT INTO booking_slots (id, theme_id, service_date, start_minute, start_at_utc, duration_min, source) VALUES (?, 'race', ?, 660, ?, 60, 'admin')")
    .run(`slot_race_${date.replaceAll("-", "")}_660`, date, Date.now() + 172_800_000);
  database.prepare("INSERT INTO reservations (id, booking_code, request_id, request_fingerprint, slot_id, theme_id, status, party_size, customer_name_enc, phone_enc, phone_hash, phone_last4, theme_name_snapshot, service_date, start_minute, duration_min, price_total, consent_version, source) VALUES ('manual-overlap', 'CT-333333', 'manual-overlap', '', ?, 'race', 'confirmed', 2, 'x', 'x', 'x', '3333', '레이스', ?, 660, 60, 0, 'admin', 'admin')")
    .run(`slot_race_${date.replaceAll("-", "")}_660`, date);

  const availability = await buildAvailability("race", 5);
  const publicSlot = availability?.dates.find((item) => item.date === date)?.slots.find((item) => item.startMinute === 630);
  assert.equal(publicSlot?.status, "booked");

  database.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = 'manual-overlap'").run();
  d1.beforeBatch = () => {
    database.prepare("INSERT INTO closures (id, scope, start_date, end_date, note, public_message) VALUES ('race-closure', 'store', ?, ?, '', '휴무')").run(date, date);
  };
  const checkout = await checkoutPayment(new Request("https://backend.example/api/public/payments/checkout", {
    method: "POST",
    headers: { origin: "https://sosirusok.github.io", "content-type": "application/json", "cf-connecting-ip": "127.0.0.10" },
    body: JSON.stringify({
      slotId: `slot_race_${date.replaceAll("-", "")}_630`,
      partySize: 2,
      name: "테스트손님",
      phone: "01012345678",
      consentVersion: "2026-08-15-npay",
      termsVersion: "2026-08-15-npay",
      refundPolicyVersion: "2026-08-15-npay",
      consentAccepted: true,
      termsAccepted: true,
      refundPolicyAccepted: true,
      requestId: "27fa0db9-a390-4dce-a441-30f69a6f723d",
    }),
  }));
  assert.equal(checkout.status, 409);
  assert.equal((await checkout.json()).error.code, "SLOT_UNAVAILABLE");
  assert.equal((database.prepare("SELECT COUNT(*) count FROM reservations WHERE request_id = '27fa0db9-a390-4dce-a441-30f69a6f723d'").get() as { count: number }).count, 0);
  database.close();
});

test("owner push registration, transactional outbox, and FCM delivery expose no reservation PII", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const privateKey = pemPrivateKey(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = {
    DB: d1,
    BOOKING_DATA_KEY: "unit-test-booking-data-key-32-bytes-minimum",
    BOOKING_LOOKUP_PEPPER: "unit-test-booking-lookup-pepper-32-bytes-minimum",
    FIREBASE_PROJECT_ID: "catharsis-unit",
    FIREBASE_CLIENT_EMAIL: "fcm-unit@catharsis-unit.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY: privateKey,
  };

  seedReservation(database, "push5", "slot-push", "paid", 810);
  const deviceToken = "D".repeat(43);
  database.prepare("INSERT INTO owner_devices (id, device_name, token_hash, token_last8) VALUES ('device-push', '사장님 폰', ?, 'DDDDDDDD')").run(await sha256(deviceToken));
  const installationId = "catharsisOwnerInstallation_01";
  const registered = await registerPushDevice(new Request("https://example.invalid/api/owner-app/device", {
    method: "PATCH",
    headers: { authorization: `Bearer ${deviceToken}`, "content-type": "application/json" },
    body: JSON.stringify({ installationId }),
  }));
  assert.equal(registered.status, 200);

  const encryptedName = await encryptPrivate("예약고객");
  const encryptedPhone = await encryptPrivate("01012345678");
  database.prepare(
    `INSERT INTO owner_alerts
      (reservation_id,type,booking_code,theme_name,service_date,start_minute,party_size,amount,status,payment_status,customer_name_enc,phone_enc)
     VALUES ('push5','reservation.confirmed','CT-PUSH55','인생테마','2026-08-20',810,2,44000,'confirmed','paid',?,?)`,
  ).run(encryptedName, encryptedPhone);
  assert.equal((database.prepare("SELECT COUNT(*) count FROM owner_push_deliveries").get() as { count: number }).count, 1);

  let fcmPayload = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "unit-access-token", expires_in: 3600 });
    if (url.includes("fcm.googleapis.com")) {
      fcmPayload = String(init?.body || "");
      return Response.json({ name: "projects/catharsis-unit/messages/unit-message" });
    }
    return Response.json({}, { status: 404 });
  };
  try {
    assert.equal(await dispatchOwnerPushes(), 1);
    const body = JSON.parse(fcmPayload);
    assert.equal(body.message.fid, installationId);
    assert.deepEqual(Object.keys(body.message.data).sort(), ["alertId", "kind", "schema"]);
    assert.equal(fcmPayload.includes("예약고객"), false);
    assert.equal(fcmPayload.includes("01012345678"), false);
    assert.equal(fcmPayload.includes("CT-PUSH55"), false);
    assert.equal((database.prepare("SELECT status FROM owner_push_deliveries").get() as { status: string }).status, "sent");
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("checkout requires affirmative policy attestations and snapshots the accepted versions", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = naverCheckoutEnv(d1);
  const date = addDays(kstDateKey(), 3);
  const weekday = weekdayKst(date);
  database.prepare("INSERT INTO themes (id, slug, name, short_name, genre, synopsis, duration_min, turnover_min, prices_json) VALUES ('policy', 'policy', '정책 테스트', '정책', '테스트', '테스트', 60, 30, '{\"2\":44000}')").run();
  database.prepare("INSERT INTO schedule_rules (theme_id, weekday, start_minute) VALUES ('policy', ?, 630)").run(weekday);
  const basePayload = {
    slotId: `slot_policy_${date.replaceAll("-", "")}_630`,
    partySize: 2,
    name: "정책손님",
    phone: "01012345678",
    consentVersion: "2026-08-15-npay",
    termsVersion: "2026-08-15-npay",
    refundPolicyVersion: "2026-08-15-npay",
  };
  const request = (body: Record<string, unknown>, ip: string) => new Request("https://backend.example/api/public/payments/checkout", {
    method: "POST",
    headers: { origin: "https://sosirusok.github.io", "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });

  const rejected = await checkoutPayment(request({ ...basePayload, requestId: "27fa0db9-a390-4dce-a441-30f69a6f7001" }, "127.0.0.21"));
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error.code, "POLICY_AGREEMENT_REQUIRED");

  const accepted = await checkoutPayment(request({
    ...basePayload,
    requestId: "27fa0db9-a390-4dce-a441-30f69a6f7002",
    consentAccepted: true,
    termsAccepted: true,
    refundPolicyAccepted: true,
  }, "127.0.0.22"));
  assert.equal(accepted.status, 201);
  const snapshot = database.prepare("SELECT consent_version, terms_version, refund_policy_version, cancel_cutoff_minutes_snapshot, payment_notice_waived, policy_accepted_at FROM reservations WHERE request_id = '27fa0db9-a390-4dce-a441-30f69a6f7002'").get() as Record<string, unknown>;
  assert.equal(snapshot.consent_version, "2026-08-15-npay");
  assert.equal(snapshot.terms_version, "2026-08-15-npay");
  assert.equal(snapshot.refund_policy_version, "2026-08-15-npay");
  assert.equal(snapshot.cancel_cutoff_minutes_snapshot, 1440);
  assert.equal(snapshot.payment_notice_waived, 0);
  assert.ok(snapshot.policy_accepted_at);
  database.close();
});

test("checkout keeps legacy Toss active until Naver Pay is explicitly enabled", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = {
    DB: d1,
    TOSS_CLIENT_KEY: ["test", "gck", "unit"].join("_"),
    TOSS_SECRET_KEY: ["test", "gsk", "unit"].join("_"),
    ALLOW_PUBLIC_TEST_PAYMENTS: "1",
    BOOKING_DATA_KEY: "unit-test-booking-data-key-32-bytes-minimum",
    BOOKING_LOOKUP_PEPPER: "unit-test-booking-lookup-pepper-32-bytes-minimum",
  };
  const date = addDays(kstDateKey(), 4);
  const weekday = weekdayKst(date);
  database.prepare("INSERT INTO themes (id, slug, name, short_name, genre, synopsis, duration_min, turnover_min, prices_json) VALUES ('toss-safe', 'toss-safe', '토스 안전 전환', '안전', '테스트', '테스트', 60, 30, '{\"2\":44000}')").run();
  database.prepare("INSERT INTO schedule_rules (theme_id, weekday, start_minute) VALUES ('toss-safe', ?, 630)").run(weekday);
  const response = await checkoutPayment(new Request("https://backend.example/api/public/payments/checkout", {
    method: "POST",
    headers: { origin: "https://sosirusok.github.io", "content-type": "application/json", "cf-connecting-ip": "127.0.0.23" },
    body: JSON.stringify({
      slotId: `slot_toss-safe_${date.replaceAll("-", "")}_630`,
      partySize: 2,
      name: "안전전환",
      phone: "01012345678",
      consentVersion: "2026-08-15-npay",
      termsVersion: "2026-08-15-npay",
      refundPolicyVersion: "2026-08-15-npay",
      consentAccepted: true,
      termsAccepted: true,
      refundPolicyAccepted: true,
      requestId: "27fa0db9-a390-4dce-a441-30f69a6f7003",
    }),
  }));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.payment.provider, "toss");
  assert.deepEqual(paymentServiceStatus(), { configured: true, provider: "toss", mode: "test", complianceReady: true });
  const row = database.prepare("SELECT payment_provider,payment_tax_scope_amount,payment_tax_ex_scope_amount FROM reservations WHERE request_id='27fa0db9-a390-4dce-a441-30f69a6f7003'").get() as Record<string, unknown>;
  assert.equal(row.payment_provider, "toss");
  assert.equal(row.payment_tax_scope_amount, 0);
  assert.equal(row.payment_tax_ex_scope_amount, 0);
  database.close();
});

test("Toss status webhook is deduplicated and reconciles a provider-side full cancellation", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = {
    DB: d1,
    TOSS_CLIENT_KEY: ["test", "gck", "unit"].join("_"),
    TOSS_SECRET_KEY: ["test", "gsk", "unit"].join("_"),
  };
  seedReservation(database, "webhk6", "slot-webhook", "paid", 900);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/payments/orders/CTP_webhk6")) return Response.json(payment("webhk6", "CANCELED"));
    return Response.json({}, { status: 404 });
  };
  const webhookBody = JSON.stringify({
    eventType: "PAYMENT_STATUS_CHANGED",
    createdAt: "2026-08-15T05:10:00Z",
    data: { orderId: "CTP_webhk6", paymentKey: "payment_key_webhk6", status: "CANCELED" },
  });
  const webhookRequest = () => new Request("https://backend.example/api/public/payments/toss/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: webhookBody,
  });
  try {
    assert.equal((await tossWebhook(webhookRequest())).status, 200);
    assert.equal((await tossWebhook(webhookRequest())).status, 200);
    const reservation = database.prepare("SELECT status, payment_status FROM reservations WHERE id = 'webhk6'").get() as { status: string; payment_status: string };
    assert.equal(reservation.status, "cancelled");
    assert.equal(reservation.payment_status, "refunded");
    const event = database.prepare("SELECT COUNT(*) count, MAX(attempts) attempts FROM payment_webhook_events").get() as { count: number; attempts: number };
    assert.equal(event.count, 1);
    assert.equal(event.attempts, 1);
    assert.ok(database.prepare("SELECT refunded_at FROM legal_transaction_records WHERE reservation_id = 'webhk6'").get()?.refunded_at);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("retention cleanup removes operational PII while keeping and later expiring restricted legal records", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = {
    DB: d1,
    BOOKING_DATA_KEY: "unit-test-booking-data-key-32-bytes-minimum",
    BOOKING_LOOKUP_PEPPER: "unit-test-booking-lookup-pepper-32-bytes-minimum",
  };
  seedReservation(database, "retent7", "slot-retention", "paid", 990);
  database.prepare("INSERT INTO owner_alerts (reservation_id,type,booking_code,theme_name,service_date,start_minute,party_size,amount,status,payment_status,customer_name_enc,phone_enc) SELECT id,'reservation.confirmed',booking_code,theme_name_snapshot,service_date,start_minute,party_size,price_total,status,payment_status,customer_name_enc,phone_enc FROM reservations WHERE id='retent7'").run();
  const cleanupAt = Date.UTC(2027, 0, 1);
  database.prepare("INSERT INTO legal_transaction_records (reservation_id,booking_code,customer_name_enc,phone_enc,payment_order_id,theme_name,service_date,start_minute,party_size,amount,paid_at,retention_until) SELECT id,booking_code,customer_name_enc,phone_enc,payment_order_id,theme_name_snapshot,service_date,start_minute,party_size,price_total,'2026-08-15T05:00:00Z',? FROM reservations WHERE id='retent7'").run(cleanupAt + 100 * 86_400_000);

  assert.equal((await cleanupRetainedData(cleanupAt)).operationalPiiPurged, 1);
  const purged = database.prepare("SELECT phone_hash, phone_last4, request_fingerprint, pii_purged_at FROM reservations WHERE id='retent7'").get() as Record<string, unknown>;
  assert.equal(purged.phone_hash, "");
  assert.equal(purged.phone_last4, "");
  assert.equal(purged.request_fingerprint, "");
  assert.ok(purged.pii_purged_at);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM owner_alerts WHERE reservation_id='retent7'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM legal_transaction_records WHERE reservation_id='retent7'").get().count, 1);

  await cleanupRetainedData(cleanupAt + 101 * 86_400_000);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM legal_transaction_records WHERE reservation_id='retent7'").get().count, 0);
  database.close();
});

test("partial administrator setting updates preserve omitted legal and booking fields", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const d1 = new SqliteD1(database);
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = {
    DB: d1,
    ADMIN_SESSION_SECRET: "unit-test-admin-session-secret-32-bytes-minimum",
  };
  database.prepare("UPDATE booking_settings SET business_name='카타르시스', representative_name='대표자', business_registration_number='123-45-67890', mail_order_registration_number='제2026-부산진-0001호', mail_order_registration_authority='부산진구청', business_email='owner@example.com', privacy_officer_name='대표자', booking_open=1 WHERE id=1").run();
  const session = await createAdminSession("site");
  const response = await updateSettings(new Request("https://backend.example/api/admin/settings", {
    method: "PUT",
    headers: {
      origin: "https://backend.example",
      "content-type": "application/json",
      "x-catharsis-admin-request": "1",
      cookie: `${ADMIN_SESSION_COOKIE}=${session}`,
    },
    body: JSON.stringify({ horizonDays: 14 }),
  }));
  assert.equal(response.status, 200);
  const settings = database.prepare("SELECT horizon_days,business_name,representative_name,business_registration_number,mail_order_registration_number,mail_order_registration_authority,business_email,privacy_officer_name,booking_open FROM booking_settings WHERE id=1").get() as Record<string, unknown>;
  assert.equal(settings.horizon_days, 14);
  assert.equal(settings.business_name, "카타르시스");
  assert.equal(settings.representative_name, "대표자");
  assert.equal(settings.business_registration_number, "123-45-67890");
  assert.equal(settings.mail_order_registration_number, "제2026-부산진-0001호");
  assert.equal(settings.mail_order_registration_authority, "부산진구청");
  assert.equal(settings.business_email, "owner@example.com");
  assert.equal(settings.privacy_officer_name, "대표자");
  assert.equal(settings.booking_open, 1);
  database.close();
});
