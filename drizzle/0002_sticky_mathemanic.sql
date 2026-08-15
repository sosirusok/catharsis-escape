CREATE TABLE `owner_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reservation_id` text NOT NULL,
	`type` text NOT NULL,
	`booking_code` text NOT NULL,
	`theme_name` text NOT NULL,
	`service_date` text NOT NULL,
	`start_minute` integer NOT NULL,
	`party_size` integer NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`payment_status` text NOT NULL,
	`customer_name_enc` text NOT NULL,
	`phone_enc` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_alerts_event_unique` ON `owner_alerts` (`reservation_id`,`type`);--> statement-breakpoint
CREATE INDEX `owner_alerts_created_idx` ON `owner_alerts` (`id`,`created_at`);--> statement-breakpoint
CREATE TABLE `owner_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`device_name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_last8` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_devices_token_hash_unique` ON `owner_devices` (`token_hash`);--> statement-breakpoint
CREATE INDEX `owner_devices_active_idx` ON `owner_devices` (`active`,`last_seen_at`);--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_status` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_order_id` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_state` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_key` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_method` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_expires_at` integer;--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_result_expires_at` integer;--> statement-breakpoint
ALTER TABLE `reservations` ADD `paid_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `paid_at` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `refunded_at` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `receipt_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_failure_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_failure_message` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_payment_order_idx` ON `reservations` (`payment_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_payment_state_idx` ON `reservations` (`payment_state`);--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_payment_key_idx` ON `reservations` (`payment_key`);