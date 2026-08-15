import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const themes = sqliteTable(
  "themes",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    shortName: text("short_name").notNull(),
    genre: text("genre").notNull(),
    synopsis: text("synopsis").notNull(),
    artKey: text("art_key").notNull().default("life"),
    imageKey: text("image_key"),
    difficulty: integer("difficulty").notNull().default(3),
    difficultyLabel: text("difficulty_label").notNull().default(""),
    durationMin: integer("duration_min").notNull().default(60),
    turnoverMin: integer("turnover_min").notNull().default(30),
    minPeople: integer("min_people").notNull().default(2),
    maxPeople: integer("max_people").notNull().default(5),
    notice: text("notice").notNull().default(""),
    pricesJson: text("prices_json").notNull().default("{}"),
    status: text("status").notNull().default("active"),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("themes_status_order_idx").on(table.status, table.displayOrder),
    check("themes_difficulty_check", sql`${table.difficulty} BETWEEN 1 AND 5`),
    check("themes_people_check", sql`${table.minPeople} >= 1 AND ${table.maxPeople} >= ${table.minPeople}`),
    check("themes_status_check", sql`${table.status} IN ('active','hidden','archived')`),
  ],
);

export const scheduleRules = sqliteTable(
  "schedule_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    themeId: text("theme_id").notNull().references(() => themes.id),
    weekday: integer("weekday").notNull(),
    startMinute: integer("start_minute").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("schedule_rules_unique_time").on(table.themeId, table.weekday, table.startMinute),
    index("schedule_rules_theme_weekday_idx").on(table.themeId, table.weekday),
    check("schedule_rules_weekday_check", sql`${table.weekday} BETWEEN 0 AND 6`),
    check("schedule_rules_minute_check", sql`${table.startMinute} BETWEEN 0 AND 1439`),
  ],
);

export const closures = sqliteTable(
  "closures",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull().default("store"),
    themeId: text("theme_id").references(() => themes.id),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    note: text("note").notNull().default(""),
    publicMessage: text("public_message").notNull().default("휴무"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("closures_dates_idx").on(table.startDate, table.endDate),
    index("closures_theme_dates_idx").on(table.themeId, table.startDate, table.endDate),
    check("closures_scope_check", sql`${table.scope} IN ('store','theme')`),
  ],
);

export const slotOverrides = sqliteTable(
  "slot_overrides",
  {
    id: text("id").primaryKey(),
    themeId: text("theme_id").notNull().references(() => themes.id),
    serviceDate: text("service_date").notNull(),
    startMinute: integer("start_minute").notNull(),
    action: text("action").notNull(),
    durationMin: integer("duration_min"),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("slot_overrides_unique_slot").on(table.themeId, table.serviceDate, table.startMinute),
    index("slot_overrides_date_idx").on(table.serviceDate, table.themeId),
    check("slot_overrides_action_check", sql`${table.action} IN ('add','block')`),
    check("slot_overrides_minute_check", sql`${table.startMinute} BETWEEN 0 AND 1439`),
  ],
);

