CREATE TABLE `owner_push_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alert_id` integer NOT NULL,
	`device_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`provider_message_id` text DEFAULT '' NOT NULL,
	`last_error_code` text DEFAULT '' NOT NULL,
	`last_error_message` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`alert_id`) REFERENCES `owner_alerts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `owner_devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_push_deliveries_alert_device_unique` ON `owner_push_deliveries` (`alert_id`,`device_id`);--> statement-breakpoint
CREATE INDEX `owner_push_deliveries_due_idx` ON `owner_push_deliveries` (`status`,`next_attempt_at`,`lease_until`);--> statement-breakpoint
ALTER TABLE `owner_devices` ADD `fcm_fid_enc` text;--> statement-breakpoint
ALTER TABLE `owner_devices` ADD `fcm_fid_hash` text;--> statement-breakpoint
ALTER TABLE `owner_devices` ADD `fcm_fid_updated_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `owner_devices_fcm_fid_hash_unique` ON `owner_devices` (`fcm_fid_hash`);
--> statement-breakpoint
CREATE TRIGGER `owner_alert_enqueue_push`
AFTER INSERT ON `owner_alerts`
BEGIN
	INSERT OR IGNORE INTO `owner_push_deliveries` (`alert_id`, `device_id`, `next_attempt_at`)
	SELECT NEW.`id`, `id`, 0
	FROM `owner_devices`
	WHERE `active` = 1 AND `fcm_fid_enc` IS NOT NULL;
END;
