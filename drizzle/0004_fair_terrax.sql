CREATE TABLE `legal_transaction_records` (
	`reservation_id` text PRIMARY KEY NOT NULL,
	`booking_code` text NOT NULL,
	`customer_name_enc` text NOT NULL,
	`phone_enc` text NOT NULL,
	`payment_order_id` text NOT NULL,
	`theme_name` text NOT NULL,
	`service_date` text NOT NULL,
	`start_minute` integer NOT NULL,
	`party_size` integer NOT NULL,
	`amount` integer NOT NULL,
	`paid_at` text NOT NULL,
	`refunded_at` text,
	`retention_until` integer NOT NULL,
	`restricted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `legal_transaction_records_retention_idx` ON `legal_transaction_records` (`retention_until`);--> statement-breakpoint
CREATE TABLE `payment_webhook_events` (
	`event_key` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`order_id` text DEFAULT '' NOT NULL,
	`provider_status` text DEFAULT '' NOT NULL,
	`payload_hash` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`processed_at` text,
	CONSTRAINT "payment_webhook_events_status_check" CHECK("payment_webhook_events"."status" IN ('received','processing','processed','ignored','failed'))
);
--> statement-breakpoint
CREATE INDEX `payment_webhook_events_status_idx` ON `payment_webhook_events` (`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `booking_settings` ADD `terms_version` text DEFAULT '2026-08-15' NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_settings` ADD `refund_policy_version` text DEFAULT '2026-08-15' NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_settings` ADD `business_name` text DEFAULT '카타르시스 이스케이프' NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_settings` ADD `representative_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_settings` ADD `business_registration_number` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_settings` ADD `mail_order_registration_number` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_settings` ADD `mail_order_registration_authority` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_settings` ADD `mail_order_registration_exempt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_settings` ADD `business_address` text DEFAULT '부산 부산진구 중앙대로680번가길 29, 3층' NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_settings` ADD `business_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_settings` ADD `privacy_officer_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_settings` ADD `operational_pii_retention_days` integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_settings` ADD `legal_record_retention_months` integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `terms_version` text DEFAULT '2026-08-15' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `refund_policy_version` text DEFAULT '2026-08-15' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `cancel_cutoff_minutes_snapshot` integer DEFAULT 1440 NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `policy_accepted_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `reservations`
SET `policy_accepted_at` = COALESCE(NULLIF(`created_at`, ''), '2026-08-15 00:00:00')
WHERE `policy_accepted_at` = '';--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_notice_waived` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `pii_purged_at` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_provider_checked_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `reservations_payment_reconcile_idx` ON `reservations` (`payment_status`,`payment_provider_checked_at`);--> statement-breakpoint
UPDATE `owner_push_deliveries`
SET `status` = 'dead', `lease_token` = NULL, `lease_until` = NULL,
	`last_error_code` = 'DEVICE_DEDUPLICATED', `updated_at` = CURRENT_TIMESTAMP
WHERE `status` IN ('pending','retry','sending')
	AND `device_id` IN (
		SELECT `id` FROM `owner_devices`
		WHERE `active` = 1
			AND `id` NOT IN (SELECT `id` FROM `owner_devices` WHERE `active` = 1 ORDER BY `last_seen_at` DESC, `created_at` DESC, `id` DESC LIMIT 1)
	);--> statement-breakpoint
UPDATE `owner_devices`
SET `active` = 0, `fcm_fid_enc` = NULL, `fcm_fid_hash` = NULL,
	`fcm_fid_updated_at` = CURRENT_TIMESTAMP
WHERE `active` = 1
	AND `id` NOT IN (SELECT `id` FROM `owner_devices` WHERE `active` = 1 ORDER BY `last_seen_at` DESC, `created_at` DESC, `id` DESC LIMIT 1);--> statement-breakpoint
CREATE UNIQUE INDEX `owner_devices_one_active_idx` ON `owner_devices` (`active`) WHERE "owner_devices"."active" = 1;