export const bookingSlots = sqliteTable(
  "booking_slots",
  {
    id: text("id").primaryKey(),
    themeId: text("theme_id").notNull().references(() => themes.id),
    serviceDate: text("service_date").notNull(),
    startMinute: integer("start_minute").notNull(),
    startAtUtc: integer("start_at_utc").notNull(),
    durationMin: integer("duration_min").notNull(),
    source: text("source").notNull().default("rule"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("booking_slots_unique_time").on(table.themeId, table.serviceDate, table.startMinute),
    index("booking_slots_theme_date_idx").on(table.themeId, table.serviceDate),
  ],
);

export const reservations = sqliteTable(
  "reservations",
  {
    id: text("id").primaryKey(),
    bookingCode: text("booking_code").notNull().unique(),
    requestId: text("request_id").notNull().unique(),
    requestFingerprint: text("request_fingerprint").notNull(),
    slotId: text("slot_id").notNull().references(() => bookingSlots.id),
    themeId: text("theme_id").notNull().references(() => themes.id),
    status: text("status").notNull().default("confirmed"),
    partySize: integer("party_size").notNull(),
    customerNameEnc: text("customer_name_enc").notNull(),
    phoneEnc: text("phone_enc").notNull(),
    phoneHash: text("phone_hash").notNull(),
    phoneLast4: text("phone_last4").notNull(),
    themeNameSnapshot: text("theme_name_snapshot").notNull(),
    serviceDate: text("service_date").notNull(),
    startMinute: integer("start_minute").notNull(),
    durationMin: integer("duration_min").notNull(),
    priceTotal: integer("price_total").notNull().default(0),
    consentVersion: text("consent_version").notNull(),
    termsVersion: text("terms_version").notNull().default("2026-08-15"),
    refundPolicyVersion: text("refund_policy_version").notNull().default("2026-08-15"),
    cancelCutoffMinutesSnapshot: integer("cancel_cutoff_minutes_snapshot").notNull().default(1440),
    policyAcceptedAt: text("policy_accepted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    paymentNoticeWaived: integer("payment_notice_waived").notNull().default(0),
    piiPurgedAt: text("pii_purged_at"),
    source: text("source").notNull().default("web"),
    adminMemo: text("admin_memo").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    cancelledAt: text("cancelled_at"),
    cancelReason: text("cancel_reason").notNull().default(""),
    paymentStatus: text("payment_status").notNull().default("manual"),
    paymentOrderId: text("payment_order_id"),
    paymentState: text("payment_state"),
    paymentKey: text("payment_key"),
    paymentMethod: text("payment_method").notNull().default(""),
    paymentExpiresAt: integer("payment_expires_at"),
    paymentResultExpiresAt: integer("payment_result_expires_at"),
    paidAmount: integer("paid_amount").notNull().default(0),
    paidAt: text("paid_at"),
    refundedAt: text("refunded_at"),
    receiptUrl: text("receipt_url").notNull().default(""),
    paymentFailureCode: text("payment_failure_code").notNull().default(""),
    paymentFailureMessage: text("payment_failure_message").notNull().default(""),
    paymentProviderCheckedAt: integer("payment_provider_checked_at").notNull().default(0),
  },
  (table) => [
    uniqueIndex("reservations_one_active_per_slot").on(table.slotId).where(sql`${table.status} IN ('confirmed','checked_in')`),
    index("reservations_date_status_idx").on(table.serviceDate, table.status),
    index("reservations_created_idx").on(table.createdAt),
    index("reservations_lookup_idx").on(table.bookingCode, table.phoneHash),
    uniqueIndex("reservations_payment_order_idx").on(table.paymentOrderId),
    uniqueIndex("reservations_payment_state_idx").on(table.paymentState),
    uniqueIndex("reservations_payment_key_idx").on(table.paymentKey),
    index("reservations_payment_reconcile_idx").on(table.paymentStatus, table.paymentProviderCheckedAt),
    check("reservations_status_check", sql`${table.status} IN ('confirmed','cancelled','checked_in','completed','no_show')`),
    check("reservations_source_check", sql`${table.source} IN ('web','admin')`),
  ],
);

export const reservationEvents = sqliteTable(
  "reservation_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reservationId: text("reservation_id").notNull().references(() => reservations.id),
    eventType: text("event_type").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull().default(""),
    payloadJson: text("payload_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("reservation_events_reservation_idx").on(table.reservationId, table.createdAt)],
);

export const bookingSettings = sqliteTable("booking_settings", {
  id: integer("id").primaryKey(),
  timezone: text("timezone").notNull().default("Asia/Seoul"),
  horizonDays: integer("horizon_days").notNull().default(21),
  leadMinutes: integer("lead_minutes").notNull().default(60),
  cancelCutoffMinutes: integer("cancel_cutoff_minutes").notNull().default(1440),
  consentVersion: text("consent_version").notNull().default("2026-08-15"),
  termsVersion: text("terms_version").notNull().default("2026-08-15"),
  refundPolicyVersion: text("refund_policy_version").notNull().default("2026-08-15"),
  bookingOpen: integer("booking_open").notNull().default(1),
  pausedMessage: text("paused_message").notNull().default("현재 예약 접수가 잠시 중단되었습니다."),
  storePhone: text("store_phone").notNull().default("051-802-3341"),
  businessName: text("business_name").notNull().default("카타르시스 이스케이프"),
  representativeName: text("representative_name").notNull().default(""),
  businessRegistrationNumber: text("business_registration_number").notNull().default(""),
  mailOrderRegistrationNumber: text("mail_order_registration_number").notNull().default(""),
  mailOrderRegistrationAuthority: text("mail_order_registration_authority").notNull().default(""),
  mailOrderRegistrationExempt: integer("mail_order_registration_exempt").notNull().default(0),
  businessAddress: text("business_address").notNull().default("부산 부산진구 중앙대로680번가길 29, 3층"),
  businessEmail: text("business_email").notNull().default(""),
  privacyOfficerName: text("privacy_officer_name").notNull().default(""),
  operationalPiiRetentionDays: integer("operational_pii_retention_days").notNull().default(90),
  legalRecordRetentionMonths: integer("legal_record_retention_months").notNull().default(60),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const legalTransactionRecords = sqliteTable(
  "legal_transaction_records",
  {
    reservationId: text("reservation_id").primaryKey().references(() => reservations.id),
    bookingCode: text("booking_code").notNull(),
    customerNameEnc: text("customer_name_enc").notNull(),
    phoneEnc: text("phone_enc").notNull(),
    paymentOrderId: text("payment_order_id").notNull(),
    themeName: text("theme_name").notNull(),
    serviceDate: text("service_date").notNull(),
    startMinute: integer("start_minute").notNull(),
    partySize: integer("party_size").notNull(),
    amount: integer("amount").notNull(),
    paidAt: text("paid_at").notNull(),
    refundedAt: text("refunded_at"),
    retentionUntil: integer("retention_until").notNull(),
    restrictedAt: text("restricted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("legal_transaction_records_retention_idx").on(table.retentionUntil)],
);

export const paymentWebhookEvents = sqliteTable(
  "payment_webhook_events",
  {
    eventKey: text("event_key").primaryKey(),
    eventType: text("event_type").notNull(),
    orderId: text("order_id").notNull().default(""),
    providerStatus: text("provider_status").notNull().default(""),
    payloadHash: text("payload_hash").notNull(),
    status: text("status").notNull().default("received"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    processedAt: text("processed_at"),
  },
  (table) => [
    index("payment_webhook_events_status_idx").on(table.status, table.createdAt),
    check("payment_webhook_events_status_check", sql`${table.status} IN ('received','processing','processed','ignored','failed')`),
  ],
);

export const adminAuditLogs = sqliteTable(
  "admin_audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    adminEmail: text("admin_email").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull().default(""),
    beforeJson: text("before_json").notNull().default("{}"),
    afterJson: text("after_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("admin_audit_logs_created_idx").on(table.createdAt)],
);

export const rateLimits = sqliteTable("rate_limits", {
  bucketKey: text("bucket_key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  requestCount: integer("request_count").notNull().default(1),
});

export const ownerDevices = sqliteTable(
  "owner_devices",
  {
    id: text("id").primaryKey(),
    deviceName: text("device_name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenLast8: text("token_last8").notNull(),
    fcmFidEnc: text("fcm_fid_enc"),
    fcmFidHash: text("fcm_fid_hash"),
    fcmFidUpdatedAt: text("fcm_fid_updated_at"),
    active: integer("active").notNull().default(1),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("owner_devices_active_idx").on(table.active, table.lastSeenAt),
    uniqueIndex("owner_devices_one_active_idx").on(table.active).where(sql`${table.active} = 1`),
    uniqueIndex("owner_devices_fcm_fid_hash_unique").on(table.fcmFidHash),
  ],
);

export const ownerAlerts = sqliteTable(
  "owner_alerts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reservationId: text("reservation_id").notNull().references(() => reservations.id),
    type: text("type").notNull(),
    bookingCode: text("booking_code").notNull(),
    themeName: text("theme_name").notNull(),
    serviceDate: text("service_date").notNull(),
    startMinute: integer("start_minute").notNull(),
    partySize: integer("party_size").notNull(),
    amount: integer("amount").notNull().default(0),
    status: text("status").notNull(),
    paymentStatus: text("payment_status").notNull(),
    customerNameEnc: text("customer_name_enc").notNull(),
    phoneEnc: text("phone_enc").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("owner_alerts_event_unique").on(table.reservationId, table.type),
    index("owner_alerts_created_idx").on(table.id, table.createdAt),
  ],
);

export const ownerPushDeliveries = sqliteTable(
  "owner_push_deliveries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    alertId: integer("alert_id").notNull().references(() => ownerAlerts.id),
    deviceId: text("device_id").notNull().references(() => ownerDevices.id),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull().default(0),
    leaseToken: text("lease_token"),
    leaseUntil: integer("lease_until"),
    providerMessageId: text("provider_message_id").notNull().default(""),
    lastErrorCode: text("last_error_code").notNull().default(""),
    lastErrorMessage: text("last_error_message").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    sentAt: text("sent_at"),
  },
  (table) => [
    uniqueIndex("owner_push_deliveries_alert_device_unique").on(table.alertId, table.deviceId),
    index("owner_push_deliveries_due_idx").on(table.status, table.nextAttemptAt, table.leaseUntil),
  ],
);
