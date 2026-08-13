CREATE TABLE `admin_audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`admin_email` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text DEFAULT '' NOT NULL,
	`before_json` text DEFAULT '{}' NOT NULL,
	`after_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_audit_logs_created_idx` ON `admin_audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `admin_users` (
	`email` text PRIMARY KEY NOT NULL,
	`role` text DEFAULT 'manager' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `booking_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`timezone` text DEFAULT 'Asia/Seoul' NOT NULL,
	`horizon_days` integer DEFAULT 21 NOT NULL,
	`lead_minutes` integer DEFAULT 60 NOT NULL,
	`cancel_cutoff_minutes` integer DEFAULT 1440 NOT NULL,
	`consent_version` text DEFAULT '2026-08-13' NOT NULL,
	`booking_open` integer DEFAULT 1 NOT NULL,
	`paused_message` text DEFAULT '현재 예약 접수가 잠시 중단되었습니다.' NOT NULL,
	`store_phone` text DEFAULT '051-802-3341' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `booking_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`theme_id` text NOT NULL,
	`service_date` text NOT NULL,
	`start_minute` integer NOT NULL,
	`start_at_utc` integer NOT NULL,
	`duration_min` integer NOT NULL,
	`source` text DEFAULT 'rule' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`theme_id`) REFERENCES `themes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_slots_unique_time` ON `booking_slots` (`theme_id`,`service_date`,`start_minute`);--> statement-breakpoint
