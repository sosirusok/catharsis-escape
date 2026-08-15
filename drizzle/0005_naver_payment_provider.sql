ALTER TABLE `reservations` ADD `payment_provider` text DEFAULT 'toss' NOT NULL CHECK (`payment_provider` IN ('toss','naverpay'));--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_tax_scope_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_tax_ex_scope_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `booking_settings`
SET `consent_version` = '2026-08-15-npay',
    `terms_version` = '2026-08-15-npay',
    `refund_policy_version` = '2026-08-15-npay',
    `updated_at` = CURRENT_TIMESTAMP;
