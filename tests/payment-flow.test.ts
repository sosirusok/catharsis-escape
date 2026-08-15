import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { cleanupRetainedData, getPaymentResult, confirmReservationPayment, refundReservationPayment, releaseReviewedUnpaidReservation } from "../lib/payment-flow";
import { addDays, encryptPrivate, kstDateKey, readJsonBody, sha256, weekdayKst } from "../lib/booking";
import { buildAvailability } from "../lib/availability";
import { isPublicWebOriginAllowed } from "../lib/request-origin";
import { dispatchOwnerPushes } from "../lib/owner-push";
import { DELETE as revokeDevice, PATCH as registerPushDevice } from "../app/api/owner-app/device/route";
import { POST as checkoutPayment } from "../app/api/public/payments/checkout/route";
import { POST as tossWebhook } from "../app/api/public/payments/toss/webhook/route";
import { PUT as updateSettings } from "../app/api/admin/settings/route";
import { ADMIN_SESSION_COOKIE, createAdminSession } from "../lib/admin";

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
  for (const file of ["drizzle/0000_funny_shiva.sql", "drizzle/0001_fixed_groot.sql", "drizzle/0002_sticky_mathemanic.sql", "drizzle/0003_wonderful_dazzler.sql", "drizzle/0004_fair_terrax.sql"]) {
    const migration = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) database.exec(statement);
  }
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
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = {
    DB: d1,
    TOSS_CLIENT_KEY: ["test", "gck", "unit"].join("_"),
    TOSS_SECRET_KEY: ["test", "gsk", "unit"].join("_"),
    BOOKING_DATA_KEY: "unit-test-booking-data-key-32-bytes-minimum",
    BOOKING_LOOKUP_PEPPER: "unit-test-booking-lookup-pepper-32-bytes-minimum",
    ALLOW_PUBLIC_TEST_PAYMENTS: "1",
  };
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
      consentVersion: "2026-08-13",
      termsVersion: "2026-08-15",
      refundPolicyVersion: "2026-08-15",
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
  (globalThis as typeof globalThis & { __SITES_ENV__?: unknown }).__SITES_ENV__ = {
    DB: d1,
    TOSS_CLIENT_KEY: ["test", "gck", "unit"].join("_"),
    TOSS_SECRET_KEY: ["test", "gsk", "unit"].join("_"),
    BOOKING_DATA_KEY: "unit-test-booking-data-key-32-bytes-minimum",
    BOOKING_LOOKUP_PEPPER: "unit-test-booking-lookup-pepper-32-bytes-minimum",
    ALLOW_PUBLIC_TEST_PAYMENTS: "1",
  };
  const date = addDays(kstDateKey(), 3);
  const weekday = weekdayKst(date);
  database.prepare("INSERT INTO themes (id, slug, name, short_name, genre, synopsis, duration_min, turnover_min, prices_json) VALUES ('policy', 'policy', '정책 테스트', '정책', '테스트', '테스트', 60, 30, '{\"2\":44000}')").run();
  database.prepare("INSERT INTO schedule_rules (theme_id, weekday, start_minute) VALUES ('policy', ?, 630)").run(weekday);
  const basePayload = {
    slotId: `slot_policy_${date.replaceAll("-", "")}_630`,
    partySize: 2,
    name: "정책손님",
    phone: "01012345678",
    consentVersion: "2026-08-13",
    termsVersion: "2026-08-15",
    refundPolicyVersion: "2026-08-15",
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
  assert.equal(snapshot.consent_version, "2026-08-13");
  assert.equal(snapshot.terms_version, "2026-08-15");
  assert.equal(snapshot.refund_policy_version, "2026-08-15");
  assert.equal(snapshot.cancel_cutoff_minutes_snapshot, 1440);
  assert.equal(snapshot.payment_notice_waived, 0);
  assert.ok(snapshot.policy_accepted_at);
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