CREATE INDEX `booking_slots_theme_date_idx` ON `booking_slots` (`theme_id`,`service_date`);--> statement-breakpoint
CREATE TABLE `closures` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text DEFAULT 'store' NOT NULL,
	`theme_id` text,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`public_message` text DEFAULT '휴무' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`theme_id`) REFERENCES `themes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "closures_scope_check" CHECK("closures"."scope" IN ('store','theme'))
);
--> statement-breakpoint
CREATE INDEX `closures_dates_idx` ON `closures` (`start_date`,`end_date`);--> statement-breakpoint
CREATE INDEX `closures_theme_dates_idx` ON `closures` (`theme_id`,`start_date`,`end_date`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`request_count` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reservation_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reservation_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text DEFAULT '' NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reservation_events_reservation_idx` ON `reservation_events` (`reservation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_code` text NOT NULL,
	`request_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`slot_id` text NOT NULL,
	`theme_id` text NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`party_size` integer NOT NULL,
	`customer_name_enc` text NOT NULL,
	`phone_enc` text NOT NULL,
	`phone_hash` text NOT NULL,
	`phone_last4` text NOT NULL,
	`theme_name_snapshot` text NOT NULL,
	`service_date` text NOT NULL,
	`start_minute` integer NOT NULL,
	`duration_min` integer NOT NULL,
	`price_total` integer DEFAULT 0 NOT NULL,
	`consent_version` text NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`admin_memo` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`cancelled_at` text,
	`cancel_reason` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`slot_id`) REFERENCES `booking_slots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`theme_id`) REFERENCES `themes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reservations_status_check" CHECK("reservations"."status" IN ('confirmed','cancelled','checked_in','completed','no_show')),
	CONSTRAINT "reservations_source_check" CHECK("reservations"."source" IN ('web','admin'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_booking_code_unique` ON `reservations` (`booking_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_request_id_unique` ON `reservations` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_one_active_per_slot` ON `reservations` (`slot_id`) WHERE "reservations"."status" IN ('confirmed','checked_in');--> statement-breakpoint
CREATE INDEX `reservations_date_status_idx` ON `reservations` (`service_date`,`status`);--> statement-breakpoint
CREATE INDEX `reservations_created_idx` ON `reservations` (`created_at`);--> statement-breakpoint
CREATE INDEX `reservations_lookup_idx` ON `reservations` (`booking_code`,`phone_hash`);--> statement-breakpoint
CREATE TABLE `schedule_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`theme_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_minute` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`theme_id`) REFERENCES `themes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "schedule_rules_weekday_check" CHECK("schedule_rules"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "schedule_rules_minute_check" CHECK("schedule_rules"."start_minute" BETWEEN 0 AND 1439)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_rules_unique_time` ON `schedule_rules` (`theme_id`,`weekday`,`start_minute`);--> statement-breakpoint
CREATE INDEX `schedule_rules_theme_weekday_idx` ON `schedule_rules` (`theme_id`,`weekday`);--> statement-breakpoint
CREATE TABLE `slot_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`theme_id` text NOT NULL,
	`service_date` text NOT NULL,
	`start_minute` integer NOT NULL,
	`action` text NOT NULL,
	`duration_min` integer,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`theme_id`) REFERENCES `themes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "slot_overrides_action_check" CHECK("slot_overrides"."action" IN ('add','block')),
	CONSTRAINT "slot_overrides_minute_check" CHECK("slot_overrides"."start_minute" BETWEEN 0 AND 1439)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slot_overrides_unique_slot` ON `slot_overrides` (`theme_id`,`service_date`,`start_minute`);--> statement-breakpoint
CREATE INDEX `slot_overrides_date_idx` ON `slot_overrides` (`service_date`,`theme_id`);--> statement-breakpoint
CREATE TABLE `themes` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`genre` text NOT NULL,
	`synopsis` text NOT NULL,
	`art_key` text DEFAULT 'life' NOT NULL,
	`image_key` text,
	`difficulty` integer DEFAULT 3 NOT NULL,
	`difficulty_label` text DEFAULT '' NOT NULL,
	`duration_min` integer DEFAULT 60 NOT NULL,
	`turnover_min` integer DEFAULT 30 NOT NULL,
	`min_people` integer DEFAULT 2 NOT NULL,
	`max_people` integer DEFAULT 5 NOT NULL,
	`notice` text DEFAULT '' NOT NULL,
	`prices_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "themes_difficulty_check" CHECK("themes"."difficulty" BETWEEN 1 AND 5),
	CONSTRAINT "themes_people_check" CHECK("themes"."min_people" >= 1 AND "themes"."max_people" >= "themes"."min_people"),
	CONSTRAINT "themes_status_check" CHECK("themes"."status" IN ('active','hidden','archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `themes_slug_unique` ON `themes` (`slug`);--> statement-breakpoint
CREATE INDEX `themes_status_order_idx` ON `themes` (`status`,`display_order`);
--> statement-breakpoint
INSERT INTO `booking_settings` (`id`,`timezone`,`horizon_days`,`lead_minutes`,`cancel_cutoff_minutes`,`consent_version`,`booking_open`,`paused_message`,`store_phone`)
VALUES (1,'Asia/Seoul',21,60,1440,'2026-08-13',1,'현재 예약 접수가 잠시 중단되었습니다.','051-802-3341');
--> statement-breakpoint
INSERT INTO `themes` (`id`,`slug`,`name`,`short_name`,`genre`,`synopsis`,`art_key`,`difficulty`,`difficulty_label`,`duration_min`,`turnover_min`,`min_people`,`max_people`,`notice`,`prices_json`,`status`,`display_order`) VALUES
('life','life-theme','당신의 인생테마를 찾아드립니다','인생테마','감성 · 스릴러','당신의 기억 속 인생 테마를 재현해 드립니다. 단 한 편을 찾는 특별한 상담이 시작됩니다.','life',3,'',60,30,2,5,'미성년자 비권장','{"2":44000,"3":60000,"4":72000,"5":90000}','active',1),
('office','office-day','왠지 출근하기 싫은날','출근하기 싫은날','일상 · 코믹','하… 출근하기 싫다. 익숙한 사무실에서 시작되는, 익숙하지 않은 하루. 유쾌하지만 만만하지 않습니다.','office',4,'',60,30,2,5,'','{"2":44000,"3":60000,"4":72000,"5":90000}','active',2),
('knock','knock-knock','똑똑! 계시나요?','똑똑! 계시나요?','범죄 · 잠입','여기가 그 집 맞아? 그래, 맞다니까. 문이 열리면 계획대로 움직이세요.','knock',4,'문제 중심',60,30,2,5,'','{"2":44000,"3":60000,"4":72000,"5":90000}','active',3);
--> statement-breakpoint
WITH RECURSIVE `seed_schedule`(`n`) AS (
  VALUES (0)
  UNION ALL
  SELECT `n` + 1 FROM `seed_schedule` WHERE `n` < 188
)
INSERT INTO `schedule_rules` (`theme_id`,`weekday`,`start_minute`)
SELECT
  CASE CAST(`n` / 63 AS INTEGER)
    WHEN 0 THEN 'life'
    WHEN 1 THEN 'office'
    ELSE 'knock'
  END,
  CAST((`n` % 63) / 9 AS INTEGER),
  630 + (`n` % 9) * 90
FROM `seed_schedule`;
